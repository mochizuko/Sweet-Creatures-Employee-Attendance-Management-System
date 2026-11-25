(() => {
  'use strict';

  const CFG = Object.assign({
    mode: 'local',       
    baseUrl: '',            
    sessionHours: 12
  }, window.SC_CONFIG || {});

  const ENDPOINTS = {
    login:    ['POST', '/api/auth/login'],      // body {username, pin} -> {token, user:{id,name,username,role}}
    records:  ['GET',  '/api/attendance/mine'],  // -> [record]
    submit:   ['POST', '/api/attendance'],       // body record -> saved record (must be idempotent on clientId)
    policy:   ['GET',  '/api/policy'],           // -> policy
    sops:     ['GET',  '/api/sops'],             // -> [sop] (published only)
    payslips: ['GET',  '/api/payroll/payslips/me'], // finalized only (exists in payrollRoutes)
    advances: ['GET',  '/api/cash-advances/mine']   // NOT in backend yet
  };

  // localStorage keys (local mode). Align these with the Admin code.
  const KEYS = {
    staff:   'sc_staff',
    records: 'sc_attendance',
    policy:  'sc_policy',
    sops:    'sc_sops',
    session: 'sc_staff_session',
    payslips: 'sc_payslips',
    advances: 'sc_cash_advances'
  };

  const defaultPolicy = { version: 2, effectiveDate: '2026-10-01', shiftStart: '08:00', graceMinutes: 15, overtimeAfterHours: 8, standardShift: 8, otMultiplier: 1.25,
    lateRule: 'Deduct per minute late, after grace period', undertimeRule: 'Deduct per minute of early Time Out' };
  const arr = r => Array.isArray(r) ? r : (r?.data || r?.rows || []);

  /* ---------- helpers ---------- */
  const pad = n => String(n).padStart(2, '0');
  const dayKey = d => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
  const fail = (message, extra) => Object.assign(new Error(message), extra);
  const read = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  function statusFor(ts, policy = defaultPolicy) {
    const d = new Date(ts), [h, m] = String(policy.shiftStart || '08:00').split(':').map(Number);
    return d.getHours() * 60 + d.getMinutes() > h * 60 + m + Number(policy.graceMinutes ?? 15) ? 'late' : 'ontime';
  }

  async function sha(text) {
    if (!crypto.subtle) return text; // insecure-context fallback (prototype only)
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const pinHash = (username, pin) => sha(`${String(username).trim().toLowerCase()}:${pin}`);

  /* ---------- session ---------- */
  let session = null;
  const getSession = () => {
    if (!session) session = read(KEYS.session, null);
    if (session && session.exp && Date.now() > session.exp) { session = null; localStorage.removeItem(KEYS.session); }
    return session;
  };
  const logout = () => { session = null; localStorage.removeItem(KEYS.session); };
  const startSession = (token, user) => {
    session = { token, user, exp: Date.now() + CFG.sessionHours * 3600e3 };
    write(KEYS.session, session);
    return session;
  };
  const requireSession = () => { const s = getSession(); if (!s) throw fail('Session expired', { code: 'unauthorized' }); return s; };

  /* ---------- backend transport ---------- */
  async function http([method, path], body, query) {
    const s = getSession();
    let res;
    try {
      res = await fetch(CFG.baseUrl + path + (query ? '?' + new URLSearchParams(query) : ''), {
        method,
        headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch { throw fail('No connection', { network: true }); }
    const data = await res.json().catch(() => null);
    if (res.status === 401 && path !== ENDPOINTS.login[1]) throw fail('Session expired', { code: 'unauthorized' });
    if (!res.ok) throw fail(data?.message || 'Request failed', { status: res.status, code: data?.code });
    return data;
  }

  /* ---------- offline queue (IndexedDB: photos are too big for localStorage) ---------- */
  let dbp;
  const db = () => dbp || (dbp = new Promise((ok, no) => {
    const r = indexedDB.open('sc-staff', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('queue', { keyPath: 'clientId' });
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((ok, no) => {
      const t = d.transaction('queue', mode), st = t.objectStore('queue'), req = fn(st);
      t.oncomplete = () => ok(req?.result); t.onerror = () => no(t.error);
    });
  };
  const queue = {
    all: () => tx('readonly', s => s.getAll()).then(r => r || []),
    add: item => tx('readwrite', s => s.put(item)),
    remove: id => tx('readwrite', s => s.delete(id))
  };

  /* ---------- LOCAL mode ---------- */
  async function seedLocal() {
    if (!read(KEYS.staff, null)) {
      write(KEYS.staff, [
        { id: 'st-maria', name: 'Maria Santos', username: 'maria', role: 'staff', status: 'active', pinHash: await pinHash('maria', '1234') },
        { id: 'st-jun',   name: 'Jun Reyes',    username: 'jun',   role: 'staff', status: 'active', pinHash: await pinHash('jun', '1234') }
      ]);
    }
    if (!read(KEYS.payslips, null)) write(KEYS.payslips, [
      { id: 'ps-1', staffId: 'st-maria', cutoff: 'Oct 16 - Oct 31, 2026', status: 'Finalized', daysWorked: 11, regularHours: 88, basicPay: 7040, lateDeduction: 0, overtimeHours: 2, overtimePay: 200, cashAdvanceDeduction: 0, netPay: 7240 },
      { id: 'ps-2', staffId: 'st-maria', cutoff: 'Nov 1 - Nov 15, 2026', status: 'Draft', daysWorked: 11, regularHours: 88, basicPay: 7040, lateDeduction: 0, overtimeHours: 2, overtimePay: 200, cashAdvanceDeduction: 500, netPay: 6740 },
      { id: 'ps-3', staffId: 'st-jun', cutoff: 'Oct 16 - Oct 31, 2026', status: 'Finalized', daysWorked: 12, regularHours: 96, basicPay: 8160, lateDeduction: 42.5, overtimeHours: 0, overtimePay: 0, cashAdvanceDeduction: 300, netPay: 7817.5 }
    ]);
    if (!read(KEYS.advances, null)) write(KEYS.advances, [
      { id: 'ca-1', staffId: 'st-maria', amount: 500, dateGranted: '2026-10-20', cutoff: 'Nov 1 - Nov 15, 2026', status: 'Approved', notes: '' },
      { id: 'ca-2', staffId: 'st-jun', amount: 300, dateGranted: '2026-10-12', cutoff: 'Oct 16 - Oct 31, 2026', status: 'Deducted', notes: '' }
    ]);
    if (!read(KEYS.sops, null)) {
      const now = new Date().toISOString();
      write(KEYS.sops, [
        { id: 'sop-1', title: 'Opening Procedure', version: 'v2', status: 'published', updatedAt: now, body: 'Arrive 10 minutes before your shift.\n- Turn on the lights and equipment\n- Check the display case\n- Count the opening cash drawer' },
        { id: 'sop-2', title: 'Customer Service Standards', version: 'v1', status: 'published', updatedAt: now, body: 'Greet every guest within 30 seconds.\n- Smile and make eye contact\n- Repeat the order back\n- Thank every guest' },
        { id: 'sop-3', title: 'Staff Conduct Policy', version: 'v3', status: 'published', updatedAt: now, body: 'Be on time, be respectful, and keep your station clean.\n- Phones stay in your locker during shifts\n- Report any issue to the owner' }
      ]);
    }
  }

  const local = {
    async login(username, pin) {
      const u = read(KEYS.staff, []).find(x => String(x.username).toLowerCase() === username.trim().toLowerCase());
      if (!u || u.pinHash !== await pinHash(u.username, pin)) throw fail('Wrong username or PIN.');
      if (u.role && u.role !== 'staff') throw fail('This app is for staff. Admins log in on the Admin site.');
      if (u.status && u.status !== 'active') throw fail('This account is locked. Ask the owner.');
      return startSession(uid(), { id: u.id, name: u.name, username: u.username, role: u.role || 'staff' });
    },
    async records(user) { return read(KEYS.records, []).filter(r => r.staffId === user.id); },
    async policy() { return { ...defaultPolicy, ...read(KEYS.policy, {}) }; },
    async payslips(user) { return read(KEYS.payslips, []).filter(p => p.staffId === user.id && p.status === 'Finalized'); },
    async advances(user) { return read(KEYS.advances, []).filter(a => a.staffId === user.id); },
    async sops() { return read(KEYS.sops, []).filter(s => !s.status || String(s.status).toLowerCase() === 'published'); },
    async submit(rec) {
      const all = read(KEYS.records, []);
      const dup = all.find(r => r.clientId === rec.clientId);
      if (dup) return dup; // idempotent
      const rows = all.filter(r => r.staffId === rec.staffId && r.date === rec.date);
      const has = a => rows.some(r => r.action === a);
      const rules = {
        time_in:     [!has('time_in'), 'You already timed in today.'],
        break_start: [has('time_in') && !has('time_out') && !has('break_start'), 'You can’t start a break right now.'],
        break_end:   [has('break_start') && !has('break_end'), 'You are not on a break.'],
        time_out:    [has('time_in') && !has('time_out') && (!has('break_start') || has('break_end')), 'Finish your break before timing out.']
      };
      const rule = rules[rec.action];
      if (!rule) throw fail('Unknown action.');
      if (!rule[0]) throw fail(rule[1], { code: 'invalid' });
      if ((rec.action === 'time_in' || rec.action === 'time_out') && !rec.photo) throw fail('A photo is required.', { code: 'invalid' });

      const policy = await local.policy();
      const saved = {
        ...rec,
        status: rec.action === 'time_in' ? statusFor(rec.timestamp, policy) : null,
        flag: rec.source === 'offline' ? 'pending' : null,           // FR-10: offline entries go to owner review
        flagReason: rec.source === 'offline' ? 'Logged while offline' : null,
        syncedAt: new Date().toISOString()
      };
      all.push(saved); write(KEYS.records, all);
      return saved;
    }
  };

  /* The backend returns snake_case payslip fields; the staff screens read camelCase. Accept both. */
  const pickFirst = (o, ...keys) => { for (const k of keys) if (o[k] != null) return o[k]; return undefined; };
  const cutoffText = p => {
    if (p.cutoff) return p.cutoff;
    const s = pickFirst(p, 'start_date', 'cutoff_start', 'startDate'), e = pickFirst(p, 'end_date', 'cutoff_end', 'endDate');
    if (!s || !e) return '';
    const f = d => new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    return `${f(s)} - ${f(e)}, ${String(e).slice(0, 4)}`;
  };
  const normalizePayslip = p => ({
    ...p,
    id: pickFirst(p, 'id', 'payslip_id'),
    cutoff: cutoffText(p),
    daysWorked: pickFirst(p, 'daysWorked', 'days_worked') ?? 0,
    regularHours: pickFirst(p, 'regularHours', 'total_hours_worked', 'hours') ?? 0,
    basicPay: pickFirst(p, 'basicPay', 'basic_pay') ?? 0,
    lateDeduction: pickFirst(p, 'lateDeduction', 'late_undertime_deduction') ?? 0,
    overtimeHours: pickFirst(p, 'overtimeHours', 'overtime_hours') ?? 0,
    overtimePay: pickFirst(p, 'overtimePay', 'overtime_pay') ?? 0,
    cashAdvanceDeduction: pickFirst(p, 'cashAdvanceDeduction', 'cash_advance_deduction') ?? 0,
    netPay: pickFirst(p, 'netPay', 'net_pay') ?? 0
  });

  /* ---------- backend mode ---------- */
  const remote = {
    login: async (username, pin) => {
      const r = await http(ENDPOINTS.login, { username: username.trim(), pin });
      if (String(r.user?.role || 'staff').toLowerCase() !== 'staff') throw fail('This app is for staff. Admins log in on the Admin site.');
      const u = r.user || {};
      return startSession(r.token, { id: String(u.id), username: u.username, role: 'staff', name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username });
    },
    records: user => http(ENDPOINTS.records, null, { staffId: user.id }),
    policy: () => http(ENDPOINTS.policy),
    sops: () => http(ENDPOINTS.sops),
    payslips: () => http(ENDPOINTS.payslips).then(arr).then(a => a.filter(p => p.status === 'Finalized').map(normalizePayslip)),
    advances: () => http(ENDPOINTS.advances).then(arr),
    submit: rec => http(ENDPOINTS.submit, rec)
  };

  const impl = CFG.mode === 'backend' ? remote : local;

  /* ---------- public API (what app.js calls) ---------- */
  async function syncQueue(items) {
    const out = { synced: 0, failed: 0, stopped: false };
    const sorted = [...items].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); // keep order: in -> break -> out
    for (const item of sorted) {
      try {
        await impl.submit({ ...item, source: 'offline' });
        await queue.remove(item.clientId); out.synced++;
      } catch (e) {
        if (e.network) { out.stopped = true; break; }
        if (e.code === 'unauthorized') throw e;
        if (e.code === 'invalid' || e.status === 409 || e.status === 400) { await queue.remove(item.clientId); out.failed++; } // rejected for good
        else out.failed++;
      }
    }
    return out;
  }

  window.SCApi = {
    defaultPolicy, dayKey, uid, statusFor, queue, syncQueue, getSession, logout,
    init: async () => { if (CFG.mode === 'local') await seedLocal(); },
    login: async (u, p) => { requireLoginArgs(u, p); return impl.login(u, p); },
    getMyRecords: user => { requireSession(); return impl.records(user); },
    getPolicy: () => { requireSession(); return impl.policy(); },
    getSops: () => { requireSession(); return impl.sops(); },
    getPayslips: user => { requireSession(); return impl.payslips(user); },
    getAdvances: user => { requireSession(); return impl.advances(user); },
    submitAttendance: rec => { requireSession(); return impl.submit(rec); }
  };
  function requireLoginArgs(u, p) { if (!String(u).trim() || !p) throw fail('Enter your username and PIN.'); }
})();