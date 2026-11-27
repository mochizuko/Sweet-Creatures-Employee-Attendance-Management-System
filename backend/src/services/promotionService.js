// Promotions and pay changes. Every change is recorded with an effective date so payroll can pay
// the right rate for each attendance day. The employee record always holds the values in force today.
const db = require('../config/db');
const { AppError } = require('../utils/http');
const { manilaParts, round2 } = require('../utils/time');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(d).slice(0, 10);
};
const fullName = (u) => [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ');

const shape = (h) => ({
  id: h.history_id,
  effectiveFrom: ymd(h.effective_from),
  jobPosition: h.job_position,
  hourlyRate: h.hourly_rate == null ? null : Number(h.hourly_rate),
  role: h.account_role,
  reason: h.reason || '',
  changedBy: h.first_name ? fullName(h) : null,
  createdAt: h.created_at,
});

async function list(userId) {
  try {
    const [rows] = await db.query(
      `SELECT h.*, a.first_name, a.middle_name, a.last_name
         FROM employee_change_history h
         LEFT JOIN \`user\` a ON a.user_id = h.changed_by_user_id
        WHERE h.user_id = ?
        ORDER BY h.effective_from DESC, h.history_id DESC`, [userId]);
    return rows.map(shape);
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
}

// The position and rate in force for this employee on a date (latest change on or before it).
async function inForce(conn, userId, date) {
  const [rows] = await conn.query(
    `SELECT job_position, hourly_rate FROM employee_change_history
      WHERE user_id = ? AND effective_from <= ?
      ORDER BY effective_from DESC, history_id DESC LIMIT 1`, [userId, date]);
  return rows[0] || null;
}

async function promote(userId, input = {}, actor = {}) {
  const eff = String(input.effectiveDate || '');
  if (!DATE_RE.test(eff)) throw new AppError('Effective date must be YYYY-MM-DD.');
  const today = manilaParts().date;
  if (eff > today) throw new AppError('The effective date cannot be in the future. Enter the change on the day it starts.');

  const position = input.jobPosition === undefined || input.jobPosition === null ? null : String(input.jobPosition).trim();
  if (position !== null && (!position || position.length > 100)) throw new AppError('Position must be 1 to 100 characters.');

  let rate = null;
  if (input.hourlyRate !== undefined && input.hourlyRate !== null && input.hourlyRate !== '') {
    rate = round2(input.hourlyRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new AppError('Hourly rate must be greater than 0.');
  }
  const role = input.role === undefined || input.role === null || input.role === '' ? null : String(input.role);
  if (role !== null && !['Admin', 'Staff'].includes(role)) throw new AppError('Role must be Admin or Staff.');
  const reason = String(input.reason || '').trim().slice(0, 255) || null;
  if (position === null && rate === null && role === null) {
    throw new AppError('Change at least one of position, hourly rate or role.');
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[u]] = await conn.query(
      'SELECT user_id, job_position, hourly_rate, account_role FROM `user` WHERE user_id = ? FOR UPDATE', [userId]);
    if (!u) throw new AppError('Employee not found', 404);

    // Payroll up to the last closed cutoff is final, so pay and position cannot change inside it.
    const [[closed]] = await conn.query("SELECT MAX(end_date) AS last_closed FROM payslip_cutoff WHERE status = 'Closed'");
    const lastClosed = closed && closed.last_closed ? ymd(closed.last_closed) : null;
    if ((position !== null || rate !== null) && lastClosed && eff <= lastClosed) {
      throw new AppError(`Position and pay cannot change on or before ${lastClosed}, because payroll up to that date is already finalized.`, 409);
    }
    if (role !== null && role !== 'Admin' && Number(u.user_id) === Number(actor.id)) {
      throw new AppError('You cannot remove your own Admin role.', 400);
    }

    // First change for this employee: keep their starting values so earlier days still use them.
    const [[count]] = await conn.query('SELECT COUNT(*) AS n FROM employee_change_history WHERE user_id = ?', [userId]);
    if (!Number(count.n)) {
      await conn.query(
        `INSERT INTO employee_change_history (user_id, effective_from, job_position, hourly_rate, account_role, reason, changed_by_user_id)
         VALUES (?, '2000-01-01', ?, ?, ?, 'Starting values', NULL)`, [userId, u.job_position, u.hourly_rate, u.account_role]);
    }

    const base = await inForce(conn, userId, eff);
    const newPosition = position !== null ? position : (base ? base.job_position : u.job_position);
    const newRate = rate !== null ? rate : (base && base.hourly_rate != null ? Number(base.hourly_rate) : u.hourly_rate);
    const newRole = role !== null ? role : u.account_role;
    await conn.query(
      `INSERT INTO employee_change_history (user_id, effective_from, job_position, hourly_rate, account_role, reason, changed_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [userId, eff, newPosition, newRate, newRole, reason, actor.id || null]);

    // The employee record shows what is in force today (a back-dated change must not override a later one).
    const now = await inForce(conn, userId, today);
    const curPosition = now ? now.job_position : newPosition;
    const curRate = now && now.hourly_rate != null ? now.hourly_rate : u.hourly_rate;
    await conn.query(
      'UPDATE `user` SET job_position = ?, hourly_rate = ?, account_role = ? WHERE user_id = ?',
      [curPosition, curRate, newRole, userId]);

    await conn.commit();
    return { userId, effectiveFrom: eff, jobPosition: curPosition, hourlyRate: curRate == null ? null : Number(curRate), role: newRole };
  } catch (err) {
    await conn.rollback();
    if (err.code === 'ER_NO_SUCH_TABLE') throw new AppError('The database needs its update first. Run the migration, then try again.', 503);
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { list, promote };
