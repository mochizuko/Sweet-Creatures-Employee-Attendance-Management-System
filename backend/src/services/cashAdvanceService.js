const db = require('../config/db');
const { AppError } = require('../utils/http');
const { round2 } = require('../utils/time');

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
  cutoffId: r.cutoff_id, cutoff: cutoffLabel(r.start_date, r.end_date),
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

async function create({ userId, amount, dateGranted, cutoffId, notes }, adminId) {
  const amt = round2(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw new AppError('Amount must be greater than 0');
  if (!DATE_RE.test(dateGranted || '')) throw new AppError('dateGranted must be YYYY-MM-DD');

  const [[u]] = await db.query("SELECT user_id FROM `user` WHERE user_id = ? AND account_role = 'Staff'", [Number(userId)]);
  if (!u) throw new AppError('Staff member not found', 404);

  // The advance is deducted from one payroll cutoff: the one chosen, else the first open cutoff on/after the grant date.
  let cutoff;
  if (cutoffId) {
    [[cutoff]] = await db.query('SELECT * FROM payslip_cutoff WHERE cutoff_id = ?', [Number(cutoffId)]);
  } else {
    [[cutoff]] = await db.query(
      "SELECT * FROM payslip_cutoff WHERE status <> 'Closed' AND end_date >= ? ORDER BY start_date LIMIT 1", [dateGranted]);
  }
  if (!cutoff) throw new AppError('No open payroll cutoff found. Create the cutoff first.', 409);
  if (cutoff.status === 'Closed') throw new AppError('That cutoff is already closed', 409);

  const [r] = await db.query(
    `INSERT INTO cash_advance (user_id, cutoff_id, amount, date_granted, status, recorded_by_user_id, notes)
     VALUES (?, ?, ?, ?, 'Pending', ?, ?)`,
    [u.user_id, cutoff.cutoff_id, amt, dateGranted, adminId, String(notes || '').slice(0, 255) || null]);
  const [[row]] = await db.query(`${SELECT} WHERE ca.cash_advance_id = ?`, [r.insertId]);
  return shape(row);
}

async function setStatus(id, { status, notes }) {
  if (!STATUSES.includes(status)) throw new AppError('status must be Pending, Approved or Rejected');
  const [[cur]] = await db.query('SELECT status FROM cash_advance WHERE cash_advance_id = ?', [id]);
  if (!cur) throw new AppError('Cash advance not found', 404);
  if (cur.status === 'Deducted') throw new AppError('Already deducted in a finalized payroll', 409);
  await db.query('UPDATE cash_advance SET status = ?, notes = COALESCE(?, notes) WHERE cash_advance_id = ?',
    [status, notes ? String(notes).slice(0, 255) : null, id]);
  const [[row]] = await db.query(`${SELECT} WHERE ca.cash_advance_id = ?`, [id]);
  return shape(row);
}

module.exports = { list, mine, create, setStatus };
