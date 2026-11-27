// Time-in schedule: the opening time for time-ins (and an optional regular time-out) for a date range.
// A schedule with no end date stays in force until a newer one starts ("until changed").
const db = require('../config/db');
const { AppError } = require('../utils/http');
const { manilaParts } = require('../utils/time');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const hhmm = (t) => (t ? String(t).slice(0, 5) : null);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return String(d).slice(0, 10);
};
const minutes = (t) => {
  const [h, m] = String(t).split(':');
  return Number(h) * 60 + Number(m);
};
const label = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
};

const shape = (r) => ({
  id: r.schedule_id,
  effectiveFrom: ymd(r.effective_from),
  effectiveTo: ymd(r.effective_to),
  timeInOpens: hhmm(r.time_in_opens),
  regularTimeOut: hhmm(r.regular_time_out),
  otGraceMinutes: Number(r.ot_grace_minutes),
  createdAt: r.created_at,
});

// The schedule in force on a date (newest start date wins), or null. Safe if the table is not migrated yet.
async function forDate(date, conn = db) {
  try {
    const [rows] = await conn.query(
      `SELECT * FROM attendance_schedule
        WHERE effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)
        ORDER BY effective_from DESC, schedule_id DESC LIMIT 1`, [date, date]);
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.schedule_id,
      timeInOpens: String(r.time_in_opens),
      regularTimeOut: r.regular_time_out ? String(r.regular_time_out) : null,
      otGraceMinutes: Number(r.ot_grace_minutes),
    };
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return null;
    throw err;
  }
}

async function today() {
  const s = await forDate(manilaParts().date);
  return s ? { id: s.id, timeInOpens: hhmm(s.timeInOpens), regularTimeOut: hhmm(s.regularTimeOut), otGraceMinutes: s.otGraceMinutes } : null;
}

async function list() {
  let rows;
  try {
    [rows] = await db.query('SELECT * FROM attendance_schedule ORDER BY effective_from DESC, schedule_id DESC');
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return [];
    throw err;
  }
  const date = manilaParts().date;
  const current = await forDate(date);
  return rows.map((r) => {
    const s = shape(r);
    let status;
    if (s.effectiveFrom > date) status = 'Upcoming';
    else if (s.effectiveTo && s.effectiveTo < date) status = 'Expired';
    else status = current && current.id === s.id ? 'Current' : 'Superseded';
    return { ...s, status };
  });
}

async function create(input = {}, adminId) {
  const from = String(input.effectiveFrom || '');
  const to = input.effectiveTo ? String(input.effectiveTo) : null;
  const opens = String(input.timeInOpens || '');
  const out = input.regularTimeOut ? String(input.regularTimeOut) : null;
  const grace = input.otGraceMinutes === undefined || input.otGraceMinutes === null || input.otGraceMinutes === ''
    ? 15 : Number(input.otGraceMinutes);

  if (!DATE_RE.test(from)) throw new AppError('Start date must be YYYY-MM-DD.');
  if (to && !DATE_RE.test(to)) throw new AppError('End date must be YYYY-MM-DD.');
  if (to && to < from) throw new AppError('The end date cannot be before the start date.');
  if (!TIME_RE.test(opens)) throw new AppError('Opening time must be HH:MM.');
  if (out && !TIME_RE.test(out)) throw new AppError('Regular time-out must be HH:MM.');
  if (out && minutes(out) <= minutes(opens)) throw new AppError('The regular time-out must be after the opening time.');
  if (!Number.isInteger(grace) || grace < 0 || grace > 240) throw new AppError('Overtime grace must be 0 to 240 minutes.');

  const [r] = await db.query(
    `INSERT INTO attendance_schedule (effective_from, effective_to, time_in_opens, regular_time_out, ot_grace_minutes, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`, [from, to, `${opens}:00`, out ? `${out}:00` : null, grace, adminId || null]);
  const [[row]] = await db.query('SELECT * FROM attendance_schedule WHERE schedule_id = ?', [r.insertId]);
  return shape(row);
}

async function remove(id) {
  const [r] = await db.query('DELETE FROM attendance_schedule WHERE schedule_id = ?', [id]);
  if (!r.affectedRows) throw new AppError('Schedule not found', 404);
}

module.exports = { forDate, today, list, create, remove, minutes, label, ymd };
