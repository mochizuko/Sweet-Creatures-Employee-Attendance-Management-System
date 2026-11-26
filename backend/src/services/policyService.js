const db = require('../config/db');
const { manilaParts } = require('../utils/time');
const { AppError } = require('../utils/http');

const DEFAULTS = {
  version: 0, effectiveDate: null, shiftStart: '08:00', graceMinutes: 15,
  overtimeAfterHours: 8, standardShift: 8, otMultiplier: 1.25,
  lateRule: 'Deduct per minute late, after grace period',
  undertimeRule: 'Deduct per minute of early Time Out',
  overtimeRule: 'Overtime is paid at 1.25x after the standard shift',
};

const fromRow = (p) => ({
  version: p.policy_id,
  effectiveDate: p.effective_date,
  shiftStart: String(p.shift_start || '08:00:00').slice(0, 5),
  graceMinutes: p.grace_period_minutes,
  overtimeAfterHours: Number(p.overtime_threshold_hours),
  standardShift: Number(p.standard_shift_hours),
  otMultiplier: Number(p.ot_multiplier),
  lateRule: p.late_rule,
  undertimeRule: p.undertime_rule,
  overtimeRule: p.overtime_rule,
  savedBy: p.saved_by || null,
});

async function current(conn = db) {
  const [rows] = await conn.query('SELECT * FROM attendance_policy ORDER BY policy_id DESC LIMIT 1');
  return rows[0] ? fromRow(rows[0]) : { ...DEFAULTS };
}

async function history() {
  const [rows] = await db.query(
    `SELECT p.*, u.username AS saved_by FROM attendance_policy p
       JOIN \`user\` u ON u.user_id = p.updated_by_user_id
      ORDER BY p.policy_id DESC`
  );
  const list = rows.map(fromRow);
  return list.map((p, i) => ({ ...p, status: i === 0 ? 'Current' : 'Replaced' }));
}

// Every save creates a new version, so past policies stay on record.
async function save(input, userId) {
  const base = await current();
  const n = (v, fb) => (v === undefined || v === null || v === '' ? fb : Number(v));
  const grace = n(input.graceMinutes, base.graceMinutes);
  const ot = n(input.overtimeAfterHours, base.overtimeAfterHours);
  const std = n(input.standardShift, base.standardShift);
  const mult = n(input.otMultiplier, base.otMultiplier);
  const shiftStart = input.shiftStart || base.shiftStart;
  if (!/^\d{2}:\d{2}$/.test(shiftStart)) throw new AppError('shiftStart must be HH:MM');
  if (![grace, ot, std, mult].every(Number.isFinite) || grace < 0 || ot <= 0 || std <= 0 || mult < 1) {
    throw new AppError('Policy numbers are not valid');
  }
  const effective = /^\d{4}-\d{2}-\d{2}$/.test(input.effectiveDate || '') ? input.effectiveDate : manilaParts().date;
  await db.query(
    `INSERT INTO attendance_policy
       (grace_period_minutes, overtime_threshold_hours, late_rule, undertime_rule, overtime_rule,
        effective_date, updated_by_user_id, shift_start, standard_shift_hours, ot_multiplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [grace, ot, String(input.lateRule || base.lateRule).slice(0, 100),
     String(input.undertimeRule || base.undertimeRule).slice(0, 100),
     String(input.overtimeRule || base.overtimeRule).slice(0, 100),
     effective, userId, `${shiftStart}:00`, std, mult]
  );
  return current();
}

module.exports = { current, history, save, DEFAULTS };
