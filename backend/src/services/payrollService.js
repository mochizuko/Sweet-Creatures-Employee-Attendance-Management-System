const db = require('../config/db');
const policyService = require('./policyService');

class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function computePay({ totalHours, overtimeHours, rate, otMultiplier = 1.25 }) {
  const regularHours = Math.max(0, totalHours - overtimeHours);
  return round2(regularHours * rate + overtimeHours * rate * otMultiplier);
}

/* ------------------------- Pay rate by date --------------------------- */

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => (d instanceof Date
  ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  : String(d).slice(0, 10));

// Hourly rate changes per employee, oldest first. Empty if no change was ever recorded
// (or the database update has not been run), in which case the current rate applies to every day.
async function loadRateTimeline(conn) {
  const timeline = new Map();
  try {
    const [rows] = await conn.query(
      `SELECT user_id, effective_from, hourly_rate FROM employee_change_history
        WHERE hourly_rate IS NOT NULL ORDER BY user_id, effective_from, history_id`);
    for (const r of rows) {
      if (!timeline.has(r.user_id)) timeline.set(r.user_id, []);
      timeline.get(r.user_id).push({ from: ymd(r.effective_from), rate: Number(r.hourly_rate) });
    }
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') throw err;
  }
  return timeline;
}

// The hourly rate that applied to this employee on a given day.
function rateOn(timeline, userId, date, fallback) {
  const list = timeline.get(userId);
  if (!list) return fallback;
  let rate = null;
  for (const h of list) {
    if (h.from <= date) rate = h.rate; else break;
  }
  return rate == null ? fallback : rate;
}

// Completed shifts to pay. A shift waiting on owner review is not paid yet. A rejected shift is not paid,
// except when only the overtime was rejected: the regular hours are still paid.
async function loadRecords(conn, start, end) {
  const base = `SELECT user_id, attendance_date, status, total_hours_worked, overtime_hours
                  FROM attendance_record
                 WHERE time_out IS NOT NULL AND attendance_date BETWEEN ? AND ?`;
  try {
    const [rows] = await conn.query(
      `${base} AND (review_status IN ('None', 'Approved')
                    OR (review_status = 'Rejected' AND ot_pending_hours > 0 AND flag_reason LIKE 'Overtime pending approval%'))`,
      [start, end]);
    return rows;
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR') throw err;
    const [rows] = await conn.query(`${base} AND review_status IN ('None', 'Approved')`, [start, end]);
    return rows;
  }
}

/* ------------------------------ Cutoffs ------------------------------ */

async function createCutoff({ start_date, end_date }) {
  if (start_date > end_date) throw new AppError('start_date must be on or before end_date');

  const [overlap] = await db.query(
    `SELECT cutoff_id FROM payslip_cutoff
      WHERE start_date <= ? AND end_date >= ?`,
    [end_date, start_date]
  );
  if (overlap.length) throw new AppError('Cutoff overlaps an existing cutoff', 409);

  const [r] = await db.query(
    `INSERT INTO payslip_cutoff (start_date, end_date, status) VALUES (?, ?, 'Open')`,
    [start_date, end_date]
  );
  return { cutoff_id: r.insertId, start_date, end_date, status: 'Open' };
}

// Find the cutoff with exactly these dates, or create it.
async function ensureCutoff({ start_date, end_date }) {
  const [rows] = await db.query('SELECT * FROM payslip_cutoff WHERE start_date = ? AND end_date = ?', [start_date, end_date]);
  if (rows[0]) return rows[0];
  return createCutoff({ start_date, end_date });
}

async function listCutoffs() {
  const [rows] = await db.query(
    `SELECT * FROM payslip_cutoff ORDER BY start_date DESC`
  );
  return rows;
}

/* --------------------------- Generate drafts -------------------------- */

/**
 * (Re)generate Draft payslips for every active employee in the cutoff.
 * Finalized payslips are never touched. Manually entered cash-advance
 * deductions on existing drafts are preserved (capped at the new gross).
 */
async function generatePayslips(cutoffId) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[cutoff]] = await conn.query(
      `SELECT * FROM payslip_cutoff WHERE cutoff_id = ? FOR UPDATE`,
      [cutoffId]
    );
    if (!cutoff) throw new AppError('Cutoff not found', 404);
    if (cutoff.status === 'Closed') throw new AppError('Cutoff is closed', 409);

    const [employees] = await conn.query(
      `SELECT user_id, hourly_rate FROM \`user\`
        WHERE account_role = 'Staff' AND account_status = 'Active'`
    );
    const records = await loadRecords(conn, cutoff.start_date, cutoff.end_date);
    const recsBy = new Map();
    for (const r of records) {
      if (!recsBy.has(r.user_id)) recsBy.set(r.user_id, []);
      recsBy.get(r.user_id).push(r);
    }

    const [existing] = await conn.query(
      `SELECT payslip_id, user_id, status FROM payslip WHERE cutoff_id = ? FOR UPDATE`,
      [cutoffId]
    );
    const byUser = new Map(existing.map((p) => [p.user_id, p]));

    const policy = await policyService.current(conn);
    const timeline = await loadRateTimeline(conn);
    // Approved cash advances for this cutoff are deducted automatically (never more than the pay).
    const [adv] = await conn.query(
      `SELECT user_id, SUM(amount) AS total FROM cash_advance
        WHERE cutoff_id = ? AND status = 'Approved' GROUP BY user_id`, [cutoffId]);
    const advanceBy = new Map(adv.map((a) => [a.user_id, Number(a.total)]));

    let created = 0, updated = 0, skipped = 0;
    const missingRate = [];

    for (const e of employees) {
      const prev = byUser.get(e.user_id);
      if (prev && prev.status === 'Finalized') { skipped++; continue; }

      if (e.hourly_rate == null) missingRate.push(e.user_id);
      const rate = Number(e.hourly_rate || 0);
      const recs = recsBy.get(e.user_id) || [];
      const days = recs.length;

      let totalHours = 0, overtime = 0, shortMinutes = 0;
      let basicAcc = 0, otAcc = 0, lateAcc = 0;
      for (const r of recs) {
        const worked = Number(r.total_hours_worked);
        totalHours += worked;
        overtime += Number(r.overtime_hours);
        // Time not worked below the standard shift is unpaid. Arriving within the
        // grace period is not penalised unless the shortfall is bigger than the grace period.
        let shortfall = Math.max(0, Math.round(policy.standardShift * 60 - worked * 60));
        if (r.status === 'OnTime' && shortfall <= policy.graceMinutes) shortfall = 0;
        shortMinutes += shortfall;
        // Each day is paid at the rate that applied on that day.
        const dayRate = rateOn(timeline, e.user_id, ymd(r.attendance_date), rate);
        basicAcc += policy.standardShift * dayRate;
        otAcc += Number(r.overtime_hours) * dayRate * policy.otMultiplier;
        lateAcc += (shortfall / 60) * dayRate;
      }
      totalHours = round2(totalHours);
      overtime = round2(overtime);

      const basic = round2(basicAcc);
      const otPay = round2(otAcc);
      const lateDeduction = round2(lateAcc);
      const rateEnd = rateOn(timeline, e.user_id, ymd(cutoff.end_date), rate);
      const gross = Math.max(0, round2(basic + otPay - lateDeduction));
      const deduction = round2(Math.min(advanceBy.get(e.user_id) || 0, gross));
      const net = round2(gross - deduction);

      if (prev) {
        await conn.query(
          `UPDATE payslip
              SET days_worked = ?, total_hours_worked = ?, overtime_hours = ?, undertime_hours = ?,
                  hourly_rate = ?, basic_pay = ?, overtime_pay = ?, late_undertime_minutes = ?,
                  late_undertime_deduction = ?, gross_pay = ?, cash_advance_deduction = ?, net_pay = ?
            WHERE payslip_id = ?`,
          [days, totalHours, overtime, round2(shortMinutes / 60), rateEnd, basic, otPay, shortMinutes,
           lateDeduction, gross, deduction, net, prev.payslip_id]
        );
        updated++;
      } else {
        await conn.query(
          `INSERT INTO payslip
             (user_id, cutoff_id, days_worked, total_hours_worked, overtime_hours, undertime_hours,
              hourly_rate, basic_pay, overtime_pay, late_undertime_minutes, late_undertime_deduction,
              gross_pay, cash_advance_deduction, net_pay, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft')`,
          [e.user_id, cutoffId, days, totalHours, overtime, round2(shortMinutes / 60), rateEnd, basic, otPay,
           shortMinutes, lateDeduction, gross, deduction, net]
        );
        created++;
      }
    }

    await conn.commit();
    return { cutoff_id: cutoffId, created, updated, skipped_finalized: skipped, missing_hourly_rate: missingRate };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------ Review/edit --------------------------- */

async function listPayslipsForCutoff(cutoffId) {
  const [rows] = await db.query(
    `SELECT p.*, u.first_name, u.middle_name, u.last_name, u.job_position
       FROM payslip p JOIN \`user\` u ON u.user_id = p.user_id
      WHERE p.cutoff_id = ?
      ORDER BY u.last_name, u.first_name`,
    [cutoffId]
  );
  const policy = await policyService.current();
  const num = (v) => Number(v);
  return rows.map((p) => ({
    payslip_id: p.payslip_id, user_id: p.user_id, cutoff_id: p.cutoff_id, status: p.status,
    name: [p.first_name, p.middle_name, p.last_name].filter(Boolean).join(' '),
    job_position: p.job_position,
    days_worked: p.days_worked, total_hours_worked: num(p.total_hours_worked),
    hourly_rate: num(p.hourly_rate), basic_pay: num(p.basic_pay),
    overtime_hours: num(p.overtime_hours), overtime_pay: num(p.overtime_pay),
    late_undertime_minutes: p.late_undertime_minutes, late_undertime_deduction: num(p.late_undertime_deduction),
    gross_pay: num(p.gross_pay), cash_advance_deduction: num(p.cash_advance_deduction), net_pay: num(p.net_pay),
    ot_multiplier: policy.otMultiplier, standard_shift: policy.standardShift,
  }));
}

async function updateDraft(payslipId, { cash_advance_deduction }) {
  const deduction = Number(cash_advance_deduction);
  if (!Number.isFinite(deduction) || deduction < 0) {
    throw new AppError('cash_advance_deduction must be a number >= 0');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query(
      `SELECT * FROM payslip WHERE payslip_id = ? FOR UPDATE`,
      [payslipId]
    );
    if (!p) throw new AppError('Payslip not found', 404);
    if (p.status !== 'Draft') throw new AppError('Only Draft payslips can be edited', 409);
    if (deduction > Number(p.gross_pay)) {
      throw new AppError('Deduction cannot exceed gross pay');
    }

    const net = round2(Number(p.gross_pay) - deduction);
    await conn.query(
      `UPDATE payslip SET cash_advance_deduction = ?, net_pay = ? WHERE payslip_id = ?`,
      [round2(deduction), net, payslipId]
    );
    await conn.commit();
    return { ...p, cash_advance_deduction: round2(deduction), net_pay: net };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------ Finalize ------------------------------ */

async function finalizeCutoff(cutoffId, adminUserId) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[cutoff]] = await conn.query(
      `SELECT * FROM payslip_cutoff WHERE cutoff_id = ? FOR UPDATE`,
      [cutoffId]
    );
    if (!cutoff) throw new AppError('Cutoff not found', 404);
    if (cutoff.status === 'Closed') throw new AppError('Cutoff is already closed', 409);

    const [res] = await conn.query(
      `UPDATE payslip
          SET status = 'Finalized', finalized_by_user_id = ?
        WHERE cutoff_id = ? AND status = 'Draft'`,
      [adminUserId, cutoffId]
    );
    if (!res.affectedRows) throw new AppError('No draft payslips to finalize. Generate first.', 409);

    await conn.query(
      `UPDATE cash_advance SET status = 'Deducted' WHERE cutoff_id = ? AND status = 'Approved'`,
      [cutoffId]
    );
    await conn.query(
      `UPDATE payslip_cutoff SET status = 'Closed' WHERE cutoff_id = ?`,
      [cutoffId]
    );
    await conn.commit();
    return { cutoff_id: cutoffId, finalized: res.affectedRows, status: 'Closed' };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ------------------------------ Employee view ------------------------- */

async function listOwnPayslips(userId) {
  const [rows] = await db.query(
    `SELECT p.*, c.start_date, c.end_date
       FROM payslip p JOIN payslip_cutoff c ON c.cutoff_id = p.cutoff_id
      WHERE p.user_id = ? AND p.status = 'Finalized'
      ORDER BY c.start_date DESC`,
    [userId]
  );
  return rows;
}

async function getPayslip(payslipId, requester) {
  const [[p]] = await db.query(
    `SELECT p.*, c.start_date, c.end_date
       FROM payslip p JOIN payslip_cutoff c ON c.cutoff_id = p.cutoff_id
      WHERE p.payslip_id = ?`,
    [payslipId]
  );
  // Same 404 for "missing" and "not yours/not finalized" to avoid leaking IDs.
  if (!p) throw new AppError('Payslip not found', 404);
  if (requester.role !== 'Admin' && (p.user_id !== requester.user_id || p.status !== 'Finalized')) {
    throw new AppError('Payslip not found', 404);
  }
  return p;
}

module.exports = {
  createCutoff, ensureCutoff, listCutoffs, generatePayslips, listPayslipsForCutoff,
  updateDraft, finalizeCutoff, listOwnPayslips, getPayslip, AppError,
};