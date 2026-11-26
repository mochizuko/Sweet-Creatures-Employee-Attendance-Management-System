const db = require('../config/db');
const { AppError } = require('../utils/http');
const { round2 } = require('../utils/time');
const policyService = require('./policyService');
const payrollService = require('./payrollService');

const MAX_ADVANCE = 1640; // pesos per cutoff, or 50% of projected pay if lower

const STATUSES = ['Pending', 'Approved', 'Rejected'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const fullName = (u) => [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ');

const cutoffLabel = (s, e) => {
  const f = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(s)} - ${f(e)}, ${String(e).slice(0, 4)}`;
};

const shape = (r) => ({
  id: r.cash_advance_id, userId: r.user_id, staffName: r.first_name ? fullName(r) : undefined,
  amount: Number(r.amount), dateGranted: r.date_granted, status: r.status, notes: r.notes || '',
  cutoffId: r.cutoff_id, cutoff: cutoffLabel(r.start_date, r.end_date), cutoffValue: `${r.start_date}|${r.end_date}`,
});

const SELECT = `SELECT ca.*, c.start_date, c.end_date, u.first_name, u.middle_name, u.last_name
                  FROM cash_advance ca
                  JOIN payslip_cutoff c ON c.cutoff_id = ca.cutoff_id
                  JOIN \`user\` u ON u.user_id = ca.user_id`;

async function list({ status } = {}) {
  const [rows] = await db.query(
    `${SELECT} ${STATUSES.concat('Deducted').includes(status) ? 'WHERE ca.status = ?' : ''} ORDER BY ca.date_granted DESC, ca.cash_advance_id DESC`,
    STATUSES.concat('Deducted').includes(status) ? [status] : []);
  return rows.map(shape);
}

async function mine(userId) {
  const [rows] = await db.query(`${SELECT} WHERE ca.user_id = ? ORDER BY ca.date_granted DESC, ca.cash_advance_id DESC`, [userId]);
  return rows.map(shape);
}

// How much more this person may borrow for a cutoff.
async function available(userId, cutoffId, exceptId = 0) {
  const [[u]] = await db.query('SELECT hourly_rate FROM `user` WHERE user_id = ?', [userId]);
  const policy = await policyService.current();
  const projected = Number(u?.hourly_rate || 0) * policy.standardShift * 10;   // about 10 working days per cutoff
  const max = Math.min(MAX_ADVANCE, round2(projected * 0.5));
  let reserved = 0;
  if (cutoffId) {
    const [[r]] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM cash_advance
        WHERE user_id = ? AND cutoff_id = ? AND cash_advance_id <> ? AND status IN ('Pending','Approved','Deducted')`,
      [userId, cutoffId, exceptId]);
    reserved = round2(r.total);
  }
  return { max, reserved, available: Math.max(0, round2(max - reserved)) };
}

async function limit({ userId, start, end }) {
  let cutoffId = null;
  if (DATE_RE.test(start || '') && DATE_RE.test(end || '')) {
    const [[c]] = await db.query('SELECT cutoff_id FROM payslip_cutoff WHERE start_date = ? AND end_date = ?', [start, end]);
    cutoffId = c ? c.cutoff_id : null;
  }
  return available(Number(userId), cutoffId);
}

async function create({ userId, amount, dateGranted, cutoffId, cutoffStart, cutoffEnd, notes }, adminId) {
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new AppError('Amount must be greater than 0');
  if (!DATE_RE.test(dateGranted || '')) throw new AppError('dateGranted must be YYYY-MM-DD');

  const [[u]] = await db.query("SELECT user_id FROM `user` WHERE user_id = ? AND account_role = 'Staff'", [Number(userId)]);
  if (!u) throw new AppError('Staff member not found', 404);

  // The advance is deducted from one payroll cutoff: the one chosen, else the first open cutoff on/after the grant date.
  let cutoff;
  if (DATE_RE.test(cutoffStart || '') && DATE_RE.test(cutoffEnd || '')) {
    cutoff = await payrollService.ensureCutoff({ start_date: cutoffStart, end_date: cutoffEnd });
  } else if (cutoffId) {
    [[cutoff]] = await db.query('SELECT * FROM payslip_cutoff WHERE cutoff_id = ?', [Number(cutoffId)]);
  } else {
    [[cutoff]] = await db.query(
      "SELECT * FROM payslip_cutoff WHERE status <> 'Closed' AND end_date >= ? ORDER BY start_date LIMIT 1", [dateGranted]);
  }
  if (!cutoff) throw new AppError('No open payroll cutoff found. Create the cutoff first.', 409);
  if (cutoff.status === 'Closed') throw new AppError('That cutoff is already closed', 409);
  const lim = await available(u.user_id, cutoff.cutoff_id);
  if (amt > lim.available) {
    throw new AppError(`Cash advance must be no more than PHP ${lim.available.toFixed(2)} for this cutoff (the lower of PHP 1,640.00 or 50% of projected pay).`, 409);
  }

  const [r] = await db.query(
    `INSERT INTO cash_advance (user_id, cutoff_id, amount, date_granted, status, recorded_by_user_id, notes)
     VALUES (?, ?, ?, ?, 'Pending', ?, ?)`,
    [u.user_id, cutoff.cutoff_id, amt, dateGranted, adminId, String(notes || '').slice(0, 255) || null]);
  const [[row]] = await db.query(`${SELECT} WHERE ca.cash_advance_id = ?`, [r.insertId]);
  return shape(row);
}

async function setStatus(id, { status, notes }) {
  if (!STATUSES.includes(status)) throw new AppError('status must be Pending, Approved or Rejected');
  const [[cur]] = await db.query('SELECT status, user_id, cutoff_id, amount FROM cash_advance WHERE cash_advance_id = ?', [id]);
  if (!cur) throw new AppError('Cash advance not found', 404);
  if (cur.status === 'Deducted') throw new AppError('Already deducted in a finalized payroll', 409);
  if (status === 'Approved') {
    const lim = await available(cur.user_id, cur.cutoff_id, id);
    if (Number(cur.amount) > lim.available) {
      throw new AppError(`Cannot approve. The maximum is PHP ${lim.available.toFixed(2)} for this cutoff.`, 409);
    }
  }
  await db.query('UPDATE cash_advance SET status = ?, notes = COALESCE(?, notes) WHERE cash_advance_id = ?',
    [status, notes ? String(notes).slice(0, 255) : null, id]);
  const [[row]] = await db.query(`${SELECT} WHERE ca.cash_advance_id = ?`, [id]);
  return shape(row);
}

module.exports = { list, mine, create, setStatus, limit };
