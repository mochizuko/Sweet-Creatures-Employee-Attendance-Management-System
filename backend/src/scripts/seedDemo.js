// Demo data for the presentation. Safe to run again (skips what already exists).
//   SEED_STAFF_PIN=<4-6 digits> node src/scripts/seedDemo.js
// Creates 4 staff, policy, SOPs, Nov 2026 cutoffs, attendance history and cash advances.
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { manilaParts, addDays, isWeekday, workedHours, round2 } = require('../utils/time');

const STAFF = [
  { first: 'Kaye', last: 'Nieves', username: 'kaye', position: 'Barista', rate: 95 },
  { first: 'Lysa', last: 'Pido', username: 'lysa.pido', position: 'Cashier', rate: 90 },
  { first: 'Trishia', last: 'Maralit', username: 'trishia', position: 'Kitchen Staff', rate: 95 },
  { first: 'Grace', last: 'Delacruz', username: 'grace', position: 'Barista', rate: 90 },
];

const hms = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`;

async function main() {
  const pin = process.env.SEED_STAFF_PIN || '';
  if (!/^\d{4,6}$/.test(pin)) throw new Error('Set SEED_STAFF_PIN to a 4-6 digit PIN.');

  const [[admin]] = await db.query("SELECT user_id FROM `user` WHERE account_role = 'Admin' AND account_status = 'Active' ORDER BY user_id DESC LIMIT 1");
  if (!admin) throw new Error('No active admin found.');
  const adminId = admin.user_id;
  const today = manilaParts().date;

  // Policy + SOPs
  const [[pol]] = await db.query('SELECT COUNT(*) AS n FROM attendance_policy');
  if (!pol.n) {
    await db.query(
      `INSERT INTO attendance_policy (grace_period_minutes, overtime_threshold_hours, late_rule, undertime_rule, overtime_rule,
                                      effective_date, updated_by_user_id, shift_start, standard_shift_hours, ot_multiplier)
       VALUES (15, 8, 'Deduct per minute late, after grace period', 'Deduct per minute of early Time Out',
               'Overtime is paid at 1.25x after the standard shift', '2026-11-01', ?, '08:00:00', 8, 1.25)`, [adminId]);
    console.log('policy created');
  }
  const [[sopN]] = await db.query('SELECT COUNT(*) AS n FROM sop_document');
  if (!sopN.n) {
    const sops = [
      ['Opening Procedure', 'Arrive 10 minutes before your shift.\n- Turn on the lights and equipment\n- Check the display and restock\n- Clock in with your photo'],
      ['Customer Service Standards', 'Greet every guest within 30 seconds.\n- Smile and make eye contact\n- Repeat the order back\n- Thank every guest'],
      ['Staff Conduct Policy', 'Be on time, be respectful, and keep your station clean.\n- Phones stay in your locker during shifts\n- Report problems to the owner'],
    ];
    for (const [t, c] of sops) {
      await db.query("INSERT INTO sop_document (title, content, version, updated_by_user_id, status) VALUES (?, ?, '1', ?, 'published')", [t, c, adminId]);
    }
    console.log('SOPs created');
  }

  // Cutoffs
  for (const [s, e] of [['2026-11-01', '2026-11-15'], ['2026-11-16', '2026-11-30']]) {
    await db.query("INSERT IGNORE INTO payslip_cutoff (start_date, end_date, status) VALUES (?, ?, 'Open')", [s, e]);
  }
  const [cutoffs] = await db.query('SELECT * FROM payslip_cutoff ORDER BY start_date');
  const cut1 = cutoffs.find((c) => c.start_date === '2026-11-01');
  const cut2 = cutoffs.find((c) => c.start_date === '2026-11-16');

  // Staff
  const hash = await bcrypt.hash(pin, 10);
  const ids = {};
  for (const s of STAFF) {
    const [ex] = await db.query('SELECT user_id FROM `user` WHERE username = ?', [s.username]);
    if (ex.length) { ids[s.username] = ex[0].user_id; continue; }
    const [r] = await db.query(
      `INSERT INTO \`user\` (account_role, first_name, last_name, username, email, pin_hash, job_position, hourly_rate)
       VALUES ('Staff', ?, ?, ?, ?, ?, ?, ?)`,
      [s.first, s.last, s.username, `${s.username}@sweetcreatures.example`, hash, s.position, s.rate]);
    ids[s.username] = r.insertId;
    console.log(`staff created: ${s.first} ${s.last} (${s.username})`);
  }

  // Attendance history: weekdays from Nov 2 up to yesterday
  const flaggedPlan = {
    // [username, date] -> what to leave flagged
    'kaye|2026-11-24': { kind: 'missed_out', review: 'Pending' },
    'trishia|2026-11-23': { kind: 'offline', review: 'Pending' },
    'grace|2026-11-18': { kind: 'missed_out', review: 'Approved', timeOut: '17:00', notes: 'Forgot to time out; confirmed with owner.' },
    'lysa.pido|2026-11-12': { kind: 'missed_out', review: 'Rejected', notes: 'Could not be verified.' },
  };
  const absent = new Set(['lysa.pido|2026-11-10', 'grace|2026-11-05', 'trishia|2026-11-17']);
  const now = manilaParts();

  for (const [ui, s] of STAFF.entries()) {
    const uid = ids[s.username];
    const [[have]] = await db.query("SELECT COUNT(*) AS n FROM attendance_record WHERE user_id = ? AND attendance_date >= '2026-11-01'", [uid]);
    if (have.n) continue;
    let d = '2026-11-02';
    for (let i = 0; d < today; d = addDays(d, 1), i++) {
      if (!isWeekday(d)) continue;
      const key = `${s.username}|${d}`;
      if (absent.has(key)) continue;
      const plan = flaggedPlan[key];
      const day = Number(d.slice(8));
      const late = (day + ui) % 7 === 0;                         // roughly one late day per week
      const inMin = late ? 8 * 60 + 25 + ((day * 3) % 12) : 7 * 60 + 50 + ((day * 5 + ui * 2) % 20);
      const otDay = (day + ui) % 5 === 0;                        // some overtime
      const outMin = 17 * 60 + (otDay ? 30 : 0) + ((day + ui) % 3);
      const timeIn = hms(inMin), bs = '12:00:00', be = '13:00:00';
      let timeOut = hms(outMin);
      let hours = null, ot = 0, ut = 0, review = 'None', reason = null, notes = null;

      if (plan && plan.kind === 'missed_out') {
        review = plan.review; reason = 'Missed Time Out'; notes = plan.notes || null;
        timeOut = plan.review === 'Approved' ? `${plan.timeOut}:00` : null;
      }
      if (plan && plan.kind === 'offline') { review = plan.review; reason = 'Logged while offline'; }
      if (timeOut) {
        hours = workedHours(timeIn, timeOut, bs, be);
        ot = round2(Math.max(0, hours - 8));
        ut = round2(Math.max(0, 8 - hours));
      }
      await db.query(
        `INSERT INTO attendance_record (user_id, attendance_date, time_in, time_out, break_start, return_from_break,
                total_hours_worked, overtime_hours, undertime_hours, status, review_status, flag_reason, review_notes,
                reviewed_by_user_id, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [uid, d, timeIn, timeOut, bs, timeOut ? be : null, hours, ot, ut, late ? 'Late' : 'OnTime', review, reason, notes,
         ['Approved', 'Rejected'].includes(review) ? adminId : null,
         ['Approved', 'Rejected'].includes(review) ? `${now.date} ${now.time}` : null]);
    }
    console.log(`attendance seeded: ${s.first}`);
  }

  // Cash advances (one per status so the whole flow can be shown)
  const [[caN]] = await db.query('SELECT COUNT(*) AS n FROM cash_advance');
  if (!caN.n) {
    const adv = [
      ['kaye', cut1, 500, '2026-11-03', 'Approved', 'For tuition'],
      ['lysa.pido', cut1, 300, '2026-11-06', 'Pending', null],
      ['trishia', cut2, 400, '2026-11-20', 'Approved', null],
      ['grace', cut2, 200, '2026-11-22', 'Rejected', 'Exceeds allowed advance'],
    ];
    for (const [u, c, amt, dt, st, nt] of adv) {
      await db.query(
        'INSERT INTO cash_advance (user_id, cutoff_id, amount, date_granted, status, recorded_by_user_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [ids[u], c.cutoff_id, amt, dt, st, adminId, nt]);
    }
    console.log('cash advances created');
  }
  console.log('Seed complete.');
  process.exit(0);
}

main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
