// All attendance dates/times are stored in Philippine time (Asia/Manila),
// no matter what timezone the server container runs in (AWS Fargate = UTC).
const TZ = 'Asia/Manila';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function manilaParts(d = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

const toIso = (date, time) => `${date}T${String(time).slice(0, 8)}+08:00`;
const secs = (t) => { const [h, m, s = 0] = String(t).split(':').map(Number); return h * 3600 + m * 60 + s; };
const minutesOf = (t) => Math.floor(secs(t) / 60);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const isWeekday = (dateStr) => { const w = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); return w >= 1 && w <= 5; };

// Hours worked between time-in and time-out, minus the break.
function workedHours(inT, outT, breakStart, breakEnd) {
  let span = secs(outT) - secs(inT);
  if (span < 0) span += 86400;
  if (breakStart && breakEnd) {
    let b = secs(breakEnd) - secs(breakStart);
    if (b < 0) b += 86400;
    span -= b;
  }
  return round2(Math.max(0, span) / 3600);
}

module.exports = { manilaParts, toIso, secs, minutesOf, round2, addDays, isWeekday, workedHours };
