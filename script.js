/* ============================================================
   NetDashboard — script.js
   State management, rendering, drag-and-drop, persistence
   ============================================================ */

// ================================================================
// STATE & PERSISTENCE
// ================================================================

const STORAGE_KEY = 'netdashboard_v1';

const DEFAULT_STATE = {
  categories: [
    { id: 'uncategorized', name: 'Non classé', color: '#64748b', protected: true }
  ],
  apps: []
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Ensure the uncategorized bucket always exists
      if (!parsed.categories.find(c => c.id === 'uncategorized')) {
        parsed.categories.unshift({
          id: 'uncategorized',
          name: 'Non classé',
          color: '#64748b',
          protected: true
        });
      }
      return parsed;
    }
  } catch (_) { /* corrupted storage — start fresh */ }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
  document.getElementById('titleConfirm').textContent = title || 'Confirmer';
  _confirmCallback = onConfirm;
  openModal('modalConfirm');
}

// ================================================================
// CRUD OPERATIONS
// ================================================================

function addApp({ name, url, port, categoryId }) {
  const app = {
    id: 'app-' + generateId(),
    name: name.trim(),
    url: url.trim(),
    port: port ? String(port).trim() : null,
    categoryId: categoryId || 'uncategorized'
  };
  state.apps.push(app);
  saveState();
  renderAll();
  showToast(`"${app.name}" ajouté avec succès`);
}

function deleteApp(id) {
  const app = state.apps.find(a => a.id === id);
  if (!app) return;
  state.apps = state.apps.filter(a => a.id !== id);
  saveState();
  renderAll();
  showToast(`"${app.name}" supprimé`, 'info');
}

function addCategory({ name, color }) {
  const cat = {
    id: 'cat-' + generateId(),
    name: name.trim(),
    color: color || '#6366f1',
    protected: false
  };
  state.categories.push(cat);
  saveState();
  renderAll();
  showToast(`Catégorie "${cat.name}" créée`);
}

function deleteCategory(id) {
  const cat = state.categories.find(c => c.id === id);
  if (!cat || cat.protected) return;

  const moved = state.apps.filter(a => a.categoryId === id).length;
  state.apps.forEach(a => {
    if (a.categoryId === id) a.categoryId = 'uncategorized';
  });
  state.categories = state.categories.filter(c => c.id !== id);
  saveState();
  renderAll();

  const msg = moved > 0
    ? `Catégorie supprimée — ${moved} app${moved > 1 ? 's' : ''} déplacée${moved > 1 ? 's' : ''} dans "Non classé"`
    : `Catégorie "${cat.name}" supprimée`;
  showToast(msg, 'info');
}

function moveApp(appId, targetCategoryId) {
  const app = state.apps.find(a => a.id === appId);
  if (!app || app.categoryId === targetCategoryId) return;
  app.categoryId = targetCategoryId;
  saveState();
  renderAll();
  const cat = state.categories.find(c => c.id === targetCategoryId);
  showToast(`"${app.name}" déplacé vers "${cat?.name || 'la catégorie'}"`);
}

// ================================================================
// RENDERING
// ================================================================

function populateCategorySelect(selectId = 'appCategory') {
  const el = document.getElementById(selectId);
  if (!el) return;
  el.innerHTML = state.categories
    .map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`)
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
  populateCategorySelect();
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
      <h2>Aucune catégorie</h2>
      <p>Commencez par créer une catégorie, puis ajoutez vos applications.</p>
    </div>
  `;
}

function buildCategoryHTML(cat) {
  const apps = state.apps.filter(a => a.categoryId === cat.id);
  const count = apps.length;
  const isEmpty = count === 0;

  const deleteBtn = !cat.protected ? `
    <button class="btn-icon btn-icon-danger"
            data-action="delete-category"
            data-cat-id="${escapeHtml(cat.id)}"
            title="Supprimer la catégorie"
            aria-label="Supprimer ${escapeHtml(cat.name)}">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </button>` : '';

  const appsHTML = isEmpty
    ? `<div class="drop-hint">
         <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
           <path d="M12 5v14M5 12h14"/>
         </svg>
         <span>Déposez une application ici</span>
       </div>`
    : apps.map(buildAppCardHTML).join('');

  return `
    <section class="category-section" data-category-id="${escapeHtml(cat.id)}">
      <div class="category-header">
        <div class="category-title-group">
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
                  title="Ajouter une app dans cette catégorie"
                  aria-label="Ajouter une app dans ${escapeHtml(cat.name)}">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          ${deleteBtn}
        </div>
      </div>
      <div class="drop-zone ${isEmpty ? 'drop-zone-empty' : ''}"
           data-category-id="${escapeHtml(cat.id)}"
           aria-label="Zone de dépôt pour ${escapeHtml(cat.name)}">
        ${appsHTML}
      </div>
    </section>
  `;
}

function buildAppCardHTML(app) {
  const color = getAppColor(app.name);
  const href  = buildUrl(app.url, app.port);
  const label = displayUrl(app.url, app.port);

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
          <div class="app-icon"
               style="background:${color}1a;color:${color};border-color:${color}33;"
               aria-hidden="true">
            ${getInitial(app.name)}
          </div>
          <div class="app-info">
            <span class="app-name">${escapeHtml(app.name)}</span>
            <span class="app-url">${escapeHtml(label)}</span>
          </div>
          <span class="app-card-open-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
          </span>
        </a>
        <button class="app-delete-btn"
                data-action="delete-app"
                data-app-id="${escapeHtml(app.id)}"
                aria-label="Supprimer ${escapeHtml(app.name)}"
                title="Supprimer">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6"  y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </article>
  `;
}

// ================================================================
// DRAG & DROP
// ================================================================

let _draggedAppId = null;

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
}

function onCardDragStart(e) {
  _draggedAppId = this.dataset.appId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _draggedAppId);

  // Defer class addition so the browser snapshots the un-dimmed card
  requestAnimationFrame(() => {
    this.classList.add('dragging');
    document.querySelectorAll('.drop-zone').forEach(z => z.classList.add('droppable'));
  });
}

function onCardDragEnd() {
  this.classList.remove('dragging');
  _draggedAppId = null;
  document.querySelectorAll('.drop-zone').forEach(z => {
    z.classList.remove('droppable', 'drag-over');
  });
}

function onZoneDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}

function onZoneDragLeave(e) {
  // Only remove the class when truly leaving the zone (not entering a child)
  if (!this.contains(e.relatedTarget)) {
    this.classList.remove('drag-over');
  }
}

function onZoneDrop(e) {
  e.preventDefault();
  this.classList.remove('drag-over', 'droppable');

  const appId = _draggedAppId || e.dataTransfer.getData('text/plain');
  const catId  = this.dataset.categoryId;
  if (!appId || !catId) return;

  moveApp(appId, catId);
}

// ================================================================
// EVENT WIRING
// ================================================================

document.addEventListener('DOMContentLoaded', () => {

  // Initial render
  renderAll();

  // ── Header buttons ──────────────────────────────────────────
  document.getElementById('btnAddApp').addEventListener('click', () => {
    populateCategorySelect();
    openModal('modalAddApp');
  });

  document.getElementById('btnAddCategory').addEventListener('click', () => {
    openModal('modalAddCategory');
  });

  // ── Forms ────────────────────────────────────────────────────
  document.getElementById('formAddApp').addEventListener('submit', e => {
    e.preventDefault();
    const name     = document.getElementById('appName').value.trim();
    const url      = document.getElementById('appUrl').value.trim();
    const port     = document.getElementById('appPort').value.trim();
    const catId    = document.getElementById('appCategory').value;

    if (!name || !url) return;

    closeModal('modalAddApp');
    addApp({ name, url, port: port || null, categoryId: catId });
  });

  document.getElementById('formAddCategory').addEventListener('submit', e => {
    e.preventDefault();
    const name  = document.getElementById('categoryName').value.trim();
    const swatch = document.querySelector('#colorPicker .color-swatch.selected');
    const color = swatch ? swatch.dataset.color : '#6366f1';

    if (!name) return;

    closeModal('modalAddCategory');
    addCategory({ name, color });
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

  // ── Modal: close on overlay click ───────────────────────────
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // ── Modal: [data-close] buttons ──────────────────────────────
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // ── Keyboard: Escape closes topmost modal ───────────────────
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
      if (app) showConfirm(`Supprimer "${app.name}" ?`, 'Supprimer l\'application', () => deleteApp(appId));
    }

    if (action === 'delete-category') {
      const catId = el.dataset.catId;
      const cat   = state.categories.find(c => c.id === catId);
      if (!cat) return;
      const n = state.apps.filter(a => a.categoryId === catId).length;
      const msg = n > 0
        ? `Supprimer "${cat.name}" ? Les ${n} application${n > 1 ? 's' : ''} seront déplacées dans "Non classé".`
        : `Supprimer la catégorie "${cat.name}" ?`;
      showConfirm(msg, 'Supprimer la catégorie', () => deleteCategory(catId));
    }

    if (action === 'add-app-to-cat') {
      const catId = el.dataset.catId;
      populateCategorySelect();
      const select = document.getElementById('appCategory');
      if (select) select.value = catId;
      openModal('modalAddApp');
    }
  });

  // ── Keyboard: Enter/Space on app card opens the link ────────
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.app-card');
    if (!card || e.target !== card) return;
    e.preventDefault();
    const link = card.querySelector('.app-card-link');
    if (link) link.click();
  });

});
