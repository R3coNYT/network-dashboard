/* ============================================================
   NetDashboard — script.js
   API-backed state, rendering, drag-and-drop
   ============================================================ */

// ================================================================
// API LAYER
// ================================================================

const api = {
  async request(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res  = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path} → HTTP ${res.status}`);
    return data;
  },
  get:    (path)       => api.request('GET',    path),
  post:   (path, body) => api.request('POST',   path, body),
  put:    (path, body) => api.request('PUT',    path, body),
  delete: (path)       => api.request('DELETE', path)
};

// ── In-memory state (mirrors the DB) ─────────────────────────────
const state = { categories: [], apps: [] };

async function loadData() {
  const [cats, apps] = await Promise.all([
    api.get('/api/categories'),
    api.get('/api/apps')
  ]);
  state.categories = cats;
  state.apps       = apps;
}

// ================================================================
// UTILITIES
// ================================================================

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function getInitial(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

/** Deterministic accent color derived from the app name */
const APP_COLORS = [
  '#6366f1', '#8b5cf6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#0ea5e9',
  '#84cc16', '#f97316'
];

function getAppColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return APP_COLORS[Math.abs(h) % APP_COLORS.length];
}

/**
 * Build a fully-qualified URL from user input + optional port.
 * - Leaves http:// / https:// URLs untouched (just appends port if needed)
 * - Prepends http:// for local/private addresses, https:// otherwise
 */
function buildUrl(rawUrl, port) {
  let url = rawUrl.trim();

  if (!/^https?:\/\//i.test(url)) {
    const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(url);
    url = (isLocal ? 'http://' : 'https://') + url;
  }

  if (port) {
    try {
      const u = new URL(url);
      if (!u.port) {
        u.port = String(port);
        url = u.toString();
      }
    } catch (_) {
      url = url.replace(/\/$/, '') + ':' + port;
    }
  }

  return url;
}

/** Compact display string — no protocol, no trailing slash */
function displayUrl(rawUrl, port) {
  let s = rawUrl.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
  if (port) s += ':' + port;
  return s;
}

// ================================================================
// IMAGE UPLOAD
// ================================================================

async function uploadImageFile(file) {
  const fd = new FormData();
  fd.append('file', file);
  const res  = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

function updateImageThumb(thumbId, src) {
  const thumb = document.getElementById(thumbId);
  if (!thumb) return;
  if (src) {
    thumb.src    = src;
    thumb.hidden = false;
  } else {
    thumb.src    = '';
    thumb.hidden = true;
  }
}

/**
 * prefix: 'app' | 'editApp'
 * state:  'idle' | 'uploading' | 'done' | 'error'
 */
function setUploadState(prefix, state) {
  const statusEl  = document.getElementById(`${prefix}UploadStatus`);
  const formId    = prefix === 'app' ? 'formAddApp' : 'formEditApp';
  const form      = document.getElementById(formId);
  const submitBtn = form ? form.querySelector('[type="submit"]') : null;
  if (!statusEl) return;

  if (state === 'idle') {
    statusEl.innerHTML = '';
    statusEl.hidden    = true;
    if (submitBtn) submitBtn.disabled = false;

  } else if (state === 'uploading') {
    statusEl.innerHTML = '<span class="upload-spinner" aria-label="Uploading…"></span>';
    statusEl.hidden    = false;
    if (submitBtn) submitBtn.disabled = true;

  } else if (state === 'done') {
    statusEl.innerHTML = `
      <span class="upload-check" aria-label="Upload complete">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </span>`;
    statusEl.hidden    = false;
    if (submitBtn) submitBtn.disabled = false;

  } else if (state === 'error') {
    statusEl.innerHTML = '';
    statusEl.hidden    = true;
    if (submitBtn) submitBtn.disabled = false;
  }
}

// ================================================================
// TOAST NOTIFICATIONS
// ================================================================

function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const icons = { success: '✓', error: '✕', info: 'i' };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] ?? 'i'}</span>
    <span>${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);

  // Trigger enter animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  });

  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// ================================================================
// MODAL MANAGEMENT
// ================================================================

function openModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.add('active');
  const first = overlay.querySelector('input:not([type=hidden]), select');
  if (first) setTimeout(() => first.focus(), 80);
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove('active');
  // Reset forms
  const form = overlay.querySelector('form');
  if (form) form.reset();
  // Reset image thumbs
  overlay.querySelectorAll('.image-thumb').forEach(t => { t.src = ''; t.hidden = true; });
  // Reset upload status + re-enable submit
  overlay.querySelectorAll('.upload-status').forEach(s => { s.innerHTML = ''; s.hidden = true; });
  overlay.querySelectorAll('[type="submit"]').forEach(b => { b.disabled = false; });
  // Reset color picker to first swatch
  resetColorPicker();
}

function resetColorPicker() {
  const swatches = document.querySelectorAll('.color-swatch');
  swatches.forEach((s, i) => {
    const pressed = i === 0;
    s.classList.toggle('selected', pressed);
    s.setAttribute('aria-pressed', String(pressed));
  });
}

// Confirm modal state
let _confirmCallback = null;

function showConfirm(message, title, onConfirm) {
  document.getElementById('confirmMessage').textContent = message;
  document.getElementById('titleConfirm').textContent = title || 'Confirm';
  _confirmCallback = onConfirm;
  openModal('modalConfirm');
}

// ================================================================
// CRUD OPERATIONS (async — all mutations go through the API)
// ================================================================

async function addApp({ name, url, port, categoryId, description, imageUrl }) {
  try {
    const app = await api.post('/api/apps', {
      name, url, port: port || null,
      category_id: categoryId || 'uncategorized',
      description: description || null,
      image_url:   imageUrl   || null
    });
    state.apps.push(app);
    renderAll();
    showToast(`"${app.name}" added successfully`);
  } catch (err) { showToast(err.message, 'error'); }
}

async function updateApp(id, { name, url, port, categoryId, description, imageUrl }) {
  try {
    const updated = await api.put(`/api/apps/${id}`, {
      name, url, port: port || null,
      category_id: categoryId || 'uncategorized',
      description: description || null,
      image_url:   imageUrl   || null
    });
    const idx = state.apps.findIndex(a => a.id === id);
    if (idx !== -1) state.apps[idx] = updated;
    renderAll();
    showToast(`"${updated.name}" updated`);
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteApp(id) {
  const app = state.apps.find(a => a.id === id);
  if (!app) return;
  try {
    await api.delete(`/api/apps/${id}`);
    state.apps = state.apps.filter(a => a.id !== id);
    renderAll();
    showToast(`"${app.name}" deleted`, 'info');
  } catch (err) { showToast(err.message, 'error'); }
}

async function addCategory({ name, color }) {
  try {
    const cat = await api.post('/api/categories', { name: name.trim(), color });
    state.categories.push(cat);
    renderAll();
    showToast(`Category "${cat.name}" created`);
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat || cat.is_protected) return;
  try {
    const res = await api.delete(`/api/categories/${id}`);
    state.apps.filter(a => a.category_id === id)
              .forEach(a => { a.category_id = 'uncategorized'; });
    state.categories = state.categories.filter(c => c.id !== id);
    renderAll();
    const n = res.moved || 0;
    showToast(n > 0
      ? `Category deleted — ${n} app${n > 1 ? 's' : ''} moved to "Uncategorized"`
      : `Category "${cat.name}" deleted`, 'info');
  } catch (err) { showToast(err.message, 'error'); }
}

async function renameCategory(id, name) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat || cat.is_protected) return;
  const prev = cat.name;
  cat.name = name; // optimistic
  renderAll();
  try {
    const updated = await api.put(`/api/categories/${id}`, { name });
    const idx = state.categories.findIndex(c => c.id === id);
    if (idx !== -1) state.categories[idx] = updated;
    showToast(`Catégorie renommée en « ${name} »`);
  } catch (err) {
    cat.name = prev; // rollback
    renderAll();
    showToast(err.message, 'error');
  }
}

async function relocateApp(appId, targetCatId, beforeAppId) {
  // beforeAppId — insert the card before this app ID (null = append at end)
  const appRef = state.apps.find(a => a.id === appId);
  if (!appRef) return;
  const prevCatId = appRef.category_id;
  const isMove    = prevCatId !== targetCatId;

  // Build new ordered list for target category (without the moving app)
  const targetApps = state.apps
    .filter(a => a.category_id === targetCatId && a.id !== appId)
    .slice();

  if (beforeAppId === null) {
    targetApps.push(appRef);
  } else {
    const idx = targetApps.findIndex(a => a.id === beforeAppId);
    targetApps.splice(idx === -1 ? targetApps.length : idx, 0, appRef);
  }

  // Assign new sort_orders directly on state objects for target category
  const reorderPayload = [];
  targetApps.forEach((a, i) => {
    a.sort_order  = i;
    a.category_id = targetCatId;
    reorderPayload.push({ id: a.id, sort_order: i, category_id: targetCatId });
  });

  // If cross-category: reindex source category too
  if (isMove) {
    state.apps
      .filter(a => a.category_id === prevCatId) // appRef.category_id already changed above
      .forEach((a, i) => {
        a.sort_order = i;
        reorderPayload.push({ id: a.id, sort_order: i, category_id: prevCatId });
      });
  }

  // Sort state.apps by sort_order so filter-based rendering preserves the right order
  state.apps.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  renderAll();

  try {
    await api.put('/api/apps/reorder', reorderPayload);
    if (isMove) {
      const cat = state.categories.find(c => c.id === targetCatId);
      showToast(`"${appRef.name}" moved to "${cat?.name || 'the category'}"`);
    }
  } catch (err) {
    await loadData();
    renderAll();
    showToast(err.message, 'error');
  }
}

async function reorderCategories(catId, beforeCatId) {
  const catRef = state.categories.find(c => c.id === catId);
  if (!catRef) return;

  // Rebuild ordered array (all categories, moving catRef to new position)
  const others   = state.categories.filter(c => c.id !== catId);
  const insertIdx = beforeCatId
    ? others.findIndex(c => c.id === beforeCatId)
    : others.length;
  others.splice(insertIdx === -1 ? others.length : insertIdx, 0, catRef);

  // Update sort_orders in state
  const payload = others.map((c, i) => { c.sort_order = i; return { id: c.id, sort_order: i }; });
  state.categories = others;
  renderAll();

  try {
    await api.put('/api/categories/reorder', payload);
  } catch (err) {
    await loadData();
    renderAll();
    showToast(err.message, 'error');
  }
}


function populateCategorySelect(selectId = 'appCategory', selectedId = null) {
  const el = document.getElementById(selectId);
  if (!el) return;
  el.innerHTML = state.categories
    .map(c => `<option value="${escapeHtml(c.id)}"${
      c.id === selectedId ? ' selected' : ''
    }>${escapeHtml(c.name)}</option>`)
    .join('');
}

function renderAll() {
  const container = document.getElementById('categoriesContainer');

  if (state.categories.length === 0) {
    container.innerHTML = buildEmptyPage();
    return;
  }

  container.innerHTML = state.categories.map(buildCategoryHTML).join('');
  attachDragListeners();
  populateCategorySelect('appCategory');
}

function buildEmptyPage() {
  return `
    <div class="empty-page">
      <div class="empty-page-icon">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
      </div>
      <h2>No categories</h2>
      <p>Start by creating a category, then add your applications.</p>
    </div>
  `;
}

function buildCategoryHTML(cat) {
  const apps = state.apps.filter(a => a.category_id === cat.id);
  const count = apps.length;
  const isEmpty = count === 0;

  const deleteBtn = !cat.is_protected ? `
    <button class="btn-icon btn-icon-danger"
            data-action="delete-category"
            data-cat-id="${escapeHtml(cat.id)}"
            title="Delete category"
            aria-label="Delete ${escapeHtml(cat.name)}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </button>` : '';

  const renameBtn = !cat.is_protected ? `
    <button class="btn-icon"
            data-action="rename-category"
            data-cat-id="${escapeHtml(cat.id)}"
            title="Rename category"
            aria-label="Rename ${escapeHtml(cat.name)}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
    </button>` : '';

  const gripHandle = !cat.is_protected ? `
    <span class="cat-drag-handle" aria-hidden="true" title="Reorder category">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <circle cx="9"  cy="5"  r="1.3" fill="currentColor"/>
        <circle cx="15" cy="5"  r="1.3" fill="currentColor"/>
        <circle cx="9"  cy="12" r="1.3" fill="currentColor"/>
        <circle cx="15" cy="12" r="1.3" fill="currentColor"/>
        <circle cx="9"  cy="19" r="1.3" fill="currentColor"/>
        <circle cx="15" cy="19" r="1.3" fill="currentColor"/>
      </svg>
    </span>` : '';

  const appsHTML = isEmpty
    ? `<div class="drop-hint">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <path d="M12 5v14M5 12h14"/>
         </svg>
         <span>Drop an application here</span>
       </div>`
    : apps.map(buildAppCardHTML).join('');

  return `
    <section class="category-section${cat.is_protected ? '' : ' cat-draggable'}"
             data-category-id="${escapeHtml(cat.id)}"
             ${cat.is_protected ? '' : `draggable="true" data-cat-id="${escapeHtml(cat.id)}"`}>
      <div class="category-header">
        <div class="category-title-group">
          ${gripHandle}
          <span class="category-accent-dot"
                style="background:${escapeHtml(cat.color)};box-shadow:0 0 8px ${escapeHtml(cat.color)}55;"
                aria-hidden="true"></span>
          <h2 class="category-name">${escapeHtml(cat.name)}</h2>
          <span class="category-count">${count} app${count !== 1 ? 's' : ''}</span>
        </div>
        <div class="category-actions">
          <button class="btn-icon"
                  data-action="add-app-to-cat"
                  data-cat-id="${escapeHtml(cat.id)}"
                  title="Add an app to this category"
                  aria-label="Add an app to ${escapeHtml(cat.name)}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          ${renameBtn}
          ${deleteBtn}
        </div>
      </div>
      <div class="drop-zone ${isEmpty ? 'drop-zone-empty' : ''}"
           data-category-id="${escapeHtml(cat.id)}"
           aria-label="Drop zone for ${escapeHtml(cat.name)}">
        ${appsHTML}
      </div>
    </section>
  `;
}

function buildAppCardHTML(app) {
  const color   = getAppColor(app.name);
  const href    = buildUrl(app.url, app.port);
  const label   = displayUrl(app.url, app.port);
  const initial = getInitial(app.name);

  const iconHTML = `
    <div class="app-icon"
         style="background:${color}1a;color:${color};border-color:${color}33;"
         aria-hidden="true">
      ${initial}
      ${app.image_url ? `<img src="${escapeHtml(app.image_url)}" alt="" class="app-icon-img" width="48" height="48" loading="lazy" decoding="async" onerror="this.style.display='none'">` : ''}
    </div>`;

  const descHTML = app.description
    ? `<span class="app-description">${escapeHtml(app.description)}</span>`
    : '';

  return `
    <article class="app-card"
             data-app-id="${escapeHtml(app.id)}"
             draggable="true"
             tabindex="0"
             aria-label="${escapeHtml(app.name)}">
      <div class="app-card-inner">
        <span class="app-card-drag-handle" aria-hidden="true">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
            <circle cx="9"  cy="5"  r="1.2" fill="currentColor"/>
            <circle cx="15" cy="5"  r="1.2" fill="currentColor"/>
            <circle cx="9"  cy="12" r="1.2" fill="currentColor"/>
            <circle cx="15" cy="12" r="1.2" fill="currentColor"/>
            <circle cx="9"  cy="19" r="1.2" fill="currentColor"/>
            <circle cx="15" cy="19" r="1.2" fill="currentColor"/>
          </svg>
        </span>
        <a class="app-card-link"
           href="${escapeHtml(href)}"
           target="_blank"
           rel="noopener noreferrer"
           tabindex="-1">
          ${iconHTML}
          <div class="app-info">
            <span class="app-name">${escapeHtml(app.name)}</span>
            <span class="app-url">${escapeHtml(label)}</span>
            ${descHTML}
          </div>
          <span class="app-card-open-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </span>
        </a>
        <div class="app-card-actions">
          <button class="app-action-btn app-edit-btn"
                  data-action="edit-app"
                  data-app-id="${escapeHtml(app.id)}"
                  aria-label="Edit ${escapeHtml(app.name)}"
                  title="Edit">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="app-action-btn app-delete-action-btn"
                  data-action="delete-app"
                  data-app-id="${escapeHtml(app.id)}"
                  aria-label="Delete ${escapeHtml(app.name)}"
                  title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6"  y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

// ================================================================
// DRAG & DROP
// ================================================================

// ── App card drag state ─────────────────────────────────────────
let _draggedAppId   = null;
let _dropTargetCard = null;
let _dropBefore     = true;

// ── Category drag state ─────────────────────────────────────────
let _draggedCatId         = null;
let _dropTargetSection    = null;
let _dropSectionBefore    = true;
let _catContainerListened = false;

// ── App-card position helper ────────────────────────────────────

/** Find the card nearest to the cursor and whether to insert before/after it */
function getDropPosition(zone, e) {
  const cards = [...zone.querySelectorAll('.app-card:not(.dragging)')];
  if (!cards.length) return { card: null, before: false };

  let bestCard = null;
  let bestDist = Infinity;

  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;
    const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
    if (dist < bestDist) { bestDist = dist; bestCard = card; }
  }

  if (!bestCard) return { card: null, before: false };
  const rect = bestCard.getBoundingClientRect();
  return { card: bestCard, before: e.clientX < rect.left + rect.width / 2 };
}

function showDropIndicator(zone, card, before) {
  removeDropIndicator();
  const el = document.createElement('div');
  el.className = 'drop-indicator';
  el.id = 'dropIndicator';
  if (card) {
    card.parentNode.insertBefore(el, before ? card : card.nextSibling);
  } else {
    zone.appendChild(el);
  }
}

function removeDropIndicator() {
  document.getElementById('dropIndicator')?.remove();
}

// ── Category position helper ────────────────────────────────────

function getCatDropPosition(container, e) {
  const sections = [...container.querySelectorAll('.category-section:not(.cat-dragging)')];
  if (!sections.length) return { section: null, before: false };

  let best     = null;
  let bestDist = Infinity;

  for (const sec of sections) {
    const rect = sec.getBoundingClientRect();
    const cy   = rect.top + rect.height / 2;
    const dist = Math.abs(e.clientY - cy);
    if (dist < bestDist) { bestDist = dist; best = sec; }
  }

  if (!best) return { section: null, before: false };
  const rect = best.getBoundingClientRect();
  return { section: best, before: e.clientY < rect.top + rect.height / 2 };
}

function showCatDropIndicator(container, section, before) {
  removeCatDropIndicator();
  const el = document.createElement('div');
  el.className = 'cat-drop-indicator';
  el.id = 'catDropIndicator';
  if (section) {
    container.insertBefore(el, before ? section : section.nextSibling);
  } else {
    container.appendChild(el);
  }
}

function removeCatDropIndicator() {
  document.getElementById('catDropIndicator')?.remove();
}

// ── Attach all listeners (called after every renderAll) ─────────

function attachDragListeners() {
  // App cards — dragstart / dragend
  document.querySelectorAll('.app-card[draggable]').forEach(card => {
    card.addEventListener('dragstart', onCardDragStart);
    card.addEventListener('dragend',   onCardDragEnd);
  });
  // Drop zones — dragover / dragleave / drop
  document.querySelectorAll('.drop-zone').forEach(zone => {
    zone.addEventListener('dragover',  onZoneDragOver);
    zone.addEventListener('dragleave', onZoneDragLeave);
    zone.addEventListener('drop',      onZoneDrop);
  });
  // Category sections — dragstart / dragend
  document.querySelectorAll('.category-section[draggable]').forEach(section => {
    section.addEventListener('dragstart', onCatDragStart);
    section.addEventListener('dragend',   onCatDragEnd);
  });
  // Container: attach only once (the element is never replaced, only its innerHTML is)
  if (!_catContainerListened) {
    const container = document.getElementById('categoriesContainer');
    container.addEventListener('dragover',  onContainerCatDragOver);
    container.addEventListener('dragleave', onContainerCatDragLeave);
    container.addEventListener('drop',      onContainerCatDrop);
    _catContainerListened = true;
  }
}

// ── App card handlers ───────────────────────────────────────────

function onCardDragStart(e) {
  if (_draggedCatId) return;
  _draggedAppId = this.dataset.appId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _draggedAppId);
  requestAnimationFrame(() => {
    this.classList.add('dragging');
    document.querySelectorAll('.drop-zone').forEach(z => z.classList.add('droppable'));
  });
}

function onCardDragEnd() {
  this.classList.remove('dragging');
  _draggedAppId   = null;
  _dropTargetCard = null;
  removeDropIndicator();
  document.querySelectorAll('.drop-zone').forEach(z => {
    z.classList.remove('droppable', 'drag-over');
  });
}

function onZoneDragOver(e) {
  if (_draggedCatId) return; // suppress when dragging a category
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');

  const { card, before } = getDropPosition(this, e);
  if (card !== _dropTargetCard || before !== _dropBefore) {
    _dropTargetCard = card;
    _dropBefore     = before;
    showDropIndicator(this, card, before);
  }
}

function onZoneDragLeave(e) {
  if (!this.contains(e.relatedTarget)) {
    this.classList.remove('drag-over');
    removeDropIndicator();
    _dropTargetCard = null;
  }
}

function onZoneDrop(e) {
  if (_draggedCatId) return; // suppress when dragging a category
  e.preventDefault();
  this.classList.remove('drag-over', 'droppable');
  removeDropIndicator();

  const appId = _draggedAppId || e.dataTransfer.getData('text/plain');
  const catId = this.dataset.categoryId;
  if (!appId || !catId) return;

  let beforeAppId = null;
  if (_dropTargetCard) {
    const targetId = _dropTargetCard.dataset.appId;
    if (_dropBefore) {
      beforeAppId = targetId;
    } else {
      const cards = [...this.querySelectorAll('.app-card:not(.dragging)')];
      const idx   = cards.findIndex(c => c.dataset.appId === targetId);
      const next  = cards[idx + 1];
      beforeAppId = next ? next.dataset.appId : null;
    }
  }

  _dropTargetCard = null;
  _dropBefore     = true;
  relocateApp(appId, catId, beforeAppId);
}

// ── Category section handlers ───────────────────────────────────

function onCatDragStart(e) {
  if (_draggedAppId) return;
  _draggedCatId = this.dataset.catId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _draggedCatId);
  e.stopPropagation();
  requestAnimationFrame(() => this.classList.add('cat-dragging'));
}

function onCatDragEnd() {
  this.classList.remove('cat-dragging');
  _draggedCatId      = null;
  _dropTargetSection = null;
  removeCatDropIndicator();
}

function onContainerCatDragOver(e) {
  if (!_draggedCatId) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';

  const container = document.getElementById('categoriesContainer');
  const { section, before } = getCatDropPosition(container, e);

  if (section !== _dropTargetSection || before !== _dropSectionBefore) {
    _dropTargetSection = section;
    _dropSectionBefore = before;
    showCatDropIndicator(container, section, before);
  }
}

function onContainerCatDragLeave(e) {
  if (!_draggedCatId) return;
  const container = document.getElementById('categoriesContainer');
  if (!container.contains(e.relatedTarget)) {
    removeCatDropIndicator();
    _dropTargetSection = null;
  }
}

function onContainerCatDrop(e) {
  if (!_draggedCatId) return;
  e.preventDefault();
  removeCatDropIndicator();

  const catId = _draggedCatId;
  let beforeCatId = null;

  if (_dropTargetSection) {
    const targetId = _dropTargetSection.dataset.categoryId;
    if (_dropSectionBefore) {
      beforeCatId = targetId;
    } else {
      const container = document.getElementById('categoriesContainer');
      const sections  = [...container.querySelectorAll('.category-section:not(.cat-dragging)')];
      const idx       = sections.findIndex(s => s.dataset.categoryId === targetId);
      const next      = sections[idx + 1];
      beforeCatId = next ? next.dataset.categoryId : null;
    }
  }

  _draggedCatId      = null;
  _dropTargetSection = null;
  _dropSectionBefore = true;
  reorderCategories(catId, beforeCatId);
}


// ================================================================
// EVENT WIRING
// ================================================================

document.addEventListener('DOMContentLoaded', async () => {

  // ── Load data from API, then render ─────────────────────────
  try {
    await loadData();
  } catch (_) {
    showToast('Unable to reach the server. Make sure Flask is running.', 'error');
  }
  renderAll();

  // ── Header buttons ──────────────────────────────────────────
  document.getElementById('btnAddApp').addEventListener('click', () => {
    populateCategorySelect('appCategory');
    openModal('modalAddApp');
  });

  document.getElementById('btnAddCategory').addEventListener('click', () => {
    openModal('modalAddCategory');
  });

  // ── Forms ────────────────────────────────────────────────────
  document.getElementById('formAddApp').addEventListener('submit', e => {
    e.preventDefault();
    const name        = document.getElementById('appName').value.trim();
    const url         = document.getElementById('appUrl').value.trim();
    const port        = document.getElementById('appPort').value.trim();
    const catId       = document.getElementById('appCategory').value;
    const description = document.getElementById('appDescription').value.trim();
    const imageUrl    = document.getElementById('appImageUrl').value.trim();
    if (!name || !url) return;
    closeModal('modalAddApp');
    addApp({ name, url, port: port || null, categoryId: catId, description, imageUrl });
  });

  document.getElementById('formEditApp').addEventListener('submit', e => {
    e.preventDefault();
    const id          = document.getElementById('editAppId').value;
    const name        = document.getElementById('editAppName').value.trim();
    const url         = document.getElementById('editAppUrl').value.trim();
    const port        = document.getElementById('editAppPort').value.trim();
    const catId       = document.getElementById('editAppCategory').value;
    const description = document.getElementById('editAppDescription').value.trim();
    const imageUrl    = document.getElementById('editAppImageUrl').value.trim();
    if (!id || !name || !url) return;
    closeModal('modalEditApp');
    updateApp(id, { name, url, port: port || null, categoryId: catId, description, imageUrl });
  });

  document.getElementById('formAddCategory').addEventListener('submit', e => {
    e.preventDefault();
    const name   = document.getElementById('categoryName').value.trim();
    const swatch = document.querySelector('#colorPicker .color-swatch.selected');
    const color  = swatch ? swatch.dataset.color : '#6366f1';
    if (!name) return;
    closeModal('modalAddCategory');
    addCategory({ name, color });
  });

  document.getElementById('formRenameCategory').addEventListener('submit', e => {
    e.preventDefault();
    const id   = document.getElementById('renameCatId').value;
    const name = document.getElementById('renameCatName').value.trim();
    if (!id || !name) return;
    closeModal('modalRenameCategory');
    renameCategory(id, name);
  });

  // ── Color picker ─────────────────────────────────────────────
  document.getElementById('colorPicker').addEventListener('click', e => {
    const swatch = e.target.closest('.color-swatch');
    if (!swatch) return;
    document.querySelectorAll('.color-swatch').forEach(s => {
      s.classList.remove('selected');
      s.setAttribute('aria-pressed', 'false');
    });
    swatch.classList.add('selected');
    swatch.setAttribute('aria-pressed', 'true');
  });

  // ── Modal: close on overlay click / [data-close] / Escape ───
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const active = [...document.querySelectorAll('.modal-overlay.active')];
    if (active.length) closeModal(active[active.length - 1].id);
  });

  // ── Confirm modal ────────────────────────────────────────────
  document.getElementById('confirmCancel').addEventListener('click', () => {
    _confirmCallback = null;
    closeModal('modalConfirm');
  });

  document.getElementById('confirmOk').addEventListener('click', () => {
    if (typeof _confirmCallback === 'function') {
      _confirmCallback();
      _confirmCallback = null;
    }
    closeModal('modalConfirm');
  });

  // ── Delegated clicks on dynamic content ─────────────────────
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;

    if (action === 'delete-app') {
      e.stopPropagation();
      const appId = el.dataset.appId;
      const app   = state.apps.find(a => a.id === appId);
      if (app) showConfirm(`Delete "${app.name}"?`, 'Delete application', () => deleteApp(appId));
    }

    if (action === 'edit-app') {
      e.stopPropagation();
      const appId = el.dataset.appId;
      const app   = state.apps.find(a => a.id === appId);
      if (!app) return;
      document.getElementById('editAppId').value          = app.id;
      document.getElementById('editAppName').value        = app.name;
      document.getElementById('editAppUrl').value         = app.url;
      document.getElementById('editAppPort').value        = app.port || '';
      document.getElementById('editAppDescription').value = app.description || '';
      document.getElementById('editAppImageUrl').value    = app.image_url   || '';
      updateImageThumb('editAppImageThumb', app.image_url || '');
      populateCategorySelect('editAppCategory', app.category_id);
      openModal('modalEditApp');
    }

    if (action === 'delete-category') {
      const catId = el.dataset.catId;
      const cat   = state.categories.find(c => c.id === catId);
      if (!cat) return;
      const n   = state.apps.filter(a => a.category_id === catId).length;
      const msg = n > 0
        ? `Delete "${cat.name}"? The ${n} application${n > 1 ? 's' : ''} will be moved to "Uncategorized".`
        : `Delete category "${cat.name}"?`;
      showConfirm(msg, 'Delete category', () => deleteCategory(catId));
    }

    if (action === 'rename-category') {
      const catId = el.dataset.catId;
      const cat   = state.categories.find(c => c.id === catId);
      if (!cat) return;
      document.getElementById('renameCatId').value   = cat.id;
      document.getElementById('renameCatName').value = cat.name;
      openModal('modalRenameCategory');
    }

    if (action === 'add-app-to-cat') {
      const catId = el.dataset.catId;
      populateCategorySelect('appCategory', catId);
      openModal('modalAddApp');
    }
  });

  // ── Keyboard: Enter/Space on focused card opens the link ─────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.app-card');
    if (!card || e.target !== card) return;
    e.preventDefault();
    card.querySelector('.app-card-link')?.click();
  });

  // ── Image inputs: file upload on select + URL live preview ──────
  document.getElementById('appImageFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('appImageUrl').value = '';
    // Local preview while uploading
    const reader = new FileReader();
    reader.onload = ev => updateImageThumb('appImageThumb', ev.target.result);
    reader.readAsDataURL(file);
    // Upload immediately
    setUploadState('app', 'uploading');
    try {
      const url = await uploadImageFile(file);
      document.getElementById('appImageUrl').value = url;
      setUploadState('app', 'done');
    } catch (err) {
      setUploadState('app', 'error');
      updateImageThumb('appImageThumb', '');
      e.target.value = '';
      showToast(err.message, 'error');
    }
  });
  document.getElementById('appImageUrl').addEventListener('input', e => {
    updateImageThumb('appImageThumb', e.target.value.trim());
    setUploadState('app', 'idle');
  });

  document.getElementById('editAppImageFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    document.getElementById('editAppImageUrl').value = '';
    const reader = new FileReader();
    reader.onload = ev => updateImageThumb('editAppImageThumb', ev.target.result);
    reader.readAsDataURL(file);
    setUploadState('editApp', 'uploading');
    try {
      const url = await uploadImageFile(file);
      document.getElementById('editAppImageUrl').value = url;
      setUploadState('editApp', 'done');
    } catch (err) {
      setUploadState('editApp', 'error');
      updateImageThumb('editAppImageThumb', '');
      e.target.value = '';
      showToast(err.message, 'error');
    }
  });
  document.getElementById('editAppImageUrl').addEventListener('input', e => {
    updateImageThumb('editAppImageThumb', e.target.value.trim());
    setUploadState('editApp', 'idle');
  });

});
