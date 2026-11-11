'use strict';
/* ===================== Agriculture Information System ===================== */

/* ---------- Setup ---------- */
const READY = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
const db = READY ? supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;
const PAGE_SIZE = 10;
const ROLE_ADMIN = 1;

const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const peso = v => '\u20B1' + Number(v).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v).toLocaleString('en-PH', { maximumFractionDigits: 2 });
const dt = v => new Date(v).toLocaleString();
const show = (v, f) => (v == null || v === '' ? '' : (f ? f(v) : v));
const setVis = (sel, on) => $(sel).classList.toggle('d-none', !on);
const spinner = '<div class="text-center py-5"><div class="spinner-border text-success"></div></div>';

let USER = null;
let chart = null;
const STATE = {};
const isAdmin = () => !!USER && USER.roleId === ROLE_ADMIN;
const canWrite = m => (m.adminOnly ? isAdmin() : true);
const current = () => location.hash.replace(/^#\//, '') || 'dashboard';

/* ---------- Messages ---------- */
function flash(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = `alert alert-${type} alert-dismissible shadow-sm`;
  el.innerHTML = `${esc(msg)}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  $('#alerts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Friendly messages only. Technical details go to the browser console, not the screen.
function errMsg(e, action = 'save') {
  console.error(e);
  const c = e && e.code;
  if (c === 'P0001') return e.message;
  if (c === '23503') return action === 'delete'
    ? 'This record is still used by other records, so it cannot be deleted. Remove the related records first.'
    : 'The selected related record does not exist.';
  if (c === '23505') return 'A record with the same value already exists.';
  if (c === '23514') return 'A value is outside the allowed range or breaks a data rule.';
  if (c === '23502') return 'A required field is missing.';
  if (c === '42501') return 'You do not have permission to do this.';
  return action === 'load' ? 'Unable to load data. Please try again.' : 'The operation could not be completed. Please try again.';
}

/* ---------- Dropdown sources (lookup tables: label shown, numeric ID stored) ---------- */
const lk = (table, id, text) => ({ table, id, order: id, label: r => r[text] });
const REF = {
  irrigation: lk('irrigation_types', 'irrigation_type_id', 'description'),
  category: lk('crop_categories', 'category_id', 'category_name'),
  status: lk('planting_statuses', 'status_id', 'status_name'),
  grade: lk('quality_grades', 'grade_id', 'grade_name'),
  remark: lk('harvest_remarks', 'remark_id', 'remark_description'),
  crop: lk('crops', 'crop_id', 'crop_name'),
  farmer: { table: 'farmers', id: 'farmer_id', order: 'last_name', label: r => `${r.last_name}, ${r.first_name}` },
  farm: { table: 'v_farm_detail', id: 'farm_id', order: 'farm_name', label: r => `${r.farm_name} (${r.farmer_name})` },
  planting: { table: 'v_planting_detail', id: 'planting_id', order: 'planting_id', label: r => `#${r.planting_id} - ${r.farm_name} / ${r.crop_name} (${r.planting_date})` },
  municipality: { table: 'farmers', id: 'municipality', order: 'municipality', label: r => r.municipality }
};

async function getOptions(ref) {
  const { data, error } = await db.from(ref.table).select('*').order(ref.order).limit(1000);
  if (error) { flash(errMsg(error, 'load'), 'danger'); return []; }
  const seen = new Set(), out = [];
  for (const r of data) {
    const value = r[ref.id];
    if (value == null || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: ref.label(r) });
  }
  return out;
}

/* ---------- Module definitions ----------
   cols   : [column key, heading, optional formatter]  (read from the JOIN view)
   fields : form fields (write to the table)                                          */
const MODULES = {
  farmers: {
    title: 'Farmers', single: 'Farmer', table: 'farmers', view: 'farmers', pk: 'farmer_id',
    search: ['first_name', 'last_name', 'contact_no', 'barangay', 'municipality'],
    filter: { k: 'municipality', l: 'Municipalities', ref: REF.municipality },
    cols: [['farmer_id', 'ID'], ['first_name', 'First Name'], ['last_name', 'Last Name'], ['contact_no', 'Contact No.'], ['barangay', 'Barangay'], ['municipality', 'Municipality']],
    fields: [
      { k: 'first_name', l: 'First Name', t: 'text', req: 1, len: 50 },
      { k: 'last_name', l: 'Last Name', t: 'text', req: 1, len: 50 },
      { k: 'contact_no', l: 'Contact No.', t: 'text', len: 20, pattern: /^[0-9+() -]{7,20}$/, msg: 'Contact No. must be 7-20 characters (digits, +, -, spaces, parentheses).' },
      { k: 'barangay', l: 'Barangay', t: 'text', req: 1, len: 80 },
      { k: 'municipality', l: 'Municipality / City', t: 'text', req: 1, len: 80 }
    ]
  },
  farms: {
    title: 'Farms', single: 'Farm', table: 'farms', view: 'v_farm_detail', pk: 'farm_id',
    search: ['farm_name', 'location', 'farmer_name'],
    filter: { k: 'irrigation_type_id', l: 'Irrigation Types', ref: REF.irrigation },
    cols: [['farm_id', 'ID'], ['farm_name', 'Farm'], ['farmer_name', 'Farmer'], ['location', 'Location'], ['area_hectares', 'Area (ha)', num], ['irrigation', 'Irrigation']],
    fields: [
      { k: 'farmer_id', l: 'Farmer', t: 'select', req: 1, ref: REF.farmer },
      { k: 'farm_name', l: 'Farm Name', t: 'text', req: 1, len: 100 },
      { k: 'location', l: 'Location', t: 'text', req: 1, len: 150 },
      { k: 'area_hectares', l: 'Area (hectares)', t: 'number', req: 1, min: 0.01, max: 100000 },
      { k: 'irrigation_type_id', l: 'Irrigation Type', t: 'select', req: 1, ref: REF.irrigation }
    ]
  },
  crops: {
    title: 'Crops', single: 'Crop', table: 'crops', view: 'v_crop_detail', pk: 'crop_id', adminOnly: true,
    search: ['crop_name', 'category_name'],
    filter: { k: 'category_id', l: 'Categories', ref: REF.category },
    cols: [['crop_id', 'ID'], ['crop_name', 'Crop'], ['category_name', 'Category'], ['growth_days', 'Growth (days)'], ['price_per_kg', 'Price / kg', peso]],
    fields: [
      { k: 'crop_name', l: 'Crop Name', t: 'text', req: 1, len: 80 },
      { k: 'category_id', l: 'Category', t: 'select', req: 1, ref: REF.category },
      { k: 'growth_days', l: 'Growth Period (days)', t: 'number', req: 1, int: 1, min: 1, max: 1000 },
      { k: 'price_per_kg', l: 'Selling Price per kg', t: 'number', req: 1, min: 0, max: 100000 }
    ]
  },
  plantings: {
    title: 'Planting Records', single: 'Planting Record', table: 'plantings', view: 'v_planting_detail', pk: 'planting_id',
    search: ['farm_name', 'farmer_name', 'crop_name', 'status_name'],
    filter: { k: 'status_id', l: 'Statuses', ref: REF.status },
    cols: [['planting_id', 'ID'], ['farm_name', 'Farm'], ['crop_name', 'Crop'], ['planting_date', 'Planted'], ['expected_harvest_date', 'Expected Harvest'], ['area_planted', 'Area (ha)', num], ['status_name', 'Status']],
    fields: [
      { k: 'farm_id', l: 'Farm', t: 'select', req: 1, ref: REF.farm },
      { k: 'crop_id', l: 'Crop', t: 'select', req: 1, ref: REF.crop },
      { k: 'planting_date', l: 'Planting Date', t: 'date', req: 1 },
      { k: 'expected_harvest_date', l: 'Expected Harvest Date', t: 'date' },
      { k: 'area_planted', l: 'Area Planted (hectares)', t: 'number', req: 1, min: 0.01, max: 100000 },
      { k: 'status_id', l: 'Status', t: 'select', req: 1, ref: REF.status }
    ],
    check: async v => {
      const e = {};
      if (v.expected_harvest_date && v.expected_harvest_date < v.planting_date) {
        e.expected_harvest_date = 'Expected harvest date cannot be earlier than the planting date.';
      }
      return e;
    }
  },
  harvests: {
    title: 'Harvest Records', single: 'Harvest Record', table: 'harvests', view: 'v_harvest_detail', pk: 'harvest_id',
    search: ['farm_name', 'crop_name', 'grade_name', 'remark_description'],
    filter: { k: 'grade_id', l: 'Quality Grades', ref: REF.grade },
    cols: [['harvest_id', 'ID'], ['farm_name', 'Farm'], ['crop_name', 'Crop'], ['harvest_date', 'Harvest Date'], ['quantity_kg', 'Qty (kg)', num], ['grade_name', 'Grade'], ['remark_description', 'Remarks'], ['estimated_value', 'Est. Value', peso]],
    fields: [
      { k: 'planting_id', l: 'Planting Record', t: 'select', req: 1, ref: REF.planting },
      { k: 'harvest_date', l: 'Harvest Date', t: 'date', req: 1 },
      { k: 'quantity_kg', l: 'Quantity (kg)', t: 'number', req: 1, min: 0.01, max: 10000000 },
      { k: 'grade_id', l: 'Quality Grade', t: 'select', req: 1, ref: REF.grade },
      { k: 'remark_id', l: 'Harvest Remarks', t: 'select', req: 1, ref: REF.remark }
    ],
    check: async v => {
      const e = {};
      const { data, error } = await db.from('plantings').select('planting_date').eq('planting_id', v.planting_id).maybeSingle();
      if (error || !data) e.planting_id = 'The selected planting record does not exist.';
      else if (v.harvest_date < data.planting_date) e.harvest_date = `Harvest date cannot be earlier than the planting date (${data.planting_date}).`;
      return e;
    }
  }
};

/* ---------- Authentication ---------- */
function showLogin(msg) {
  setVis('#boot', false); setVis('#app', false); setVis('#login', true);
  $('#loginMsg').textContent = msg || '';
  history.replaceState(null, '', location.pathname + location.search);
}

async function enter(user) {
  const { data, error } = await db.from('profiles').select('full_name, role_id, roles(role_name)').eq('id', user.id).single();
  if (error || !data) {
    console.error(error);
    await db.auth.signOut();
    showLogin('Your account has no profile. Please contact the administrator.');
    return;
  }
  USER = { id: user.id, email: user.email, name: data.full_name || user.email, roleId: data.role_id, roleName: data.roles ? data.roles.role_name : '' };
  $('#uName').textContent = USER.name;
  $('#uRole').textContent = USER.roleName;
  setVis('#boot', false); setVis('#login', false); setVis('#app', true);
  if (!location.hash.startsWith('#/')) location.hash = '#/dashboard'; else route();
}

function bindAuth() {
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const email = $('#lemail').value.trim(), password = $('#lpass').value;
    const msg = $('#loginMsg');
    msg.textContent = '';
    if (!email || !password) { msg.textContent = 'Please enter your email and password.'; return; }
    const btn = $('#btnLogin');
    btn.disabled = true;
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    if (error) { console.error(error); msg.textContent = 'Invalid email or password.'; return; }
    $('#lpass').value = '';
    await enter(data.user);
  });

  $('#btnLogout').addEventListener('click', async () => {
    await db.auth.signOut();
    if (USER) { USER = null; showLogin(); }
  });

  db.auth.onAuthStateChange(ev => {
    if (ev === 'SIGNED_OUT' && USER) { USER = null; showLogin('You have been logged out.'); }
  });
}

/* ---------- Router ---------- */
function route() {
  if (!USER) return;
  if (chart) { chart.destroy(); chart = null; }
  const p = current();
  document.querySelectorAll('#nav .nav-link').forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#/' + p));
  if (p === 'dashboard') return renderDashboard();
  if (p === 'reports') return renderReports();
  if (MODULES[p]) return renderModule(p);
  location.hash = '#/dashboard';
}

/* ---------- Dashboard ---------- */
const card = (label, val, href, cls) =>
  `<div class="col-6 col-md-4 col-xl"><a href="${href}" class="text-decoration-none"><div class="card text-bg-${cls} h-100"><div class="card-body"><div class="small">${label}</div><div class="fs-2 fw-bold">${val}</div></div></div></a></div>`;

const mini = (cols, rows) => rows.length
  ? `<div class="table-responsive"><table class="table table-sm table-striped mb-0"><thead><tr>${cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(([k, , f]) => `<td>${esc(show(r[k], f))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  : '<p class="text-muted mb-0">No records yet.</p>';

async function renderDashboard() {
  const v = $('#view');
  v.innerHTML = spinner;
  const [tot, rp, rh, st] = await Promise.all([
    db.from('v_totals').select('*').single(),
    db.from('v_planting_detail').select('*').order('planting_id', { ascending: false }).limit(5),
    db.from('v_harvest_detail').select('*').order('harvest_id', { ascending: false }).limit(5),
    db.from('v_planting_by_status').select('*').order('status_id')
  ]);
  if (current() !== 'dashboard') return;
  const bad = [tot, rp, rh, st].find(r => r.error);
  if (bad) { v.innerHTML = ''; flash(errMsg(bad.error, 'load'), 'danger'); return; }

  const t = tot.data;
  v.innerHTML = `
    <h3 class="mb-3">Dashboard</h3>
    <div class="row g-3 mb-3">
      ${card('Farmers', t.farmers, '#/farmers', 'success')}
      ${card('Farms', t.farms, '#/farms', 'primary')}
      ${card('Crops', t.crops, '#/crops', 'warning')}
      ${card('Planting Records', t.plantings, '#/plantings', 'info')}
      ${card('Harvest Records', t.harvests, '#/harvests', 'danger')}
    </div>
    <div class="row g-3 mb-3">
      <div class="col-md-6"><div class="card h-100"><div class="card-body"><div class="text-muted">Total Harvested Quantity</div><div class="fs-3 fw-bold">${num(t.total_qty)} kg</div></div></div></div>
      <div class="col-md-6"><div class="card h-100"><div class="card-body"><div class="text-muted">Estimated Harvest Value</div><div class="fs-3 fw-bold">${peso(t.total_value)}</div></div></div></div>
    </div>
    <div class="row g-3 mb-3">
      <div class="col-lg-5"><div class="card h-100"><div class="card-header fw-bold">Plantings by Status</div><div class="card-body"><div style="position:relative;height:260px"><canvas id="chStatus"></canvas></div></div></div></div>
      <div class="col-lg-7"><div class="card h-100"><div class="card-header fw-bold">Recent Planting Records</div><div class="card-body">${mini([['farm_name', 'Farm'], ['crop_name', 'Crop'], ['planting_date', 'Planted'], ['status_name', 'Status']], rp.data)}</div></div></div>
    </div>
    <div class="card mb-3"><div class="card-header fw-bold">Recent Harvest Records</div><div class="card-body">${mini([['farm_name', 'Farm'], ['crop_name', 'Crop'], ['harvest_date', 'Date'], ['quantity_kg', 'Qty (kg)', num], ['grade_name', 'Grade'], ['estimated_value', 'Est. Value', peso]], rh.data)}</div></div>`;

  if (window.Chart) {
    chart = new Chart($('#chStatus'), {
      type: 'bar',
      data: { labels: st.data.map(r => r.status_name), datasets: [{ label: 'Plantings', data: st.data.map(r => r.total), backgroundColor: '#198754' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
  }
}

/* ---------- Generic module page (list, search, filter, sort, pagination) ---------- */
function renderModule(key) {
  const m = MODULES[key];
  if (!STATE[key]) STATE[key] = { page: 1, search: '', filter: '', sort: { col: m.pk, asc: false } };
  const st = STATE[key];

  $('#view').innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <h3 class="mb-0">${m.title}</h3>
      ${canWrite(m) ? `<button class="btn btn-success" id="btnAdd">+ Add ${m.single}</button>` : ''}
    </div>
    <div class="row g-2 mb-3">
      <div class="col-12 col-md-5"><input id="q" class="form-control" placeholder="Search..." value="${esc(st.search)}"></div>
      <div class="col-8 col-md-4"><select id="flt" class="form-select"><option value="">All ${m.filter.l}</option></select></div>
      <div class="col-4 col-md-3"><button id="btnClear" class="btn btn-outline-secondary w-100">Reset</button></div>
    </div>
    <div id="tbl">${spinner}</div>`;

  const addBtn = $('#btnAdd');
  if (addBtn) addBtn.addEventListener('click', () => { openForm(key); });

  let timer;
  $('#q').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { st.search = e.target.value.trim(); st.page = 1; loadRows(key); }, 300);
  });
  $('#flt').addEventListener('change', e => { st.filter = e.target.value; st.page = 1; loadRows(key); });
  $('#btnClear').addEventListener('click', () => {
    st.search = ''; st.filter = ''; st.page = 1;
    $('#q').value = ''; $('#flt').value = '';
    loadRows(key);
  });

  $('#tbl').addEventListener('click', e => {
    const b = e.target.closest('[data-act],[data-sort],[data-page]');
    if (!b || b.disabled) return;
    if (b.dataset.sort) {
      const c = b.dataset.sort;
      st.sort = { col: c, asc: st.sort.col === c ? !st.sort.asc : true };
      st.page = 1;
      return loadRows(key);
    }
    if (b.dataset.page) { st.page = Number(b.dataset.page); return loadRows(key); }
    const id = b.dataset.id;
    if (b.dataset.act === 'view') viewRow(key, id);
    else if (b.dataset.act === 'edit') openForm(key, id);
    else if (b.dataset.act === 'delete') delRow(key, id);
  });

  loadRows(key);
  getOptions(m.filter.ref).then(opts => {
    const sel = $('#flt');
    if (!sel || current() !== key) return;
    sel.insertAdjacentHTML('beforeend', opts.map(o => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join(''));
    sel.value = st.filter;
  });
}

async function loadRows(key) {
  const m = MODULES[key], st = STATE[key];
  let q = db.from(m.view).select('*', { count: 'exact' });

  const s = st.search.replace(/[%,()*"\\]/g, ' ').trim();
  if (s) q = q.or(m.search.map(c => `${c}.ilike.%${s}%`).join(','));
  if (st.filter !== '') q = q.eq(m.filter.k, st.filter);

  q = q.order(st.sort.col, { ascending: st.sort.asc });
  if (st.sort.col !== m.pk) q = q.order(m.pk, { ascending: false });

  const from = (st.page - 1) * PAGE_SIZE;
  q = q.range(from, from + PAGE_SIZE - 1);

  const { data, count, error } = await q;
  const box = $('#tbl');
  if (!box || current() !== key) return;
  if (error) { box.innerHTML = ''; flash(errMsg(error, 'load'), 'danger'); return; }

  if (data.length === 0 && st.page > 1) {          // e.g. last row of the last page was deleted
    st.page = Math.max(1, Math.ceil(count / PAGE_SIZE));
    return loadRows(key);
  }

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const first = count ? from + 1 : 0, last = Math.min(count, st.page * PAGE_SIZE);

  const head = m.cols.map(([k, l]) => `<th data-sort="${k}">${l}${st.sort.col === k ? (st.sort.asc ? ' &#9650;' : ' &#9660;') : ''}</th>`).join('') + '<th>Actions</th>';
  const body = data.map(r => {
    const id = esc(r[m.pk]);
    const acts = `<button class="btn btn-sm btn-outline-secondary" data-act="view" data-id="${id}">View</button>`
      + (canWrite(m) ? ` <button class="btn btn-sm btn-outline-primary" data-act="edit" data-id="${id}">Edit</button>` : '')
      + (isAdmin() ? ` <button class="btn btn-sm btn-outline-danger" data-act="delete" data-id="${id}">Delete</button>` : '');
    return `<tr>${m.cols.map(([k, , f]) => `<td>${esc(show(r[k], f))}</td>`).join('')}<td class="text-nowrap">${acts}</td></tr>`;
  }).join('');

  box.innerHTML = `
    <div class="table-responsive bg-white border rounded mb-2">
      <table class="table table-hover table-striped align-middle mb-0">
        <thead class="table-light"><tr>${head}</tr></thead>
        <tbody>${body || `<tr><td colspan="${m.cols.length + 1}" class="text-center text-muted py-4">No records found.</td></tr>`}</tbody>
      </table>
    </div>
    <div class="d-flex flex-wrap justify-content-between align-items-center gap-2">
      <small class="text-muted">Showing ${first}-${last} of ${count}</small>
      <div class="btn-group">
        <button class="btn btn-sm btn-outline-secondary" data-page="${st.page - 1}" ${st.page <= 1 ? 'disabled' : ''}>Prev</button>
        <button class="btn btn-sm btn-light disabled">Page ${st.page} of ${pages}</button>
        <button class="btn btn-sm btn-outline-secondary" data-page="${st.page + 1}" ${st.page >= pages ? 'disabled' : ''}>Next</button>
      </div>
    </div>`;
}

/* ---------- Modal helpers ---------- */
function openModal(title, body, footer = '') {
  $('#mTitle').textContent = title;
  $('#mBody').innerHTML = body;
  $('#mFooter').innerHTML = footer;
  bootstrap.Modal.getOrCreateInstance($('#modal')).show();
}
const closeModal = () => bootstrap.Modal.getOrCreateInstance($('#modal')).hide();

/* ---------- View ---------- */
async function viewRow(key, id) {
  const m = MODULES[key];
  const { data, error } = await db.from(m.view).select('*').eq(m.pk, id).single();
  if (error) return flash(errMsg(error, 'load'), 'danger');
  const rows = [...m.cols, ['created_at', 'Created', dt], ['updated_at', 'Last Updated', dt]];
  openModal(`${m.single} Details`,
    `<dl class="row mb-0">${rows.map(([k, l, f]) => `<dt class="col-5">${l}</dt><dd class="col-7">${esc(show(data[k], f))}</dd>`).join('')}</dl>`);
}

/* ---------- Add / Edit form ---------- */
function fieldHtml(f, rec, opts) {
  const id = 'f_' + f.k, v = rec[f.k] ?? '';
  let inp;
  if (f.t === 'select') {
    inp = `<select class="form-select" id="${id}"><option value="">-- Select --</option>${opts.map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
  } else {
    let a = `type="text" maxlength="${f.len || 100}"`;
    if (f.t === 'number') a = `type="number" step="${f.int ? 1 : 'any'}" min="${f.min}" max="${f.max}"`;
    if (f.t === 'date') a = 'type="date"';
    inp = `<input class="form-control" id="${id}" ${a} value="${esc(v)}">`;
  }
  return `<div class="col-12 col-md-6"><label class="form-label" for="${id}">${f.l}${f.req ? ' <span class="text-danger">*</span>' : ''}</label>${inp}<div class="invalid-feedback" id="e_${f.k}"></div></div>`;
}

async function openForm(key, id) {
  const m = MODULES[key];
  let rec = {};
  if (id) {
    const { data, error } = await db.from(m.table).select('*').eq(m.pk, id).single();
    if (error) return flash(errMsg(error, 'load'), 'danger');
    rec = data;
  }
  const opts = {};
  await Promise.all(m.fields.filter(f => f.ref).map(async f => { opts[f.k] = await getOptions(f.ref); }));

  openModal(`${id ? 'Edit' : 'Add'} ${m.single}`,
    `<div id="formAlert"></div><form id="frm" class="row g-3" novalidate>${m.fields.map(f => fieldHtml(f, rec, opts[f.k])).join('')}</form>`,
    '<button type="button" class="btn btn-success" id="btnSave">Save</button>');
  $('#frm').addEventListener('submit', e => { e.preventDefault(); saveForm(key, id); });
  $('#btnSave').addEventListener('click', () => saveForm(key, id));
}

/* ---------- Validation ---------- */
function validDate(s) {
  const p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!p) return false;
  const d = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3]));
  return d.getUTCFullYear() === +p[1] && d.getUTCMonth() === +p[2] - 1 && d.getUTCDate() === +p[3];
}

function validateFields(m, raw) {
  const errs = {}, vals = {};
  for (const f of m.fields) {
    const v = String(raw[f.k] ?? '').trim();
    if (v === '') {
      if (f.req) errs[f.k] = `${f.l} is required.`;
      vals[f.k] = null;
      continue;
    }
    if (f.t === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) errs[f.k] = `${f.l} must be a valid number.`;
      else if (f.int && !Number.isInteger(n)) errs[f.k] = `${f.l} must be a whole number.`;
      else if (n < f.min) errs[f.k] = `${f.l} must be at least ${f.min}.`;
      else if (n > f.max) errs[f.k] = `${f.l} must not be more than ${f.max}.`;
      else vals[f.k] = n;
    } else if (f.t === 'date') {
      if (!validDate(v)) errs[f.k] = `${f.l} must be a valid date.`;
      else vals[f.k] = v;
    } else if (f.t === 'select') {
      const n = Number(v);
      if (!Number.isInteger(n)) errs[f.k] = `Please choose a valid ${f.l}.`;
      else vals[f.k] = n;
    } else if (f.pattern && !f.pattern.test(v)) {
      errs[f.k] = f.msg || `${f.l} is not valid.`;
    } else {
      vals[f.k] = v;
    }
  }
  return { errs, vals };
}

function showErrors(m, errs) {
  m.fields.forEach(f => {
    const msg = errs[f.k];
    $('#f_' + f.k).classList.toggle('is-invalid', !!msg);
    $('#e_' + f.k).textContent = msg || '';
  });
}

/* ---------- Save (create / update) ---------- */
async function saveForm(key, id) {
  const m = MODULES[key];
  const alertBox = $('#formAlert');
  alertBox.innerHTML = '';
  const raw = {};
  m.fields.forEach(f => { raw[f.k] = $('#f_' + f.k).value; });

  let { errs, vals } = validateFields(m, raw);
  if (!Object.keys(errs).length && m.check) errs = await m.check(vals);
  showErrors(m, errs);
  if (Object.keys(errs).length) return;

  const btn = $('#btnSave');
  btn.disabled = true;
  let res;
  if (id) res = await db.from(m.table).update(vals).eq(m.pk, id).select();
  else res = await db.from(m.table).insert(vals).select();
  btn.disabled = false;

  if (res.error) { alertBox.innerHTML = `<div class="alert alert-danger py-2">${esc(errMsg(res.error))}</div>`; return; }
  if (!res.data || !res.data.length) {
    alertBox.innerHTML = '<div class="alert alert-danger py-2">Nothing was saved. You may not have permission, or the record no longer exists.</div>';
    return;
  }
  closeModal();
  flash(`${m.single} ${id ? 'updated' : 'added'} successfully.`);
  if (!id) STATE[key].page = 1;
  if (current() === key) loadRows(key);
}

/* ---------- Delete (with confirmation) ---------- */
async function delRow(key, id) {
  const m = MODULES[key];
  if (!confirm(`Permanently delete this ${m.single.toLowerCase()}? This cannot be undone.`)) return;
  const { data, error } = await db.from(m.table).delete().eq(m.pk, id).select();
  if (error) return flash(errMsg(error, 'delete'), 'danger');
  if (!data || !data.length) return flash('Nothing was deleted. You may not have permission, or the record no longer exists.', 'warning');
  flash(`${m.single} deleted successfully.`);
  loadRows(key);
}

/* ---------- Reports ---------- */
const REPORTS = {
  farmers_farms: {
    title: 'Farmers and their Farms', view: 'v_farmer_farms', order: 'farmer_name',
    cols: [['farmer_name', 'Farmer'], ['municipality', 'Municipality'], ['farm_name', 'Farm'], ['area_hectares', 'Area (ha)', num], ['irrigation', 'Irrigation']]
  },
  crops_per_farm: {
    title: 'Crops Planted per Farm', view: 'v_planting_detail', order: 'farm_name', date: 'planting_date',
    cols: [['farm_name', 'Farm'], ['crop_name', 'Crop'], ['planting_date', 'Planting Date'], ['area_planted', 'Area Planted (ha)', num], ['status_name', 'Status']]
  },
  planting_status: {
    title: 'Planting Records by Status', view: 'v_planting_detail', order: 'status_name', date: 'planting_date',
    agg: { by: 'status_name' },
    cols: [['status_name', 'Status'], ['records', 'No. of Planting Records']]
  },
  harvest_records: {
    title: 'Harvest Records', view: 'v_harvest_detail', order: 'harvest_date', date: 'harvest_date',
    cols: [['harvest_date', 'Harvest Date'], ['farm_name', 'Farm'], ['crop_name', 'Crop'], ['quantity_kg', 'Qty (kg)', num], ['grade_name', 'Grade'], ['remark_description', 'Remarks']],
    sumKey: 'quantity_kg', sumLabel: 'Total quantity', sumFmt: v => num(v) + ' kg'
  },
  total_harvested: {
    title: 'Total Harvested Quantity (by Crop)', view: 'v_harvest_detail', order: 'crop_name', date: 'harvest_date',
    agg: { by: 'crop_name', sum: 'quantity_kg' },
    cols: [['crop_name', 'Crop'], ['records', 'No. of Harvests'], ['total', 'Total Quantity (kg)', num]],
    sumKey: 'total', sumLabel: 'Grand total', sumFmt: v => num(v) + ' kg'
  },
  estimated_value: {
    title: 'Estimated Harvest Value', view: 'v_harvest_detail', order: 'harvest_date', date: 'harvest_date',
    cols: [['harvest_date', 'Harvest Date'], ['farm_name', 'Farm'], ['crop_name', 'Crop'], ['quantity_kg', 'Qty (kg)', num], ['price_per_kg', 'Price / kg', peso], ['estimated_value', 'Estimated Value', peso]],
    sumKey: 'estimated_value', sumLabel: 'Total estimated value', sumFmt: peso
  }
};

function renderReports() {
  $('#view').innerHTML = `
    <h3 class="mb-3 no-print">Reports</h3>
    <div class="card mb-3 no-print"><div class="card-body"><div class="row g-2 align-items-end">
      <div class="col-12 col-md-4"><label class="form-label" for="rpt">Report</label>
        <select id="rpt" class="form-select">${Object.entries(REPORTS).map(([k, r]) => `<option value="${k}">${r.title}</option>`).join('')}</select></div>
      <div class="col-6 col-md-2"><label class="form-label" for="rFrom">From</label><input type="date" id="rFrom" class="form-control"></div>
      <div class="col-6 col-md-2"><label class="form-label" for="rTo">To</label><input type="date" id="rTo" class="form-control"></div>
      <div class="col-12 col-md-2"><label class="form-label" for="rQ">Search</label><input id="rQ" class="form-control" placeholder="Filter text"></div>
      <div class="col-12 col-md-2 d-flex gap-2">
        <button id="rRun" class="btn btn-success flex-fill">Run</button>
        <button id="rPrint" class="btn btn-outline-secondary">Print</button>
      </div>
    </div></div></div>
    <div id="rOut"></div>`;
  $('#rpt').addEventListener('change', runReport);
  $('#rRun').addEventListener('click', runReport);
  $('#rPrint').addEventListener('click', () => window.print());
  $('#rQ').addEventListener('keydown', e => { if (e.key === 'Enter') runReport(); });
  runReport();
}

async function runReport() {
  const r = REPORTS[$('#rpt').value];
  const from = $('#rFrom').value, to = $('#rTo').value, txt = $('#rQ').value.trim().toLowerCase();
  $('#rFrom').disabled = !r.date;
  $('#rTo').disabled = !r.date;
  if (r.date && from && to && from > to) { flash('The "From" date cannot be later than the "To" date.', 'warning'); return; }

  const out = $('#rOut');
  out.innerHTML = spinner;
  let q = db.from(r.view).select('*').order(r.order).limit(1000);   // Supabase returns at most 1000 rows per request by default
  if (r.date) {
    if (from) q = q.gte(r.date, from);
    if (to) q = q.lte(r.date, to);
  }
  const { data, error } = await q;
  if (current() !== 'reports') return;
  if (error) { out.innerHTML = ''; flash(errMsg(error, 'load'), 'danger'); return; }

  let rows = data;
  if (txt) rows = rows.filter(x => Object.values(x).join(' ').toLowerCase().includes(txt));
  if (r.agg) {
    const map = new Map();
    rows.forEach(x => {
      const k = x[r.agg.by];
      const o = map.get(k) || { [r.agg.by]: k, records: 0, total: 0 };
      o.records += 1;
      if (r.agg.sum) o.total += Number(x[r.agg.sum] || 0);
      map.set(k, o);
    });
    rows = [...map.values()];
  }

  const period = (from || to) && r.date ? ` <small class="text-muted">(${esc(from || '...')} to ${esc(to || '...')})</small>` : '';
  const total = r.sumKey ? `<div class="fw-bold mt-2">${r.sumLabel}: ${esc(r.sumFmt(rows.reduce((s, x) => s + Number(x[r.sumKey] || 0), 0)))}</div>` : '';
  out.innerHTML = `
    <div class="card"><div class="card-header fw-bold">${r.title}${period}</div><div class="card-body">
      ${rows.length ? `<div class="table-responsive"><table class="table table-striped table-sm">
        <thead><tr>${r.cols.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(x => `<tr>${r.cols.map(([k, , f]) => `<td>${esc(show(x[k], f))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div><small class="text-muted">${rows.length} row(s)</small>${total}` : '<p class="text-muted mb-0">No records found for the selected criteria.</p>'}
    </div></div>`;
}

/* ---------- Start ---------- */
function init() {
  $('#nav').addEventListener('click', e => {
    if (e.target.closest('a')) { const c = bootstrap.Collapse.getInstance($('#nav')); if (c) c.hide(); }
  });

  if (!READY) {
    showLogin('Setup needed: fill in SUPABASE_URL and SUPABASE_ANON_KEY in config.js.');
    return;
  }
  bindAuth();
  window.addEventListener('hashchange', route);
  db.auth.getSession().then(async ({ data }) => {
    if (data.session) await enter(data.session.user);
    else showLogin();
  });
}
init();
