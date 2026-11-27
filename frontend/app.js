/* Sweet Creatures admin app: every table loads from the backend API (RDS on AWS). */
const LOCAL_API_PORT = '5000';
const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && window.location.port !== LOCAL_API_PORT;
const API_BASE_URL = isLocalPreview
  ? `http://${window.location.hostname}:${LOCAL_API_PORT}/api`
  : '/api';
const TOKEN_KEY = 'sweet-creatures-session-token';
const STAFF_SESSION_KEY = 'sc_staff_session';
const STAFF_HOME = 'staff-index.html';

const WAGE_TABLES = [
  { region: 'NCR', category: 'nonAgriculture', dailyMinimum: 755, effectiveDate: '2026-09-26', order: 'NCR-28' },
  { region: 'NCR', category: 'smallRetail', dailyMinimum: 718, effectiveDate: '2026-09-26', order: 'NCR-28' }
];
const badgeClass = {
  OnTime: 'green', Late: 'gold', Flagged: 'red', Absent: 'neutral', 'Not in yet': 'neutral',
  Active: 'green', Locked: 'red', Inactive: 'neutral'
};
const STATUS_LABEL = { OnTime: 'On time' };

const state = {
  staff: [],
  day: null,
  flagged: [],
  cash: [],
  policy: null,
  policies: [],
  cutoffs: [],
  payslips: [],
  summaryDay: null,
  sops: [],
  schedules: []
};

const message = document.querySelector('#app-message');
function notify(text, isError = false) {
  message.textContent = text;
  message.classList.toggle('is-error', isError);
  message.hidden = false;
  window.clearTimeout(notify.timeout);
  notify.timeout = window.setTimeout(() => { message.hidden = true; }, 6000);
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  } catch {
    throw new Error('Could not reach the backend. Make sure it is running.');
  }

  const responseText = await response.text();
  let result = {};
  if (responseText) {
    try {
      result = JSON.parse(responseText);
    } catch {
      throw new Error('The backend returned an unreadable response.');
    }
  }
  if (!response.ok) {
    throw new Error(result.message || `Request failed (${response.status}).`);
  }
  return result;
}

function mapEmployee(employee) {
  return {
    id: String(employee.user_id),
    name: [employee.first_name, employee.middle_name, employee.last_name].filter(Boolean).join(' '),
    username: employee.username,
    role: employee.account_role,
    position: employee.job_position || '',
    rate: employee.hourly_rate ?? 0,
    hired: employee.created_at ? String(employee.created_at).slice(0, 10) : '',
    email: employee.email,
    status: employee.account_status
  };
}

/* ------------------------------ helpers ------------------------------ */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}
function formatAmount(value) {
  return Number(value).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPeso(value) {
  return `₱${formatAmount(value)}`;
}
function formatDate(value) {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function manilaToday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date()).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function cutoffLabel(value) {
  const [start, end] = String(value).split('|');
  if (!start || !end) return value;
  const f = d => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${f(start)} - ${f(end)}, ${end.slice(0, 4)}`;
}

function applyFilter(group) {
  if (!group) return;
  const selected = group.querySelector('.filter.active');
  if (!selected) return;
  const isCash = group.dataset.filterGroup === 'cash';
  const search = isCash ? document.querySelector('#cash-search').value.trim().toLowerCase() : '';
  const rows = document.querySelectorAll(`#${group.dataset.filterGroup}-rows tr`);

  // "Late 2" -> "Late (2)" (only on buttons that already show a number)
  group.querySelectorAll('.filter').forEach(btn => {
    const text = btn.textContent.trim();
    if (!/\d+\)?$/.test(text)) return;
    const count = [...rows].filter(row => row.dataset.status && (btn.dataset.filter === 'all' || row.dataset.status === btn.dataset.filter)).length;
    btn.textContent = `${text.replace(/\s*\(?\d+\)?$/, '')} (${count})`;
  });

  rows.forEach(row => {
    const matchesStatus = selected.dataset.filter === 'all' || row.dataset.status === selected.dataset.filter;
    const matchesSearch = !search || (row.dataset.search || '').includes(search);
    row.hidden = !(matchesStatus && matchesSearch);
  });
  if (isCash) document.querySelector('#cash-empty').hidden = Array.from(rows).some(row => !row.hidden);
}

/* ------------------------------ loaders ------------------------------ */

async function loadEmployees() {
  const result = await apiRequest('/employees');
  if (!Array.isArray(result.rows)) throw new Error('The backend returned an invalid employee list.');
  state.staff = result.rows.map(mapEmployee);
  renderStaff();
  renderCashStaffOptions();
}
async function loadDay(date) {
  const picker = document.querySelector('#day-picker');
  const wanted = date || picker.value || '';
  const result = await apiRequest(`/attendance/day${wanted ? `?date=${encodeURIComponent(wanted)}` : ''}`);
  state.day = result;
  if (!state.summaryDay || result.isToday) state.summaryDay = result;
  picker.value = result.date;
  picker.max = manilaToday();
  renderAttendance();
  renderSummary();
}
async function loadFlagged() {
  state.flagged = (await apiRequest('/attendance/flagged')).data;
  renderFlagged();
  renderSummary();
}
async function loadCash() {
  state.cash = (await apiRequest('/cash-advances')).data;
  renderCashAdvances();
  renderSummary();
}
async function loadPolicies() {
  const [current, history] = await Promise.all([apiRequest('/policy'), apiRequest('/policy/history')]);
  state.policy = current;
  state.policies = history.data;
  renderPolicies();
  fillPolicyForm();
}
function clock12(t) {
  const [h, m] = String(t).split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
async function loadSchedules() {
  try {
    const result = await apiRequest('/schedules');
    state.schedules = result.data || [];
  } catch (error) {
    state.schedules = [];
  }
  renderSchedules();
}
function renderSchedules() {
  const rows = document.querySelector('#schedule-rows');
  if (!rows) return;
  const badge = { Current: 'green', Upcoming: 'gold' };
  rows.innerHTML = state.schedules.length
    ? state.schedules.map(item => `<tr><td>${escapeHtml(formatDate(item.effectiveFrom))}</td><td>${item.effectiveTo ? escapeHtml(formatDate(item.effectiveTo)) : 'Until changed'}</td><td>${escapeHtml(clock12(item.timeInOpens))}</td><td>${item.regularTimeOut ? escapeHtml(clock12(item.regularTimeOut)) : '--'}</td><td><span class="badge badge-${badge[item.status] || 'neutral'}">${escapeHtml(item.status)}</span></td><td><button class="action-button" type="button" data-schedule-del="${escapeHtml(item.id)}">Remove</button></td></tr>`).join('')
    : '<tr><td colspan="6">No schedule set. Staff can time in at any time.</td></tr>';
  const form = document.querySelector('#schedule-form');
  if (form && !form.elements.effectiveFrom.value) form.elements.effectiveFrom.value = manilaToday();
}
async function loadSops() {
  const result = await apiRequest('/sops?all=1');
  state.sops = Array.isArray(result) ? result : (result.data || []);
  renderSops();
}
async function loadCutoffs() {
  state.cutoffs = (await apiRequest('/payroll/cutoffs')).data;
  renderSummary();
}
function currentCutoff() {
  const [start, end] = cutoffValue().split('|');
  return state.cutoffs.find(c => c.start_date === start && c.end_date === end) || null;
}
async function loadPayroll() {
  const cutoff = currentCutoff();
  state.payslips = cutoff ? (await apiRequest(`/payroll/cutoffs/${cutoff.cutoff_id}/payslips`)).data : [];
  renderPayroll();
}
async function loadAll() {
  await Promise.all([loadEmployees(), loadDay(), loadFlagged(), loadCash(), loadPolicies(), loadCutoffs(), loadSops(), loadSchedules()]);
  await loadPayroll();
  updateCashAdvanceLimit();
}
async function refresh(...fns) {
  try { await Promise.all(fns.map(fn => fn())); } catch (error) { notify(`Could not refresh: ${error.message}`, true); }
}

/* ------------------------------ renderers ---------------------------- */

function renderSummary() {
  const day = state.summaryDay;
  if (day) {
    document.querySelector('#sum-present').textContent = `${day.summary.present} / ${day.summary.total}`;
  }
  document.querySelector('#sum-flagged').textContent = state.flagged.filter(e => e.status === 'Pending').length;
  document.querySelector('#sum-cash').textContent = state.cash.filter(e => e.status === 'Pending').length;
  const today = manilaToday();
  const next = [...state.cutoffs].filter(c => c.status !== 'Closed' && c.end_date >= today)
    .sort((a, b) => a.end_date.localeCompare(b.end_date))[0];
  document.querySelector('#sum-cutoff').textContent = next
    ? new Date(`${next.end_date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '--';
}

function renderAttendance() {
  const day = state.day;
  if (!day) return;
  document.querySelector('#day-title').textContent = day.isToday ? "Today's Attendance" : `Attendance for ${formatDate(day.date)}`;
  document.querySelector('#sum-present-label').textContent = 'Present Today';
  document.querySelector('#attendance-rows').innerHTML = day.rows.length
    ? day.rows.map(row => {
      const photoCell = row.recordId
        ? `<button class="action-button" data-dashboard-photo="${row.recordId}" data-title="${escapeHtml(row.name)}, ${escapeHtml(formatDate(day.date))}">View</button>`
        : '--';
      const hours = row.hours != null ? formatAmount(row.hours) : '--';
      return `<tr data-status="${escapeHtml(row.status)}"><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.timeIn || '--')}</td><td>${escapeHtml(row.timeOut || '--')}</td><td>${hours}</td><td><span class="badge badge-${badgeClass[row.status] || 'neutral'}">${escapeHtml(STATUS_LABEL[row.status] || row.status)}</span></td><td>${photoCell}</td></tr>`;
    }).join('')
    : '<tr><td colspan="6">No active staff yet.</td></tr>';
  applyFilter(document.querySelector('[data-filter-group="attendance"]'));
}

function renderSops() {
  const rows = document.querySelector('#sop-rows');
  if (!rows) return;
  rows.innerHTML = state.sops.length
    ? state.sops.map(sop => {
      const published = sop.status === 'published';
      const updated = sop.updatedAt ? new Date(sop.updatedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '--';
      return `<tr><td>${escapeHtml(sop.title)}</td><td>${escapeHtml(sop.version)}</td><td>${escapeHtml(updated)}</td><td><span class="badge badge-${published ? 'green' : 'gold'}">${published ? 'Published' : 'Draft'}</span></td><td><button class="action-button" type="button" data-sop-edit="${escapeHtml(sop.id)}">Edit</button></td></tr>`;
    }).join('')
    : '<tr><td colspan="5">No SOPs yet. Select + New SOP to add one.</td></tr>';
}

function staffActions(person) {
  const id = escapeHtml(person.id);
  const buttons = [`<button class="action-button" type="button" data-staff-act="pin" data-id="${id}">Reset PIN</button>`];
  buttons.push(`<button class="action-button" type="button" data-staff-act="promote" data-id="${id}">Promote / Edit</button>`);
  if (person.status === 'Locked') buttons.push(`<button class="action-button" type="button" data-staff-act="unlock" data-id="${id}">Unlock</button>`);
  if (person.status === 'Inactive') buttons.push(`<button class="action-button" type="button" data-staff-act="reactivate" data-id="${id}">Reactivate</button>`);
  else buttons.push(`<button class="action-button" type="button" data-staff-act="deactivate" data-id="${id}">Deactivate</button>`);
  return `<div style="display:flex;gap:12px;flex-wrap:wrap">${buttons.join('')}</div>`;
}

function renderStaff() {
  document.querySelector('#staff-rows').innerHTML = state.staff.length
    ? state.staff.map(person =>
      `<tr data-id="${escapeHtml(person.id)}" data-status="${escapeHtml(person.status)}"><td>${escapeHtml(person.name)}</td><td>${escapeHtml(person.username)}</td><td>${escapeHtml(person.role)}</td><td>${escapeHtml(person.position)}</td><td>PHP ${formatAmount(person.rate)}</td><td>${escapeHtml(person.hired)}</td><td>${escapeHtml(person.email)}</td><td><span class="badge badge-${badgeClass[person.status] || 'neutral'}">${escapeHtml(person.status)}</span></td><td>${staffActions(person)}</td></tr>`
    ).join('')
    : '<tr><td colspan="9">No employee accounts found.</td></tr>';
  applyFilter(document.querySelector('[data-filter-group="staff"]'));
}

function renderFlagged() {
  document.querySelector('#flagged-rows').innerHTML = state.flagged.length
    ? state.flagged.map(entry =>
      `<tr data-id="${entry.id}" data-status="${escapeHtml(entry.status)}"><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(formatDate(entry.date))}</td><td>${escapeHtml(entry.timeIn || '--')}</td><td>${escapeHtml(entry.timeOut || '--')}</td><td>${escapeHtml(entry.reason)}${entry.notes ? `<br><small>${escapeHtml(entry.notes)}</small>` : ''}</td><td><span class="badge badge-${entry.status === 'Approved' ? 'green' : entry.status === 'Rejected' ? 'red' : 'gold'}">${escapeHtml(entry.status)}</span></td><td><button class="action-button" data-photo-action>View</button></td><td>${entry.status === 'Pending' ? '<button class="action-button" data-open="review-dialog">Review</button>' : '--'}</td></tr>`
    ).join('')
    : '<tr><td colspan="8">No flagged attendance.</td></tr>';
  const pendingCount = state.flagged.filter(entry => entry.status === 'Pending').length;
  document.querySelector('[data-filter-group="flagged"] [data-filter="Pending"]').textContent = `Pending ${pendingCount}`;
  applyFilter(document.querySelector('[data-filter-group="flagged"]'));
}

function renderCashAdvances() {
  closeCashMenu();
  const open = state.cash.filter(entry => ['Pending', 'Approved'].includes(entry.status));
  document.querySelector('#cash-active-count').textContent = open.length;
  document.querySelector('#cash-pending-count').textContent = state.cash.filter(entry => entry.status === 'Pending').length;
  document.querySelector('#cash-outstanding-total').textContent = formatPeso(open.reduce((total, entry) => total + Number(entry.amount), 0));
  document.querySelector('#cash-rows').innerHTML = state.cash.map(entry => {
    const badge = entry.status === 'Approved' ? 'green' : entry.status === 'Deducted' ? 'dark' : entry.status === 'Rejected' ? 'red' : 'gold';
    const id = escapeHtml(entry.id);
    return `<tr data-id="${id}" data-status="${escapeHtml(entry.status)}" data-search="${escapeHtml(entry.staffName.toLowerCase())}"><td>${escapeHtml(entry.staffName)}</td><td>${formatPeso(entry.amount)}</td><td>${escapeHtml(formatDate(entry.dateGranted))}</td><td>${escapeHtml(entry.cutoff)}</td><td>${entry.notes ? escapeHtml(entry.notes) : '\u2014'}</td><td><span class="badge badge-${badge}">${escapeHtml(entry.status)}</span></td><td><button class="kebab" type="button" data-menu-toggle data-id="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${escapeHtml(entry.staffName)}"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="3" cy="8" r="1.4"/><circle cx="8" cy="8" r="1.4"/><circle cx="13" cy="8" r="1.4"/></svg></button></td></tr>`;
  }).join('');
  applyFilter(document.querySelector('[data-filter-group="cash"]'));
}
function closeCashMenu() {
  const menu = document.querySelector('#cash-menu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  document.querySelectorAll('[data-menu-toggle][aria-expanded="true"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
}
function openCashMenu(button) {
  const menu = document.querySelector('#cash-menu');
  const entry = state.cash.find(item => String(item.id) === button.dataset.id);
  if (!entry) return;
  const id = escapeHtml(entry.id);
  menu.innerHTML = entry.status === 'Pending'
    ? `<button class="menu-item" type="button" role="menuitem" data-cash-action="Approved" data-id="${id}">Approve</button><button class="menu-item" type="button" role="menuitem" data-cash-action="Rejected" data-id="${id}">Reject</button>`
    : '<p class="menu-empty">No actions available</p>';
  menu.hidden = false;
  button.setAttribute('aria-expanded', 'true');
  const anchor = button.getBoundingClientRect();
  const box = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(anchor.right - box.width, window.innerWidth - box.width - 8));
  const below = anchor.bottom + 4;
  const top = below + box.height > window.innerHeight - 8 ? Math.max(8, anchor.top - box.height - 4) : below;
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
function renderCashStaffOptions() {
  const select = document.querySelector('#cash-staff');
  const selected = select.value;
  const people = state.staff.filter(person => person.role === 'Staff' && person.status === 'Active');
  select.innerHTML = people.map(person => `<option value="${escapeHtml(person.id)}">${escapeHtml(person.name)}</option>`).join('');
  if (people.some(person => person.id === selected)) select.value = selected;
}
async function updateCashAdvanceLimit() {
  const userId = document.querySelector('#cash-staff').value;
  const [start, end] = document.querySelector('#cash-cutoff').value.split('|');
  const note = document.querySelector('#cash-advance-limit');
  const amount = document.querySelector('#cash-form').elements.amount;
  if (!userId) { note.textContent = 'Select a staff member'; return; }
  try {
    const result = await apiRequest(`/cash-advances/limit?userId=${encodeURIComponent(userId)}&start=${start}&end=${end}`);
    amount.max = result.data.available.toFixed(2);
    note.textContent = `Max PHP ${formatAmount(result.data.max)} (50% net); PHP ${formatAmount(result.data.available)} available`;
  } catch {
    note.textContent = 'Max PHP 1,640.00 (50% net)';
  }
}

function renderPolicies() {
  const today = manilaToday();
  document.querySelector('#policy-rows').innerHTML = state.policies.map(policy => {
    const status = policy.effectiveDate > today && policy.status === 'Current' ? 'Scheduled' : policy.status;
    return `<tr><td>v${escapeHtml(policy.version)}</td><td>${escapeHtml(formatDate(policy.effectiveDate))}</td><td>${escapeHtml(policy.savedBy || '')}</td><td><span class="badge badge-${status === 'Current' ? 'green' : status === 'Scheduled' ? 'gold' : 'neutral'}">${escapeHtml(status)}</span></td></tr>`;
  }).join('');
}
function fillPolicyForm() {
  const p = state.policy;
  const form = document.querySelector('#policy-form');
  if (!p || !form) return;
  form.elements.shiftStart.value = p.shiftStart;
  form.elements.gracePeriod.value = p.graceMinutes;
  form.elements.lateRule.value = p.lateRule;
  form.elements.undertimeRule.value = p.undertimeRule;
  form.elements.standardShift.value = p.standardShift;
  form.elements.otAfter.value = p.overtimeAfterHours;
  form.elements.otMultiplier.value = p.otMultiplier;
  form.elements.effectiveDate.value = manilaToday();
}

/* ------------------------------- payroll ------------------------------ */

function cutoffValue() {
  return document.querySelector('#payroll-cutoff').value;
}
function selectedWageTable() {
  const category = document.querySelector('#wage-category').value;
  return WAGE_TABLES.find(table => table.region === 'NCR' && table.category === category);
}
function payrollRows() {
  const table = selectedWageTable();
  return state.payslips.map(p => ({
    id: p.payslip_id, staffName: p.name, daysWorked: p.days_worked, hours: p.total_hours_worked,
    basicPay: p.basic_pay, lateDeduction: p.late_undertime_deduction, lateMinutes: p.late_undertime_minutes,
    overtimeHours: p.overtime_hours, overtimePay: p.overtime_pay, cashAdvanceDeduction: p.cash_advance_deduction,
    netPay: p.net_pay, hourlyRate: p.hourly_rate, status: p.status,
    wageCompliant: p.hourly_rate * p.standard_shift >= (table?.dailyMinimum || 0)
  }));
}
function unresolvedFlaggedEntries() {
  const [start, end] = cutoffValue().split('|');
  return state.flagged.filter(entry => entry.status === 'Pending' && entry.date >= start && entry.date <= end);
}
function showPayslip(row) {
  const details = [
    ['Employee', row.staffName],
    ['Days worked', row.daysWorked],
    ['Hours worked', formatAmount(row.hours)],
    ['Hourly rate (PHP)', formatAmount(row.hourlyRate)],
    ['Basic pay (PHP)', formatAmount(row.basicPay)],
    [`Late/undertime deduction (PHP, ${row.lateMinutes} min)`, formatAmount(row.lateDeduction)],
    ['Overtime hours', formatAmount(row.overtimeHours)],
    ['Overtime pay (PHP)', formatAmount(row.overtimePay)],
    ['Cash advance deduction (PHP)', formatAmount(row.cashAdvanceDeduction)],
    ['Net pay (PHP)', formatAmount(row.netPay)],
    ['Payroll status', row.status === 'Finalized' ? 'Finalized' : 'Draft']
  ];
  document.querySelector('#payslip-title').textContent = `Payslip - ${row.staffName}`;
  document.querySelector('#payslip-description').textContent = `${cutoffLabel(cutoffValue())}. Net pay = basic pay + overtime pay - late/undertime - cash advance.`;
  document.querySelector('#payslip-details').innerHTML = details
    .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('');
  document.querySelector('#payslip-dialog').showModal();
}
function renderPayroll() {
  const rows = document.querySelector('#payroll-rows');
  const warning = document.querySelector('#payroll-warning');
  const finalizeButton = document.querySelector('#finalize-payroll');
  const list = payrollRows();
  const finalized = list.length > 0 && list.every(row => row.status === 'Finalized');
  document.querySelector('#wage-category').disabled = finalized;
  document.querySelector('#payroll-compute').disabled = finalized;
  if (!list.length) {
    rows.innerHTML = '<tr><td colspan="11">Select Compute to calculate this cutoff.</td></tr>';
    warning.hidden = true;
    finalizeButton.disabled = true;
    finalizeButton.textContent = 'Finalize Payslips';
    return;
  }
  rows.innerHTML = list.map(row => {
    const status = row.status === 'Finalized' ? 'Finalized' : row.wageCompliant ? 'Draft' : 'Below minimum wage';
    const badge = status === 'Finalized' ? 'green' : row.wageCompliant ? 'gold' : 'red';
    return `<tr><td>${escapeHtml(row.staffName)}</td><td>${row.daysWorked}</td><td>${formatAmount(row.hours)}</td><td>${formatAmount(row.basicPay)}</td><td>${formatAmount(row.lateDeduction)}</td><td>${formatAmount(row.overtimeHours)}</td><td>${formatAmount(row.overtimePay)}</td><td>${formatAmount(row.cashAdvanceDeduction)}</td><td>${formatAmount(row.netPay)}</td><td><span class="badge badge-${badge}">${status}</span></td><td><button class="action-button" data-payslip-view="${row.id}">View</button></td></tr>`;
  }).join('');
  const pending = unresolvedFlaggedEntries();
  const belowMinimum = list.filter(row => !row.wageCompliant);
  const negativeNet = list.filter(row => row.netPay < 0);
  const warnings = [];
  if (pending.length) warnings.push(`${pending.length} flagged attendance entr${pending.length === 1 ? 'y is' : 'ies are'} unresolved and not paid yet; resolve ${pending.length === 1 ? 'it' : 'them'} and compute again before finalizing.`);
  if (belowMinimum.length) warnings.push(`${belowMinimum.map(row => row.staffName).join(', ')} have an hourly rate below the selected NCR minimum-wage equivalent.`);
  if (negativeNet.length) warnings.push(`${negativeNet.map(row => row.staffName).join(', ')} have negative net pay.`);
  warning.textContent = warnings.join(' ');
  warning.hidden = warnings.length === 0;
  finalizeButton.disabled = finalized || pending.length > 0 || belowMinimum.length > 0 || negativeNet.length > 0;
  finalizeButton.textContent = finalized ? 'Payslips Finalized' : 'Finalize Payslips';
}

/* ------------------------------ photos -------------------------------- */

async function openPhotos(recordId, title) {
  const dialog = document.querySelector('#photo-dialog');
  const gallery = document.querySelector('#photo-gallery');
  const text = document.querySelector('#photo-message');
  document.querySelector('#photo-title').textContent = title ? `Attendance photos: ${title}` : 'Attendance photos';
  gallery.innerHTML = '';
  text.textContent = 'Loading photos...';
  dialog.showModal();
  try {
    const result = await apiRequest(`/attendance/${recordId}/photos`);
    if (!result.data.length) {
      text.textContent = 'No photo was captured for this entry.';
      return;
    }
    text.textContent = 'Photos captured by the staff member when timing in and out.';
    result.data.forEach(photo => {
      const figure = document.createElement('figure');
      const caption = document.createElement('figcaption');
      caption.textContent = `${photo.type === 'TimeIn' ? 'Time in' : 'Time out'} - ${photo.capturedAt}`;
      const image = document.createElement('img');
      image.alt = `${photo.type} photo`;
      if (typeof photo.data === 'string' && photo.data.startsWith('data:image/')) image.src = photo.data;
      figure.append(caption, image);
      gallery.append(figure);
    });
  } catch (error) {
    text.textContent = `Could not load photos: ${error.message}`;
  }
}

/* ------------------------------ navigation ---------------------------- */

function showPage(page) {
  document.querySelectorAll('.page').forEach(section => { section.hidden = section.id !== page; });
  document.querySelectorAll('.nav-link').forEach(button => button.classList.toggle('active', button.dataset.page === (page === 'policy' ? 'flagged' : page)));
}

document.querySelector('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const loginError = document.querySelector('#login-error');
  const values = new FormData(form);
  loginError.hidden = true;
  submitButton.disabled = true;
  try {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: { username: values.get('username'), pin: values.get('pin') }
    });
    if (typeof result.token !== 'string' || !result.token) {
      throw new Error('The backend did not return a session token.');
    }
    // One login for everyone: the server says who this is, the page decides where to go.
    if (result.user?.role === 'Staff') {
      const u = result.user;
      localStorage.setItem(STAFF_SESSION_KEY, JSON.stringify({
        token: result.token,
        user: { id: String(u.id), username: u.username, role: 'staff', name: [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username },
        exp: Date.now() + 12 * 3600e3
      }));
      window.location.assign(STAFF_HOME);
      return;
    }
    if (result.user?.role !== 'Admin') throw new Error('This account type cannot log in here.');
    sessionStorage.setItem(TOKEN_KEY, result.token);
    await loadAll();
    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
    showPage('dashboard');
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    loginError.textContent = error.message;
    loginError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});
document.querySelector('#logout').addEventListener('click', () => {
  sessionStorage.removeItem(TOKEN_KEY);
  Object.assign(state, { staff: [], day: null, summaryDay: null, flagged: [], cash: [], payslips: [], cutoffs: [] });
  document.querySelector('#app').hidden = true;
  document.querySelector('#login').hidden = false;
});
document.querySelector('#show-pin').addEventListener('click', event => {
  const pin = document.querySelector('#pin');
  pin.type = pin.type === 'password' ? 'text' : 'password';
  event.currentTarget.textContent = pin.type === 'password' ? 'Show' : 'Hide';
});

/* --------------------------- payroll controls ------------------------- */

document.querySelector('#payroll-cutoff').addEventListener('change', () => {
  refresh(loadPayroll);
  updateCashAdvanceLimit();
});
document.querySelector('#wage-category').addEventListener('change', renderPayroll);
document.querySelector('#payroll-compute').addEventListener('click', async event => {
  const button = event.currentTarget;
  const [start, end] = cutoffValue().split('|');
  button.disabled = true;
  try {
    const cutoff = await apiRequest('/payroll/cutoffs/ensure', { method: 'POST', body: { start_date: start, end_date: end } });
    await apiRequest(`/payroll/cutoffs/${cutoff.data.cutoff_id}/generate`, { method: 'POST' });
    await loadCutoffs();
    await Promise.all([loadPayroll(), loadFlagged()]);
    notify(`Payroll computed for ${cutoffLabel(cutoffValue())}. Review warnings before finalizing.`);
  } catch (error) {
    notify(`Could not compute payroll: ${error.message}`, true);
  } finally {
    button.disabled = false;
    renderPayroll();
  }
});
document.querySelector('#finalize-payroll').addEventListener('click', async () => {
  const cutoff = currentCutoff();
  if (!cutoff) return;
  const blockers = [];
  if (unresolvedFlaggedEntries().length) blockers.push('resolve flagged attendance');
  if (payrollRows().some(row => !row.wageCompliant)) blockers.push('correct hourly rates below minimum wage');
  if (payrollRows().some(row => row.netPay < 0)) blockers.push('resolve negative net pay');
  if (blockers.length) {
    notify(`Cannot finalize payroll: ${blockers.join('; ')}.`, true);
    return;
  }
  try {
    await apiRequest(`/payroll/cutoffs/${cutoff.cutoff_id}/finalize`, { method: 'POST' });
    await loadCutoffs();
    await Promise.all([loadPayroll(), loadCash()]);
    notify('Payslips finalized and locked. Approved cash advances for this cutoff are marked as deducted.');
  } catch (error) {
    notify(`Could not finalize payroll: ${error.message}`, true);
  }
});

/* ------------------------------ click handling ------------------------ */

document.addEventListener('click', event => {
  const target = event.target;
  const navigation = target.closest('[data-page], [data-go]');
  if (navigation) showPage(navigation.dataset.page || navigation.dataset.go);

  const opener = target.closest('[data-open]');
  if (opener) {
    const dialog = document.getElementById(opener.dataset.open);
    if (opener.dataset.open === 'staff-dialog') {
      const form = document.querySelector('#staff-form');
      form.reset();
      form.elements.role.value = 'Staff';
    }
    if (opener.dataset.open === 'review-dialog') {
      const entry = state.flagged.find(item => String(item.id) === opener.closest('tr').dataset.id);
      if (!entry) return;
      dialog.dataset.recordId = entry.id;
      dialog.querySelector('h2').textContent = `Review: ${entry.name}, ${formatDate(entry.date)}`;
      dialog.querySelector('.modal-description').textContent = `Reason flagged: ${entry.reason}. Check the photos, then approve or reject.`;
      const form = dialog.querySelector('form');
      form.elements.timeIn.value = entry.timeIn || '';
      form.elements.timeOut.value = entry.timeOut || '';
      form.elements.timeOut.readOnly = Boolean(entry.timeOut);
      form.elements.remarks.value = '';
      form.elements.remarks.setCustomValidity('');
    }
    dialog.showModal();
  }

  const payslipButton = target.closest('[data-payslip-view]');
  if (payslipButton) {
    const row = payrollRows().find(item => String(item.id) === payslipButton.dataset.payslipView);
    if (row) showPayslip(row);
  }

  const photoAction = target.closest('[data-photo-action]');
  if (photoAction) {
    const entry = state.flagged.find(item => String(item.id) === photoAction.closest('tr').dataset.id);
    if (entry) openPhotos(entry.id, `${entry.name}, ${formatDate(entry.date)}`);
  }
  const dashboardPhoto = target.closest('[data-dashboard-photo]');
  if (dashboardPhoto) openPhotos(dashboardPhoto.dataset.dashboardPhoto, dashboardPhoto.dataset.title);

  const closeButton = target.closest('[data-close-dialog]');
  if (closeButton) closeButton.closest('dialog').close();

  const filter = target.closest('[data-filter]');
  if (filter) {
    const group = filter.closest('[data-filter-group]');
    group.querySelectorAll('.filter').forEach(button => button.classList.toggle('active', button === filter));
    applyFilter(group);
  }

  const cashAction = target.closest('[data-cash-action]');
  if (cashAction) {
    const id = cashAction.dataset.id;
    const status = cashAction.dataset.cashAction;
    closeCashMenu();
    apiRequest(`/cash-advances/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status } })
      .then(async () => {
        await loadCash();
        updateCashAdvanceLimit();
        notify(`Cash advance ${status.toLowerCase()}.`);
      })
      .catch(error => notify(error.message, true));
  }
});

document.addEventListener('click', event => {
  const toggle = event.target.closest('[data-menu-toggle]');
  if (toggle) {
    const wasOpen = toggle.getAttribute('aria-expanded') === 'true';
    closeCashMenu();
    if (!wasOpen) openCashMenu(toggle);
    return;
  }
  if (!document.querySelector('#cash-menu').contains(event.target)) closeCashMenu();
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeCashMenu(); });
window.addEventListener('resize', closeCashMenu);
window.addEventListener('scroll', closeCashMenu, true);

/* ------------------------------- forms -------------------------------- */

document.querySelector('#day-picker').addEventListener('change', event => {
  if (event.currentTarget.value) refresh(() => loadDay(event.currentTarget.value));
});
document.querySelector('#day-today').addEventListener('click', () => refresh(() => loadDay(manilaToday())));

document.querySelector('#staff-form').addEventListener('submit', async event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  if (values.get('role') === 'Admin' && !window.confirm('Create an Admin account? Admins have full access to payroll and staff accounts, and are not tracked in attendance or payroll.')) return;
  const nameParts = String(values.get('name')).trim().split(/\s+/).filter(Boolean);
  if (nameParts.length < 2) {
    notify('Enter both a first and last name.', true);
    return;
  }
  const firstName = nameParts.shift();
  const lastName = nameParts.pop();
  const middleName = nameParts.join(' ');
  try {
    await apiRequest('/employees', {
      method: 'POST',
      body: {
        firstName, middleName, lastName,
        username: values.get('username'),
        email: values.get('email'),
        pin: values.get('pin'),
        role: values.get('role'),
        jobPosition: values.get('position'),
        hourlyRate: Number(values.get('rate'))
      }
    });
  } catch (error) {
    notify(`Could not create employee: ${error.message}`, true);
    return;
  }
  form.reset();
  form.elements.role.value = 'Staff';
  form.closest('dialog').close('save');
  await refresh(loadEmployees, loadDay);
  notify('Employee account saved to the database.');
});

document.querySelector('#cash-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = new FormData(form);
  const [cutoffStart, cutoffEnd] = String(values.get('cutoff')).split('|');
  try {
    await apiRequest('/cash-advances', {
      method: 'POST',
      body: {
        userId: Number(values.get('staffName')),
        amount: Number(values.get('amount')),
        dateGranted: values.get('dateGranted'),
        cutoffStart, cutoffEnd,
        notes: String(values.get('notes') || '').trim()
      }
    });
  } catch (error) {
    notify(error.message, true);
    return;
  }
  form.reset();
  await refresh(loadCash, loadCutoffs);
  updateCashAdvanceLimit();
  notify('Cash advance saved as pending.');
});
document.querySelector('#cash-search').addEventListener('input', () => applyFilter(document.querySelector('[data-filter-group="cash"]')));
document.querySelector('#cash-staff').addEventListener('change', updateCashAdvanceLimit);
document.querySelector('#cash-cutoff').addEventListener('change', updateCashAdvanceLimit);

document.querySelector('#policy-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  try {
    const saved = await apiRequest('/policy', {
      method: 'PUT',
      body: {
        shiftStart: values.get('shiftStart'),
        graceMinutes: Number(values.get('gracePeriod')),
        lateRule: String(values.get('lateRule')).trim(),
        undertimeRule: String(values.get('undertimeRule')).trim(),
        standardShift: Number(values.get('standardShift')),
        overtimeAfterHours: Number(values.get('otAfter')),
        otMultiplier: Number(values.get('otMultiplier')),
        effectiveDate: values.get('effectiveDate')
      }
    });
    await loadPolicies();
    notify(`Policy version v${saved.version} saved.`);
  } catch (error) {
    notify(`Could not save the policy: ${error.message}`, true);
  }
});

document.querySelector('#review-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const decision = event.submitter?.value;
  if (decision === 'cancel') {
    form.closest('dialog').close('cancel');
    return;
  }
  const remarks = form.elements.remarks.value.trim();
  const id = form.closest('dialog').dataset.recordId;
  const entry = state.flagged.find(item => String(item.id) === id);
  if (!entry || !['approve', 'reject'].includes(decision)) return;
  if (!remarks) {
    form.elements.remarks.setCustomValidity('Enter remarks before saving the decision.');
    form.elements.remarks.reportValidity();
    return;
  }
  form.elements.remarks.setCustomValidity('');
  if (decision === 'approve' && !entry.timeOut && !form.elements.timeOut.value) {
    notify('Enter the correct Time Out before approving this entry.', true);
    return;
  }
  try {
    await apiRequest(`/attendance/${encodeURIComponent(id)}/review`, {
      method: 'PATCH',
      body: {
        decision: decision === 'approve' ? 'Approved' : 'Rejected',
        notes: remarks,
        timeOut: entry.timeOut ? undefined : form.elements.timeOut.value || undefined
      }
    });
  } catch (error) {
    notify(`Could not save the decision: ${error.message}`, true);
    return;
  }
  form.closest('dialog').close(decision);
  await refresh(loadFlagged, () => loadDay(state.day?.date), loadPayroll);
  notify(`Attendance entry ${decision === 'approve' ? 'approved' : 'rejected'}.`);
});

document.querySelector('#print').addEventListener('click', () => window.print());
document.querySelector('#print-payslip').addEventListener('click', () => {
  document.body.classList.add('print-payslip');
  window.print();
});
window.addEventListener('afterprint', () => document.body.classList.remove('print-payslip'));

/* ------------------------------- startup ------------------------------ */

async function restoreSession() {
  if (!sessionStorage.getItem(TOKEN_KEY)) return;
  const loginError = document.querySelector('#login-error');
  try {
    const me = await apiRequest('/auth/me');
    if (me.account_role !== 'Admin') throw new Error('This session is not an admin session.');
    await loadAll();
    document.querySelector('#login').hidden = true;
    document.querySelector('#app').hidden = false;
  } catch (error) {
    sessionStorage.removeItem(TOKEN_KEY);
    loginError.textContent = `Your session could not be restored: ${error.message}`;
    loginError.hidden = false;
  }
}
renderStaff();
renderPayroll();
restoreSession();
try {
  const notice = sessionStorage.getItem('sc_login_notice');
  if (notice) {
    sessionStorage.removeItem('sc_login_notice');
    const box = document.querySelector('#login-error');
    box.textContent = notice; box.hidden = false;
  }
} catch { /* storage unavailable */ }

function showToday() {
  const now = new Date();
  const date = now.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  document.querySelector('#today').textContent = `${date} · ${time}`;
}
showToday();
setInterval(showToday, 1000);

/* ------------------------------ SOP management ------------------------ */

function openSopDialog(sop) {
  const dialog = document.querySelector('#sop-dialog');
  const form = document.querySelector('#sop-form');
  form.reset();
  dialog.dataset.sopId = sop ? sop.id : '';
  document.querySelector('#sop-dialog-title').textContent = sop ? `Edit SOP (${sop.version})` : 'New SOP';
  if (sop) {
    form.elements.title.value = sop.title;
    form.elements.body.value = sop.body || '';
    form.elements.status.value = sop.status === 'draft' ? 'draft' : 'published';
  }
  dialog.showModal();
}
document.querySelector('#sop-new').addEventListener('click', () => openSopDialog(null));
document.querySelector('#sop-rows').addEventListener('click', event => {
  const button = event.target.closest('[data-sop-edit]');
  if (!button) return;
  const sop = state.sops.find(item => String(item.id) === button.dataset.sopEdit);
  if (sop) openSopDialog(sop);
});
document.querySelector('#sop-form').addEventListener('submit', async event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const form = event.currentTarget;
  const dialog = form.closest('dialog');
  const values = new FormData(form);
  const id = dialog.dataset.sopId;
  try {
    await apiRequest(id ? `/sops/${id}` : '/sops', {
      method: id ? 'PUT' : 'POST',
      body: {
        title: String(values.get('title')).trim(),
        body: String(values.get('body')).trim(),
        status: values.get('status')
      }
    });
  } catch (error) {
    notify(`Could not save SOP: ${error.message}`, true);
    return;
  }
  dialog.close('save');
  await refresh(loadSops);
  notify(id ? 'SOP updated.' : 'SOP created.');
});

/* ------------------------------ staff account actions ----------------- */

document.querySelector('#staff-rows').addEventListener('click', async event => {
  const button = event.target.closest('[data-staff-act]');
  if (!button) return;
  const person = state.staff.find(item => item.id === button.dataset.id);
  if (!person) return;
  const act = button.dataset.staffAct;

  if (act === 'pin') {
    const dialog = document.querySelector('#pin-dialog');
    document.querySelector('#pin-form').reset();
    dialog.dataset.userId = person.id;
    document.querySelector('#pin-dialog-title').textContent = `Reset PIN: ${person.name}`;
    dialog.showModal();
    return;
  }

  if (act === 'promote') {
    openPromoteDialog(person);
    return;
  }

  const actions = {
    deactivate: { url: `/employees/${person.id}/deactivate`, done: `${person.name} was deactivated and can no longer log in.`,
      confirm: `Deactivate ${person.name}? They will be unable to log in. Their attendance and payroll history is kept.` },
    reactivate: { url: `/employees/${person.id}/reactivate`, done: `${person.name} was reactivated.` },
    unlock: { url: `/auth/users/${person.id}/unlock`, done: `${person.name}'s account was unlocked.` }
  };
  const action = actions[act];
  if (!action) return;
  if (action.confirm && !window.confirm(action.confirm)) return;
  button.disabled = true;
  try {
    await apiRequest(action.url, { method: 'PATCH' });
  } catch (error) {
    button.disabled = false;
    notify(`Could not update account: ${error.message}`, true);
    return;
  }
  await refresh(loadEmployees, loadDay);
  notify(action.done);
});

document.querySelector('#pin-form').addEventListener('submit', async event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const form = event.currentTarget;
  const dialog = form.closest('dialog');
  const pin = String(new FormData(form).get('pin') || '').trim();
  if (!/^\d{4,6}$/.test(pin)) {
    notify('PIN must be 4 to 6 digits.', true);
    return;
  }
  const person = state.staff.find(item => item.id === dialog.dataset.userId);
  try {
    await apiRequest(`/employees/${dialog.dataset.userId}/pin`, { method: 'PATCH', body: { pin } });
  } catch (error) {
    notify(`Could not reset PIN: ${error.message}`, true);
    return;
  }
  form.reset();
  dialog.close('save');
  notify(`PIN reset for ${person ? person.name : 'the account'}. Give them the new PIN privately.`);
});

/* ------------------------------ time-in schedule ---------------------- */

document.querySelector('#schedule-form').addEventListener('submit', async event => {
  event.preventDefault();
  const values = new FormData(event.currentTarget);
  try {
    await apiRequest('/schedules', {
      method: 'POST',
      body: {
        effectiveFrom: values.get('effectiveFrom'),
        effectiveTo: values.get('effectiveTo') || null,
        timeInOpens: values.get('timeInOpens'),
        regularTimeOut: values.get('regularTimeOut') || null,
        otGraceMinutes: Number(values.get('otGrace'))
      }
    });
  } catch (error) {
    notify(`Could not save the schedule: ${error.message}`, true);
    return;
  }
  await loadSchedules();
  notify('Schedule saved.');
});
document.querySelector('#schedule-rows').addEventListener('click', async event => {
  const button = event.target.closest('[data-schedule-del]');
  if (!button) return;
  if (!window.confirm('Remove this schedule? Earlier attendance records are not changed.')) return;
  try {
    await apiRequest(`/schedules/${button.dataset.scheduleDel}`, { method: 'DELETE' });
  } catch (error) {
    notify(`Could not remove the schedule: ${error.message}`, true);
    return;
  }
  await loadSchedules();
  notify('Schedule removed.');
});

/* ------------------------------ promotions and pay changes ------------ */

async function openPromoteDialog(person) {
  const dialog = document.querySelector('#promote-dialog');
  const form = document.querySelector('#promote-form');
  form.reset();
  dialog.dataset.userId = person.id;
  dialog.dataset.position = person.position;
  dialog.dataset.rate = String(person.rate);
  dialog.dataset.role = person.role;
  document.querySelector('#promote-title').textContent = `Promote / Edit: ${person.name}`;
  document.querySelector('#promote-current').textContent = `Current: ${person.position || 'no position'}, PHP ${formatAmount(person.rate)} per hour, ${person.role}`;
  form.elements.position.value = person.position;
  form.elements.rate.value = Number(person.rate) || '';
  form.elements.role.value = person.role === 'Admin' ? 'Admin' : 'Staff';
  form.elements.effectiveDate.value = manilaToday();
  form.elements.effectiveDate.max = manilaToday();
  document.querySelector('#promote-history').innerHTML = '<tr><td colspan="5">Loading history...</td></tr>';
  dialog.showModal();
  await loadPromotionHistory(person.id);
}

async function loadPromotionHistory(userId) {
  const body = document.querySelector('#promote-history');
  try {
    const result = await apiRequest(`/employees/${userId}/promotions`);
    const rows = result.data || [];
    body.innerHTML = rows.length
      ? rows.map(item => `<tr><td>${escapeHtml(formatDate(item.effectiveFrom))}</td><td>${escapeHtml(item.jobPosition || '--')}</td><td>${item.hourlyRate != null ? 'PHP ' + formatAmount(item.hourlyRate) : '--'}</td><td>${escapeHtml(item.role || '--')}</td><td>${escapeHtml(item.reason || '')}${item.changedBy ? `<br><small>by ${escapeHtml(item.changedBy)}</small>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="5">No changes recorded yet.</td></tr>';
  } catch (error) {
    body.innerHTML = '<tr><td colspan="5">History is not available yet.</td></tr>';
  }
}

document.querySelector('#promote-form').addEventListener('submit', async event => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const form = event.currentTarget;
  const dialog = form.closest('dialog');
  const values = new FormData(form);
  const body = { effectiveDate: values.get('effectiveDate'), reason: String(values.get('reason') || '').trim() };
  const position = String(values.get('position') || '').trim();
  const rate = Number(values.get('rate'));
  const role = values.get('role');
  if (position && position !== dialog.dataset.position) body.jobPosition = position;
  if (rate > 0 && rate !== Number(dialog.dataset.rate)) body.hourlyRate = rate;
  if (role && role !== dialog.dataset.role) body.role = role;
  if (!body.jobPosition && !body.hourlyRate && !body.role) {
    notify('Change at least one of position, hourly rate or role.', true);
    return;
  }
  if (body.role === 'Admin' && !window.confirm('Make this account an Admin? Admins have full access to payroll and staff accounts, and are not tracked in attendance or payroll.')) return;
  try {
    await apiRequest(`/employees/${dialog.dataset.userId}/promotions`, { method: 'POST', body });
  } catch (error) {
    notify(`Could not save the change: ${error.message}`, true);
    return;
  }
  dialog.close('save');
  await refresh(loadEmployees, loadDay);
  notify('Change saved. Press Compute on the Payroll page to update open draft payslips.');
});
