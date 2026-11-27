(() => {
  'use strict';
  const API = window.SCApi;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const hhmm = v => { const d = new Date(v); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const longDay = d => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  const shortDay = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const monDay = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const monYear = v => { const d = new Date(v); return isNaN(d) ? String(v || '') : d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };
  const keyToDate = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const fmtDur = ms => { const m = Math.round(ms / 60000); return `${Math.floor(m / 60)}h ${pad(m % 60)}m`; };
  const chip = (t, c = '') => `<span class="chip ${c}">${esc(t)}</span>`;
  const LABEL = { time_in: 'Time In', time_out: 'Time Out', break_start: 'Start Break', break_end: 'Return from Break' };

  const state = { user: null, records: [], queue: [], policy: API.defaultPolicy, sops: [], payslips: [], advances: [], selectedSop: null, sopQuery: '', tab: 'home', busy: false, syncing: false, lastSync: null };
  let cap = null; 

  /* ---------- derived data ---------- */
  function allItems() {
    const seen = new Set(), out = [];
    for (const r of state.records) { seen.add(r.clientId); out.push({ ...r, queued: false }); }
    for (const q of state.queue) {
      if (seen.has(q.clientId)) continue;
      out.push({ ...q, status: q.action === 'time_in' ? API.statusFor(q.timestamp, state.policy) : null, flag: null, queued: true });
    }
    return out.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }
  function byDay(items) {
    const m = new Map();
    for (const i of items) { if (!m.has(i.date)) m.set(i.date, []); m.get(i.date).push(i); }
    return m;
  }
  function sumDay(list) {
    const f = a => list.find(i => i.action === a);
    const s = { tin: f('time_in'), tout: f('time_out'), bs: f('break_start'), be: f('break_end'), list };
    s.canIn = !s.tin;
    s.canOut = !!s.tin && !s.tout && (!s.bs || !!s.be);
    s.canBreak = !!s.tin && !s.tout && !s.bs;
    s.canReturn = !!s.bs && !s.be && !s.tout;
    return s;
  }
  function workedMs(s, live) {
    if (!s.tin) return 0;
    const end = s.tout ? new Date(s.tout.timestamp) : (live ? new Date() : null);
    if (!end) return 0;
    let ms = end - new Date(s.tin.timestamp);
    if (s.bs) {
      const bEnd = s.be ? new Date(s.be.timestamp) : end;
      ms -= Math.max(0, bEnd - new Date(s.bs.timestamp));
    }
    return Math.max(0, ms);
  }
  function cutoffRange(d = new Date()) {
    const y = d.getFullYear(), m = d.getMonth();
    return d.getDate() <= 15 ? [new Date(y, m, 1), new Date(y, m, 15)] : [new Date(y, m, 16), new Date(y, m + 1, 0)];
  }
  function periodStats(a, b, items) {
    const todayK = API.dayKey(new Date());
    let ms = 0, days = 0, late = 0;
    for (const [k, list] of byDay(items)) {
      const d = keyToDate(k);
      if (d < a || d > b) continue;
      const s = sumDay(list);
      if (s.tin) { days++; if (s.tin.status === 'late') late++; }
      ms += workedMs(s, k === todayK);
    }
    return { ms, days, late };
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function flagChip(i) {
    if (i.flag === 'pending') return chip('Flagged · Pending', 'amber');
    if (i.flag === 'approved') return chip('Approved', 'green');
    if (i.flag === 'rejected') return chip('Rejected', 'red');
    return '';
  }

  /* ---------- screens ---------- */
  function showLogin() { location.replace('index.html'); } // single login panel lives on the landing page
  function showApp() { $('#app').hidden = false; go(state.tab); }

  function go(tab) {
    state.tab = tab;
    $$('.view').forEach(v => v.hidden = v.id !== 'view-' + tab);
    $$('.tab').forEach(t => t.dataset.tab === tab ? t.setAttribute('aria-current', 'page') : t.removeAttribute('aria-current'));
    renderAll();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    const first = (state.user?.name || '').split(' ')[0] || 'there';
    $('#title').textContent = { home: `Hello, ${first}`, log: 'Attendance log', pay: 'Payslips', cash: 'Cash advances', sop: 'SOP Management', sync: 'Sync status' }[state.tab];
    const n = state.queue.length;
    const b = $('#sync-badge'); b.hidden = !n; b.textContent = n;
    ({ home: renderHome, log: renderLog, pay: renderPay, cash: renderCash, sop: renderSop, sync: renderSync })[state.tab]();
  }

  /* ----- Home ----- */
  function renderHome() {
    const items = allItems(), todayK = API.dayKey(new Date());
    const s = sumDay(items.filter(i => i.date === todayK));
    const online = navigator.onLine, q = state.queue.length;

    let head = 'Not timed in yet', sub = 'Tap Time In to start your shift.';
    if (s.tout) { head = `Timed out ${hhmm(s.tout.timestamp)}`; sub = `Worked ${fmtDur(workedMs(s, false))} today`; }
    else if (s.bs && !s.be) { head = `On break since ${hhmm(s.bs.timestamp)}`; sub = `Worked ${fmtDur(workedMs(s, true))} so far`; }
    else if (s.tin) { head = `Timed in ${hhmm(s.tin.timestamp)}`; sub = `Worked ${fmtDur(workedMs(s, true))} so far`; }

    const syncChip = q ? chip(online ? `Online · ${q} waiting to sync` : `Offline · ${q} queued`, 'amber')
                       : chip(online ? 'Online · all synced' : 'Offline · nothing waiting', online ? 'green' : 'amber');

    const rowIn = s.tin ? [hhmm(s.tin.timestamp), s.tin.queued ? chip('Queued', 'amber') : s.tin.flag === 'pending' ? flagChip(s.tin) : s.tin.status === 'late' ? chip('Late', 'late') : chip('On time', 'green')] : ['--', chip('Pending')];
    const rowBr = s.bs ? [s.be ? `${hhmm(s.bs.timestamp)}–${hhmm(s.be.timestamp)}` : hhmm(s.bs.timestamp), s.be ? chip('Done', 'green') : chip('On break', 'amber')] : ['--', chip('Pending')];
    const rowOut = s.tout ? [hhmm(s.tout.timestamp), s.tout.queued ? chip('Queued', 'amber') : chip('Done', 'green')] : ['--', chip('Pending')];

    const [ca, cb] = cutoffRange();
    const cs = periodStats(ca, cb, items);
    const pending = items.filter(i => i.flag === 'pending').length;

    const now = new Date(), dow = (now.getDay() + 6) % 7;
    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const groups = byDay(items);
    const week = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
      const k = API.dayKey(d), ds = groups.has(k) ? sumDay(groups.get(k)) : null;
      const cls = ds && ds.tin ? (ds.tin.status === 'late' ? 'late' : 'ok') : '';
      const hrs = ds && ds.tin ? fmtDur(workedMs(ds, k === todayK)).replace(/ 0?(\d+)m/, ':$1').replace('h', '') : '';
      return `<div class="day ${k === todayK ? 'today' : ''}">${d.toLocaleDateString('en-US', { weekday: 'short' })}<span class="dot ${cls}"></span><b>${hrs || '–'}</b></div>`;
    }).join('');

    const btn = (act, label, enabled, primary) => `<button class="btn ${primary ? 'btn-primary' : 'btn-ghost'}" data-act="${act}" ${enabled && !state.busy ? '' : 'disabled'}>${label}</button>`;

    $('#view-home').innerHTML = `
      <div class="home">
        <div class="stack">
          <div class="card status"><small>${longDay(new Date())}</small><div class="big">${esc(head)}</div><small>${esc(sub)}</small>${syncChip}</div>
          <div class="actions">
            ${btn('time_in', 'Time In', s.canIn, true)}${btn('time_out', 'Time Out', s.canOut, true)}
            ${btn('break_start', 'Start Break', s.canBreak, false)}${btn('break_end', 'Return from Break', s.canReturn, false)}
          </div>
          <div class="card"><h2>Today’s log</h2><div class="rows">
            <div class="row"><span>Time In</span><span class="v">${rowIn[0]}</span>${rowIn[1]}</div>
            <div class="row"><span>Break</span><span class="v">${rowBr[0]}</span>${rowBr[1]}</div>
            <div class="row"><span>Time Out</span><span class="v">${rowOut[0]}</span>${rowOut[1]}</div>
          </div></div>
        </div>
        <div class="stack">
          <div class="card"><h2>This cutoff<small>${monDay(ca)} – ${monDay(cb)}</small></h2>
            <div class="stats"><div class="stat"><b>${fmtDur(cs.ms)}</b><span>Hours worked</span></div><div class="stat"><b>${cs.days}</b><span>Days worked</span></div><div class="stat"><b>${cs.late}</b><span>Late</span></div></div>
            ${pending ? `<div class="note">${pending} ${pending === 1 ? 'entry is' : 'entries are'} waiting for the owner’s review.</div>` : ''}
          </div>
          <div class="card"><h2>This week<small>hours per day</small></h2><div class="week">${week}</div></div>
          ${policyCard()}
        </div>
      </div>`;
  }

  /* ----- Log ----- */
  function renderLog() {
    const items = allItems(), todayK = API.dayKey(new Date());
    const days = [...byDay(items).entries()].sort((a, b) => b[0].localeCompare(a[0]));
    if (!days.length) { $('#view-log').innerHTML = '<div class="empty">No attendance yet. Your entries appear here after your first Time In.</div>'; return; }
    $('#view-log').innerHTML = '<p class="caption">Flagged entries are not counted in payroll until the owner approves them.</p><div class="loglist">' + days.map(([k, list]) => {
      const s = sumDay(list), d = keyToDate(k);
      const flag = list.map(flagChip).find(Boolean) || '';
      const missed = s.tin && !s.tout && k !== todayK, noIn = !s.tin && s.list.length;
      const missing = missed || noIn ? chip('Flagged', 'red') : '';
      const st = s.tin ? (s.tin.queued ? chip('Queued', 'amber') : s.tin.status === 'late' ? chip('Late', 'late') : chip('On time', 'green')) : '';
      const hrs = s.tout || k === todayK ? fmtDur(workedMs(s, k === todayK)) : '--';
      const fl = list.find(i => i.flag), reason = fl ? [fl.flagReason, fl.flagRemarks && 'Owner: ' + fl.flagRemarks].filter(Boolean).join(' · ') : (missed ? 'Missed Time Out' : noIn ? 'Missed Time In' : (s.tin?.status === 'late' ? 'Late beyond grace period' : ''));
      return `<div class="card log-day"><span class="d">${shortDay(d)}</span><span class="hrs">${hrs}</span>
        <span class="t">${s.tin ? hhmm(s.tin.timestamp) : '--'} – ${s.tout ? hhmm(s.tout.timestamp) : '--'}${s.bs ? ` · break ${hhmm(s.bs.timestamp)}${s.be ? '–' + hhmm(s.be.timestamp) : ''}` : ''}</span>
        <span class="chips">${st}${flag}${missing}</span>
        ${reason ? `<span class="t" style="grid-column:1/-1">${esc(reason)}</span>` : ''}</div>`;
    }).join('') + '</div>';
  }

  /* ----- SOP ----- */
  const bodyHtml = t => {
    let out = '', list = false;
    for (const l of String(t || '').split('\n')) {
      if (/^\s*[-•]\s+/.test(l)) { if (!list) { out += '<ul>'; list = true; } out += `<li>${esc(l.replace(/^\s*[-•]\s+/, ''))}</li>`; }
      else { if (list) { out += '</ul>'; list = false; } if (l.trim()) out += `<p>${esc(l)}</p>`; }
    }
    return (list ? out + '</ul>' : out) || '<p>No content yet.</p>';
  };
  function sopFiltered() {
    const q = state.sopQuery.trim().toLowerCase();
    return state.sops.filter(s => !q || s.title.toLowerCase().includes(q) || String(s.body || '').toLowerCase().includes(q));
  }
  function renderSop() {
    $('#view-sop').innerHTML = `<div class="sop-layout"><div><input class="search" id="sop-search" type="search" placeholder="Search SOP" value="${esc(state.sopQuery)}" aria-label="Search SOP"><div id="sop-list"></div></div><article class="reader" id="reader"></article></div>`;
    if (!state.selectedSop && matchMedia('(min-width:900px)').matches && state.sops[0]) state.selectedSop = String(state.sops[0].id);
    renderSopList(); renderReader();
  }
  function renderSopList() {
    const list = sopFiltered();
    $('#sop-list').innerHTML = list.length ? list.map(s => `<button class="sop-item" data-sop="${esc(s.id)}" ${String(state.selectedSop) === String(s.id) ? 'aria-current="true"' : ''}><b>${esc(s.title)}</b><small>${esc(s.version)} · Updated ${esc(monYear(s.updatedAt))}</small></button>`).join('')
      : `<div class="empty">${state.sops.length ? 'No policy matches your search.' : 'No policies published yet.'}</div>`;
  }
  function renderReader() {
    const s = state.sops.find(x => String(x.id) === String(state.selectedSop)), el = $('#reader');
    if (!s) { el.classList.remove('open'); el.innerHTML = '<div class="empty">Select a policy to read it.</div>'; return; }
    el.classList.add('open');
    el.innerHTML = `<button class="link-btn dark" data-act="sop-back">← Back</button><h2>${esc(s.title)}</h2><p class="meta">Version ${esc(s.version)}, updated ${esc(monYear(s.updatedAt))}</p>${bodyHtml(s.body)}`;
  }

  /* ----- Policy / Payslips / Advances (read-only; owner manages them in Admin) ----- */
  const peso = v => '₱' + Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = v => Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateLong = v => { const d = new Date(String(v).length === 10 ? v + 'T00:00:00' : v); return isNaN(d) ? String(v || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  function policyCard() {
    const p = state.policy, r = (l, v) => `<div class="row kv"><span>${l}</span><span class="v">${esc(v)}</span></div>`;
    return `<div class="card"><h2>Attendance policy<small>v${esc(p.version ?? '')} · from ${esc(dateLong(p.effectiveDate))}</small></h2><div class="rows">
      ${r('Grace period', (p.graceMinutes ?? 15) + ' min')}${r('Late rule', p.lateRule)}${r('Undertime rule', p.undertimeRule)}
      ${r('Standard shift', (p.standardShift ?? 8) + ' hrs')}${r('Overtime', 'After ' + (p.overtimeAfterHours ?? 8) + ' hrs/day × ' + (p.otMultiplier ?? 1.25))}</div></div>`;
  }
  function renderPay() {
    const list = [...state.payslips].sort((a, b) => String(b.cutoff).localeCompare(String(a.cutoff)));
    $('#view-pay').innerHTML = (list.length ? `<div class="loglist">${list.map(p => {
      const r = (l, v, b) => `<div class="row kv"><span>${l}</span><span class="v ${b ? 'strong' : ''}">${esc(v)}</span></div>`;
      return `<div class="card"><h2>${esc(p.cutoff)}<small>${chip('Finalized', 'green')}</small></h2><div class="rows">
        ${r('Days worked', p.daysWorked)}${r('Hours worked', num(p.regularHours))}${r('Gross pay (PHP)', num(p.basicPay))}${r('Late/undertime deduction (PHP)', num(p.lateDeduction))}
        ${r('Overtime hours', num(p.overtimeHours))}${r('Overtime pay (PHP)', num(p.overtimePay))}${r('Cash advance deduction (PHP)', num(p.cashAdvanceDeduction))}${r('Net pay (PHP)', num(p.netPay), 1)}</div></div>`;
    }).join('')}</div>` : '<div class="empty">No payslips yet. Payslips appear here once the owner finalizes a payroll cutoff.</div>')
      + '<p class="caption">Net pay = gross pay + overtime pay − late/undertime deduction − approved cash advance deduction. Only finalized payslips are shown.</p>';
  }
  function renderCash() {
    const a = state.advances, open = a.filter(x => ['Pending', 'Approved'].includes(x.status));
    const badge = s => chip(s, { Approved: 'green', Deducted: 'dark', Rejected: 'red' }[s] || 'late');
    $('#view-cash').innerHTML = `<div class="summary"><div class="card"><small>Active</small><b>${open.length}</b></div><div class="card"><small>Pending</small><b>${a.filter(x => x.status === 'Pending').length}</b></div><div class="card"><small>Outstanding</small><b>${peso(open.reduce((t, x) => t + Number(x.amount), 0))}</b></div></div>`
      + (a.length ? `<div class="loglist">${[...a].sort((x, y) => String(y.dateGranted).localeCompare(String(x.dateGranted))).map(x => `<div class="card log-day"><span class="d">${peso(x.amount)}</span><span class="chips">${badge(x.status)}</span>
        <span class="t">Granted ${esc(dateLong(x.dateGranted))} · deduct on ${esc(x.cutoff)}</span>${x.notes ? `<span class="t" style="grid-column:1/-1">${esc(x.notes)}</span>` : ''}</div>`).join('')}</div>` : '<div class="empty">No cash advances on record.</div>')
      + '<p class="caption">Cash advances are recorded by the owner. The limit is the lower of ₱1,640.00 or 50% of projected net pay. Ask the owner to record a new one.</p>';
  }

  /* ----- Sync ----- */
  function renderSync() {
    const q = [...state.queue].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)), online = navigator.onLine, todayK = API.dayKey(new Date());
    const banner = q.length
      ? `<div class="banner"><b>${online ? `${q.length} ${q.length === 1 ? 'entry' : 'entries'} waiting` : `Offline: ${q.length} ${q.length === 1 ? 'entry' : 'entries'} queued`}</b>${online ? 'Tap Sync now to send them.' : 'They will sync when you reconnect.'}</div>`
      : `<div class="banner ok"><b>${online ? 'All synced' : 'You are offline'}</b>${online ? (state.lastSync ? `Last synced ${hhmm(state.lastSync)}.` : 'Nothing is waiting to sync.') : 'New entries will be saved on this phone and synced later.'}</div>`;
    const label = i => LABEL[i.action].replace('Start Break', 'Break').replace('Return from Break', 'Return') + (i.date !== todayK ? ` (${keyToDate(i.date).toLocaleDateString('en-US', { weekday: 'short' })})` : '');
    const queueRows = q.map(i => `<div class="row"><span>${esc(label(i))}</span><span class="v">${hhmm(i.timestamp)}</span>${chip('Queued', 'amber')}</div>`).join('');
    const recent = [...state.records].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 6)
      .map(i => `<div class="row"><span>${esc(label(i))}</span><span class="v">${hhmm(i.timestamp)}</span>${chip('Synced', 'green')}</div>`).join('');
    $('#view-sync').innerHTML = `<div class="sync-grid"><div class="stack">${banner}
      ${q.length ? `<div class="card"><h2>Waiting to sync</h2><div class="rows">${queueRows}</div></div>` : ''}
      <button class="btn btn-primary" data-act="sync" ${state.syncing ? 'disabled' : ''}>${state.syncing ? 'Syncing…' : 'Sync now'}</button></div>
      <div class="stack"><div class="card"><h2>Recently synced</h2>${recent ? `<div class="rows">${recent}</div>` : '<div class="empty">Nothing synced yet.</div>'}</div></div></div>`;
  }

  /* ---------- data flow ---------- */
  async function refresh() {
    const u = state.user;
    const [rec, pol, sops, pay, cash] = await Promise.allSettled([API.getMyRecords(u), API.getPolicy(), API.getSops(), API.getPayslips(u), API.getAdvances(u)]);
    for (const r of [rec, pol, sops, pay, cash]) if (r.status === 'rejected' && r.reason?.code === 'unauthorized') return signOut(true);
    if (rec.status === 'fulfilled') state.records = rec.value;
    if (pol.status === 'fulfilled') state.policy = pol.value;
    if (sops.status === 'fulfilled') state.sops = sops.value;
    if (pay.status === 'fulfilled') state.payslips = pay.value;
    if (cash.status === 'fulfilled') state.advances = cash.value;
    state.queue = (await API.queue.all()).filter(q => q.staffId === u.id);
    renderAll();
  }

  async function syncNow(manual) {
    if (state.syncing || !state.user) return;
    state.queue = (await API.queue.all()).filter(q => q.staffId === state.user.id);
    if (!navigator.onLine) { if (manual) toast('You are offline. Entries will sync when you reconnect.'); return renderAll(); }
    if (!state.queue.length) { if (manual) toast('Everything is already synced.'); return refresh(); }
    state.syncing = true; renderAll();
    try {
      const r = await API.syncQueue(state.queue);
      if (r.synced) { state.lastSync = new Date(); toast(`${r.synced} ${r.synced === 1 ? 'entry' : 'entries'} synced.`); }
      if (r.failed) toast(`${r.failed} could not sync. Ask the owner if this keeps happening.`);
      if (r.stopped && manual) toast('Connection lost. We’ll try again when you’re back online.');
    } catch (e) { if (e.code === 'unauthorized') return signOut(true); }
    state.syncing = false;
    await refresh();
  }

  async function commit(action, photo, when) {
    if (state.busy) return;
    state.busy = true; renderAll();
    const u = state.user;
    const rec = { clientId: API.uid(), staffId: u.id, staffName: u.name, username: u.username, date: API.dayKey(when), action, timestamp: when.toISOString(), photo: photo || null };
    try {
      if (!navigator.onLine) throw Object.assign(new Error('offline'), { network: true });
      const saved = await API.submitAttendance(rec);
      state.records.push(saved);
      toast(`${LABEL[action]} recorded at ${hhmm(when)}.`);
    } catch (e) {
      if (e.network) {
        await API.queue.add({ ...rec, source: 'offline' });
        state.queue = (await API.queue.all()).filter(q => q.staffId === u.id);
        toast(`${LABEL[action]} saved on this phone. It will sync when you’re online.`);
      } else if (e.code === 'unauthorized') { state.busy = false; return signOut(true); }
      else toast(e.message || 'Could not record that. Try again.');
    }
    state.busy = false; renderAll();
  }

  /* ---------- photo capture (Time In / Time Out) ---------- */
  const stampLabel = d => {
    const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).replace(', ', ' ');
    return `${day} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  };
  const timeLong = d => d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  async function openCapture(action) {
    cap = { action, stream: null, photo: null, ts: null, clock: null };
    $('#photo').hidden = false;
    $('#shot').hidden = true; $('#cam').hidden = false; $('#cam-msg').hidden = true;
    renderCapture('live');
    cap.clock = setInterval(() => { if (!cap.photo) $('#photo-title').textContent = `${LABEL[action]} · ${timeLong(new Date())}`; }, 1000);
    try {
      cap.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 960 } }, audio: false });
      const v = $('#cam'); v.srcObject = cap.stream; await v.play();
    } catch {
      $('#cam').hidden = true;
      const m = $('#cam-msg'); m.hidden = false; m.textContent = 'Camera is blocked. Allow camera access in your browser, or use your phone’s camera instead.';
    }
  }
  function renderCapture(mode) {
    const a = cap.action;
    $('#photo-title').textContent = `${LABEL[a]} · ${timeLong(cap.ts || new Date())}`;
    $('#photo-actions').innerHTML = mode === 'live'
      ? `<button class="btn btn-primary wide" data-act="shoot">${cap.stream || !$('#cam-msg').hidden ? 'Take photo' : 'Take photo'}</button>`
      : `<button class="btn" data-act="retake">Retake</button><button class="btn btn-primary" data-act="confirm-photo">Confirm</button>`;
  }
  function stamp(src, sw, sh) {
    const scale = Math.min(1, 720 / Math.max(sw, sh)), w = Math.round(sw * scale), h = Math.round(sh * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d'); x.drawImage(src, 0, 0, w, h);
    const fs = Math.max(13, Math.round(w / 32)), bar = fs * 2;
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, h - bar, w, bar);
    x.fillStyle = '#fff'; x.font = `${fs}px system-ui, sans-serif`; x.textBaseline = 'middle';
    x.fillText(`Photo preview · ${stampLabel(cap.ts)}`, 12, h - bar / 2);
    return c.toDataURL('image/jpeg', 0.7);
  }
  function showShot(dataUrl) {
    cap.photo = dataUrl;
    const img = $('#shot'); img.src = dataUrl; img.hidden = false; $('#cam').hidden = true; $('#cam-msg').hidden = true;
    renderCapture('preview');
  }
  function shoot() {
    const v = $('#cam');
    if (cap.stream && v.videoWidth) { cap.ts = new Date(); showShot(stamp(v, v.videoWidth, v.videoHeight)); }
    else $('#file').click();
  }
  function closeCapture() {
    clearInterval(cap?.clock);
    cap?.stream?.getTracks().forEach(t => t.stop());
    $('#cam').srcObject = null; $('#photo').hidden = true; $('#file').value = ''; cap = null;
  }

  /* ---------- auth ---------- */
  async function signOut(expired) {
    const waiting = state.queue.length;
    if (!expired && waiting && !confirm(`${waiting} ${waiting === 1 ? 'entry is' : 'entries are'} still waiting to sync. Sign out anyway? They stay on this phone until you log in again.`)) return;
    API.logout(); state.user = null; state.records = []; state.queue = []; state.tab = 'home';
    if (expired) { try { sessionStorage.setItem('sc_login_notice', 'Your session expired. Log in again.'); } catch {} }
    showLogin();
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act],[data-tab],[data-sop]'); if (!t) return;
    if (t.dataset.tab) return go(t.dataset.tab);
    if (t.dataset.sop) { state.selectedSop = t.dataset.sop; renderSopList(); return renderReader(); }
    const a = t.dataset.act;
    if (a === 'time_in' || a === 'time_out') return openCapture(a);
    if (LABEL[a]) return commit(a, null, new Date());
    if (a === 'sync') return syncNow(true);
    if (a === 'signout') return signOut(false);
    if (a === 'sop-back') { state.selectedSop = null; return renderReader(); }
    if (a === 'shoot') return shoot();
    if (a === 'retake') { cap.photo = null; cap.ts = null; $('#shot').hidden = true; $('#cam').hidden = !cap.stream; if (!cap.stream) { $('#cam-msg').hidden = false; } renderCapture('live'); return; }
    if (a === 'confirm-photo') { const { action, photo, ts } = cap; closeCapture(); return commit(action, photo, ts); }
  });
  $('#photo-cancel').addEventListener('click', closeCapture);
  $('#file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f || !cap) return;
    const img = new Image();
    img.onload = () => { cap.ts = new Date(); showShot(stamp(img, img.naturalWidth, img.naturalHeight)); URL.revokeObjectURL(img.src); };
    img.src = URL.createObjectURL(f);
  });
  document.addEventListener('input', e => { if (e.target.id === 'sop-search') { state.sopQuery = e.target.value; renderSopList(); } });

  window.addEventListener('online', () => { renderAll(); syncNow(false); });
  window.addEventListener('offline', renderAll);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && state.user) { refresh(); syncNow(false); } });
  setInterval(() => { if (state.user && state.tab === 'home' && !cap) renderHome(); }, 30000);
  setInterval(() => { if (state.user && state.queue.length && navigator.onLine) syncNow(false); }, 60000);

  /* ---------- boot ---------- */
  (async function boot() {
    await API.init();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('staff-sw.js', { scope: './staff-index.html' });
    const s = API.getSession();
    if (s?.user) { state.user = s.user; showApp(); await refresh(); syncNow(false); }
    else showLogin();
  })();
})();