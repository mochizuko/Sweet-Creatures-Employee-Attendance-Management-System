const db = require('../config/db');
const policyService = require('./policyService');
const scheduleService = require('./scheduleService');
const { AppError } = require('../utils/http');
const { manilaParts, toIso, minutesOf, round2, addDays, workedHours } = require('../utils/time');

const ACTIONS = ['time_in', 'break_start', 'break_end', 'time_out'];
const MAX_PHOTO_CHARS = 1500000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const flagOf = (r) => (r.review_status && r.review_status !== 'None' ? r.review_status.toLowerCase() : null);
const fullName = (u) => [u.first_name, u.middle_name, u.last_name].filter(Boolean).join(' ');
const hhmm = (t) => (t ? String(t).slice(0, 5) : null);

// Shape the staff PWA expects: one object per action.
function eventShape(rec, action, clientId, userId, withFlag) {
  const t = { time_in: rec.time_in, break_start: rec.break_start, break_end: rec.return_from_break, time_out: rec.time_out }[action];
  const flag = withFlag ? flagOf(rec) : null;
  return {
    clientId,
    staffId: String(userId),
    date: rec.attendance_date,
    action,
    timestamp: toIso(rec.attendance_date, t),
    status: action === 'time_in' ? (rec.status === 'Late' ? 'late' : 'ontime') : null,
    flag,
    flagReason: flag ? rec.flag_reason : null,
    flagRemarks: flag ? rec.review_notes : null,
    syncedAt: new Date().toISOString(),
  };
}

function totals(hours, policy) {
  return {
    total: hours,
    overtime: round2(Math.max(0, hours - policy.overtimeAfterHours)),
    undertime: round2(Math.max(0, policy.standardShift - hours)),
  };
}

/* ---------------------------- Staff: submit ---------------------------- */

async function recordEvent(user, input = {}) {
  const { clientId, action, photo } = input;
  if (!ACTIONS.includes(action)) throw new AppError('Unknown action.', 400, 'invalid');
  if (!clientId || String(clientId).length > 64) throw new AppError('clientId is required.', 400, 'invalid');

  const needsPhoto = action === 'time_in' || action === 'time_out';
  if (needsPhoto) {
    if (typeof photo !== 'string' || !photo.startsWith('data:image/')) throw new AppError('A photo is required.', 400, 'invalid');
    if (photo.length > MAX_PHOTO_CHARS) throw new AppError('Photo is too large.', 413, 'invalid');
  }

  // Offline entries keep their original time (within 7 days); online ones use the server clock.
  const offline = input.source === 'offline';
  let when = new Date();
  if (offline && input.timestamp) {
    const t = new Date(input.timestamp);
    const now = Date.now();
    if (!Number.isNaN(t.getTime()) && t.getTime() <= now + 5 * 60000 && t.getTime() >= now - 7 * 86400000) when = t;
  }
  const { date, time } = manilaParts(when);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Same clientId sent twice (retry after a dropped connection) -> return the saved result.
    const [dupe] = await conn.query('SELECT record_id FROM attendance_event WHERE client_id = ?', [clientId]);
    if (dupe.length) {
      const [[r]] = await conn.query('SELECT * FROM attendance_record WHERE record_id = ?', [dupe[0].record_id]);
      await conn.rollback();
      return eventShape(r, action, clientId, user.id, true);
    }

    const policy = await policyService.current(conn);
    let recordId;

    if (action === 'time_in') {
      const [ex] = await conn.query(
        'SELECT record_id FROM attendance_record WHERE user_id = ? AND attendance_date = ? FOR UPDATE', [user.id, date]);
      if (ex.length) throw new AppError('You already timed in today.', 409, 'invalid');
      // Time-in schedule: online time-ins before the opening time are refused; offline ones are kept but flagged.
      const schedule = await scheduleService.forDate(date, conn);
      const opensLabel = schedule ? scheduleService.label(schedule.timeInOpens) : null;
      const beforeOpening = !!schedule && scheduleService.minutes(time) < scheduleService.minutes(schedule.timeInOpens);
      if (beforeOpening && !offline) throw new AppError(`Time in opens at ${opensLabel}.`, 409, 'invalid');
      const flagReason = [offline ? 'Logged while offline' : null, beforeOpening ? `Timed in before opening time (${opensLabel})` : null]
        .filter(Boolean).join('; ') || null;
      const late = minutesOf(time) > minutesOf(policy.shiftStart) + policy.graceMinutes;
      const [r] = await conn.query(
        `INSERT INTO attendance_record (user_id, attendance_date, time_in, status, review_status, flag_reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [user.id, date, time, late ? 'Late' : 'OnTime', flagReason ? 'Pending' : 'None', flagReason]
      );
      recordId = r.insertId;
    } else {
      const [rows] = await conn.query(
        `SELECT * FROM attendance_record
          WHERE user_id = ? AND time_in IS NOT NULL AND time_out IS NULL
          ORDER BY attendance_date DESC, record_id DESC LIMIT 1 FOR UPDATE`, [user.id]);
      const open = rows[0];
      if (!open) throw new AppError('Time in first.', 409, 'invalid');
      recordId = open.record_id;

      if (action === 'break_start') {
        if (open.break_start) throw new AppError('You can’t start a break right now.', 409, 'invalid');
        await conn.query('UPDATE attendance_record SET break_start = ? WHERE record_id = ?', [time, recordId]);
      } else if (action === 'break_end') {
        if (!open.break_start || open.return_from_break) throw new AppError('You are not on a break.', 409, 'invalid');
        await conn.query('UPDATE attendance_record SET return_from_break = ? WHERE record_id = ?', [time, recordId]);
      } else {
        if (open.break_start && !open.return_from_break) throw new AppError('Finish your break before timing out.', 409, 'invalid');
        let hours = workedHours(open.time_in, time, open.break_start, open.return_from_break);

        // Time-outs after the regular time-out (plus grace): hours past it are held as overtime pending approval.
        let otPending = 0;
        const shiftDate = scheduleService.ymd(open.attendance_date);
        const schedule = await scheduleService.forDate(shiftDate, conn);
        if (schedule && schedule.regularTimeOut && date === shiftDate
            && scheduleService.minutes(open.time_in) < scheduleService.minutes(schedule.regularTimeOut)
            && scheduleService.minutes(time) > scheduleService.minutes(schedule.regularTimeOut) + schedule.otGraceMinutes) {
          const regular = workedHours(open.time_in, schedule.regularTimeOut, open.break_start, open.return_from_break);
          if (Number.isFinite(regular) && regular >= 0 && hours > regular) {
            otPending = round2(hours - regular);
            hours = round2(regular);
          }
        }

        const t = totals(hours, policy);
        await conn.query(
          `UPDATE attendance_record
              SET time_out = ?, total_hours_worked = ?, overtime_hours = ?, undertime_hours = ?
            WHERE record_id = ?`, [time, t.total, t.overtime, t.undertime, recordId]);
        if (otPending > 0) {
          const reason = [open.flag_reason, `Overtime pending approval (${otPending} h)`].filter(Boolean).join('; ').slice(0, 150);
          await conn.query(
            "UPDATE attendance_record SET ot_pending_hours = ?, review_status = 'Pending', flag_reason = ? WHERE record_id = ?",
            [otPending, reason, recordId]);
        }
      }
    }

    if (needsPhoto) {
      const [p] = await conn.query(
        "INSERT INTO attendance_photo (record_id, photo_url, photo_data, captured_at, photo_type) VALUES (?, 'pending', ?, ?, ?)",
        [recordId, photo, `${date} ${time}`, action === 'time_in' ? 'TimeIn' : 'TimeOut']);
      await conn.query('UPDATE attendance_photo SET photo_url = ? WHERE photo_id = ?', [`db:${p.insertId}`, p.insertId]);
    }

    if (offline) {
      const now = manilaParts();
      await conn.query(
        "UPDATE attendance_record SET review_status = 'Pending', flag_reason = 'Logged while offline' WHERE record_id = ? AND review_status = 'None'",
        [recordId]);
      await conn.query(
        `INSERT INTO attendance_sync (record_id, sync_timestamp, offline_captured, sync_status, flagged_for_review)
         VALUES (?, ?, 1, 'Synced', 1)`, [recordId, `${now.date} ${now.time}`]);
    }

    await conn.query('INSERT INTO attendance_event (client_id, record_id, action) VALUES (?, ?, ?)', [clientId, recordId, action]);

    const [[saved]] = await conn.query('SELECT * FROM attendance_record WHERE record_id = ?', [recordId]);
    await conn.commit();
    return eventShape(saved, action, clientId, user.id, true);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ---------------------------- Staff: own log --------------------------- */

async function mine(userId) {
  const from = addDays(manilaParts().date, -60);
  const [rows] = await db.query(
    'SELECT * FROM attendance_record WHERE user_id = ? AND attendance_date >= ? ORDER BY attendance_date, record_id', [userId, from]);
  const out = [];
  for (const r of rows) {
    const evs = [['time_in', r.time_in], ['break_start', r.break_start], ['break_end', r.return_from_break], ['time_out', r.time_out]]
      .filter(([, t]) => t);
    evs.forEach(([a], i) => out.push(eventShape(r, a, `r${r.record_id}-${a}`, userId, i === 0)));
  }
  return out;
}

/* ------------------------------ Admin views ---------------------------- */

// A shift that was never closed on a past day becomes a flagged item for the owner.
async function flagStale(today) {
  await db.query(
    `UPDATE attendance_record
        SET review_status = 'Pending', flag_reason = 'Missed Time Out'
      WHERE time_in IS NOT NULL AND time_out IS NULL AND attendance_date < ? AND review_status = 'None'`, [today]);
}

async function day(dateInput) {
  const today = manilaParts().date;
  const date = DATE_RE.test(dateInput || '') ? dateInput : today;
  await flagStale(today);

  const [staff] = await db.query(
    `SELECT user_id, first_name, middle_name, last_name, job_position FROM \`user\`
      WHERE account_role = 'Staff' AND account_status = 'Active' ORDER BY last_name, first_name`);
  const [recs] = await db.query('SELECT * FROM attendance_record WHERE attendance_date = ?', [date]);
  const byUser = new Map(recs.map((r) => [r.user_id, r]));

  const rows = staff.map((s) => {
    const r = byUser.get(s.user_id);
    let status;
    if (r) status = r.review_status === 'Pending' ? 'Flagged' : r.status;
    else status = date < today ? 'Absent' : date === today ? 'Not in yet' : '—';
    return {
      userId: s.user_id, name: fullName(s), position: s.job_position || '',
      recordId: r ? r.record_id : null,
      timeIn: r ? hhmm(r.time_in) : null, timeOut: r ? hhmm(r.time_out) : null,
      breakStart: r ? hhmm(r.break_start) : null, breakEnd: r ? hhmm(r.return_from_break) : null,
      hours: r && r.total_hours_worked != null ? Number(r.total_hours_worked) : null,
      status, flagReason: r ? r.flag_reason : null,
    };
  });
  const count = (s) => rows.filter((x) => x.status === s).length;
  return {
    date, isToday: date === today,
    summary: {
      total: rows.length, present: recs.length,
      onTime: count('OnTime'), late: count('Late'), flagged: count('Flagged'),
      absent: count('Absent'),
    },
    rows,
  };
}

async function flagged({ status } = {}) {
  await flagStale(manilaParts().date);
  const where = ["ar.review_status <> 'None'"];
  const params = [];
  if (['Pending', 'Approved', 'Rejected'].includes(status)) { where.push('ar.review_status = ?'); params.push(status); }
  const [rows] = await db.query(
    `SELECT ar.*, u.first_name, u.middle_name, u.last_name
       FROM attendance_record ar JOIN \`user\` u ON u.user_id = ar.user_id
      WHERE ${where.join(' AND ')}
      ORDER BY ar.attendance_date DESC, ar.record_id DESC LIMIT 200`, params);
  return rows.map((r) => ({
    id: r.record_id, userId: r.user_id, name: fullName(r), date: r.attendance_date,
    timeIn: hhmm(r.time_in), timeOut: hhmm(r.time_out), reason: r.flag_reason || 'Flagged', otHours: Number(r.ot_pending_hours || 0),
    status: r.review_status, notes: r.review_notes || '', reviewedAt: r.reviewed_at,
  }));
}

async function review(recordId, adminId, { decision, notes, timeOut } = {}) {
  if (!['Approved', 'Rejected'].includes(decision)) throw new AppError('decision must be Approved or Rejected');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [[r]] = await conn.query('SELECT * FROM attendance_record WHERE record_id = ? FOR UPDATE', [recordId]);
    if (!r) throw new AppError('Record not found', 404);
    if (r.review_status !== 'Pending') throw new AppError('Only pending items can be reviewed', 409);

    const now = manilaParts();
    // Approving a missed Time Out: the owner supplies the real time out so hours can be counted.
    if (decision === 'Approved' && /^\d{2}:\d{2}$/.test(timeOut || '') && r.time_in && !r.time_out) {
      const policy = await policyService.current(conn);
      const hours = workedHours(r.time_in, `${timeOut}:00`, r.break_start, r.return_from_break);
      const t = totals(hours, policy);
      await conn.query(
        'UPDATE attendance_record SET time_out = ?, total_hours_worked = ?, overtime_hours = ?, undertime_hours = ? WHERE record_id = ?',
        [`${timeOut}:00`, t.total, t.overtime, t.undertime, recordId]);
    }
    // Approving held overtime adds those hours to the paid totals. Rejecting leaves only the regular hours.
    const otPending = Number(r.ot_pending_hours || 0);
    if (decision === 'Approved' && otPending > 0 && r.time_out) {
      const policy = await policyService.current(conn);
      const full = round2(Number(r.total_hours_worked || 0) + otPending);
      const t = totals(full, policy);
      await conn.query(
        'UPDATE attendance_record SET total_hours_worked = ?, overtime_hours = ?, undertime_hours = ?, ot_approved_hours = ? WHERE record_id = ?',
        [t.total, t.overtime, t.undertime, otPending, recordId]);
    }
    await conn.query(
      `UPDATE attendance_record
          SET review_status = ?, review_notes = ?, reviewed_by_user_id = ?, reviewed_at = ?
        WHERE record_id = ?`,
      [decision, String(notes || '').slice(0, 255) || null, adminId, `${now.date} ${now.time}`, recordId]);
    await conn.commit();
    return { id: recordId, status: decision };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function photos(recordId) {
  const [rows] = await db.query(
    'SELECT photo_id, photo_type, captured_at, photo_data FROM attendance_photo WHERE record_id = ? ORDER BY photo_id', [recordId]);
  return rows.map((p) => ({ id: p.photo_id, type: p.photo_type, capturedAt: p.captured_at, data: p.photo_data }));
}

// Plain history list (admin), filterable by date range / staff member.
async function list({ date_from, date_to, user_id } = {}) {
  const where = [];
  const params = [];
  if (DATE_RE.test(date_from || '')) { where.push('ar.attendance_date >= ?'); params.push(date_from); }
  if (DATE_RE.test(date_to || '')) { where.push('ar.attendance_date <= ?'); params.push(date_to); }
  if (user_id) { where.push('ar.user_id = ?'); params.push(Number(user_id)); }
  const [rows] = await db.query(
    `SELECT ar.*, u.first_name, u.middle_name, u.last_name
       FROM attendance_record ar JOIN \`user\` u ON u.user_id = ar.user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ar.attendance_date DESC, u.last_name LIMIT 500`, params);
  return rows.map((r) => ({
    id: r.record_id, userId: r.user_id, name: fullName(r), date: r.attendance_date,
    timeIn: hhmm(r.time_in), timeOut: hhmm(r.time_out), hours: r.total_hours_worked != null ? Number(r.total_hours_worked) : null,
    overtime: Number(r.overtime_hours), undertime: Number(r.undertime_hours),
    status: r.status, review: r.review_status, reason: r.flag_reason,
  }));
}

module.exports = { recordEvent, mine, day, flagged, review, photos, list };
