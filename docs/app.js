// ─────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────
const CLAUDE_CTX = 200000;
const MAX_CODE_CHARS = 5000;
const MAX_RENAME_COUNT = 80;
const AUTO_COMPRESS_DELAY = 1200;
const MAX_HISTORY_SIZE = 50;
const MAX_AI_TOKENS = 4000;

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────
const files = new Map();
const folders = new Map();
let activeFileId = null;
let currentStrategy = 'none';
let compressionHistory = [];
let autoCompressTimer = null;

// ─────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9); }
function escH(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function estTok(s) { return s ? Math.ceil(s.length / 3.8) : 0; }
function fmtBytes(b) { return b < 1024 ? b + 'B' : b < 1048576 ? (b / 1024).toFixed(1) + 'KB' : (b / 1048576).toFixed(1) + 'MB'; }
function fmtTime(ts) { const d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

function getLang(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = { js: 'js', jsx: 'js', ts: 'js', tsx: 'js', mjs: 'js', cjs: 'js', html: 'html', htm: 'html', css: 'css', scss: 'css', sass: 'css', less: 'css', py: 'py', python: 'py', json: 'other', md: 'other', txt: 'other', yaml: 'other', yml: 'other' };
  return map[ext] || 'other';
}
function getLangBadgeClass(lang) { return { js: 'lang-js', html: 'lang-html', css: 'lang-css', py: 'lang-py', other: 'lang-other' }[lang] || 'lang-other'; }
function getLangIcon(lang) { return { js: '📜', html: '🌐', css: '🎨', py: '🐍', other: '📄' }[lang] || '📄'; }
function isCompressible(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ['js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sass', 'py', 'json', 'md', 'txt', 'mjs', 'cjs', 'less'].includes(ext);
}

// ─────────────────────────────────────────
//  TOAST
// ─────────────────────────────────────────
function showToast(msg, type = 'ok', dur = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg; t.className = 'toast show ' + (type === 'ok' ? 'ok' : 'err');
  setTimeout(() => t.className = 'toast', dur);
}
function setProgress(pct) {
  const el = document.getElementById('progressFill');
  if (el) el.style.width = pct + '%';
}
function setAIProg(pct, stage) {
  const el = document.getElementById('aiProg');
  const stageEl = document.getElementById('aiStage');
  if (el) el.style.width = pct + '%';
  if (stageEl) stageEl.textContent = stage || '';
}

// ─────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────
const THEME_KEY = 'tokencrush-theme';
function loadStoredTheme() { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } }
function storeTheme(t) { try { localStorage.setItem(THEME_KEY, t); } catch (e) { } }
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('themeToggle');
  if (toggle) {
    const next = theme === 'light' ? 'dark' : 'light';
    toggle.setAttribute('aria-pressed', theme === 'light');
    toggle.title = 'Switch to ' + next + ' mode';
    toggle.setAttribute('aria-label', 'Switch to ' + next + ' mode');
  }
  const meta = document.getElementById('themeColorMeta');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f4f7' : '#0b0b0e');
}
function toggleTheme() {
  const next = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark' ? 'light' : 'dark';
  applyTheme(next); storeTheme(next);
}
try {
  window.matchMedia('(prefers-color-scheme:light)').addEventListener('change', e => {
    if (!loadStoredTheme()) applyTheme(e.matches ? 'light' : 'dark');
  });
} catch (e) { }

// ─────────────────────────────────────────
//  TOKEN BUDGET BAR
// ─────────────────────────────────────────
function updateBudgetBar() {
  const f = files.get(activeFileId); if (!f) return;
  const tok = estTok(f.content);
  const pct = Math.min(100, Math.round((tok / CLAUDE_CTX) * 100));
  const fill = document.getElementById('budgetBarFill');
  const wrap = document.getElementById('budgetBarWrap');
  if (fill) { fill.style.width = pct + '%'; fill.className = 'budget-bar-fill' + (pct > 80 ? ' warn' : ''); }
  if (wrap) wrap.title = `${tok.toLocaleString()} / ${CLAUDE_CTX.toLocaleString()} tokens (${pct}% of Claude context)`;
}

// ─────────────────────────────────────────
//  GLOBAL SESSION STATS
// ─────────────────────────────────────────
function updateGlobalStats() {
  const done = [...files.values()].filter(f => f.compressed);
  const totalIn = done.reduce((s, f) => s + f.tokenIn, 0);
  const totalOut = done.reduce((s, f) => s + f.tokenOut, 0);
  const saved = totalIn - totalOut;
  const avg = totalIn > 0 ? Math.round((saved / totalIn) * 100) : 0;
  const gs = document.getElementById('globalStats');
  if (!gs) return;
  if (!done.length) { gs.style.display = 'none'; return; }
  gs.style.display = 'flex';
  const el1 = document.getElementById('gsTotalFiles');
  const el2 = document.getElementById('gsTotalSaved');
  const el3 = document.getElementById('gsAvgReduction');
  if (el1) el1.textContent = done.length;
  if (el2) el2.textContent = saved.toLocaleString();
  if (el3) el3.textContent = avg + '%';
}

// ─────────────────────────────────────────
//  EDITOR META (line/char/cursor)
// ─────────────────────────────────────────
function updateEditorMeta() {
  const ta = document.getElementById('codeEditor');
  const meta = document.getElementById('editorMetaRow');
  if (!ta || !meta) return;
  if (ta.style.display === 'none') { meta.style.display = 'none'; return; }
  meta.style.display = 'flex';
  const val = ta.value;
  const lines = val.split('\n').length;
  const el1 = document.getElementById('emLines');
  const el2 = document.getElementById('emChars');
  const el3 = document.getElementById('emCursor');
  if (el1) el1.textContent = lines.toLocaleString();
  if (el2) el2.textContent = val.length.toLocaleString();
  const pos = ta.selectionStart;
  const before = val.substring(0, pos);
  const row = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  if (el3) el3.textContent = row + ':' + col;
}
document.addEventListener('DOMContentLoaded', () => {
  const ta = document.getElementById('codeEditor');
  if (ta) {
    ta.addEventListener('click', updateEditorMeta);
    ta.addEventListener('keyup', updateEditorMeta);
  }
});

// ─────────────────────────────────────────
//  TOKEN PILL COLOUR
// ─────────────────────────────────────────
function updateTokenPill(tok) {
  const pill = document.getElementById('editorTokenPill');
  if (!pill) return;
  pill.textContent = tok.toLocaleString() + ' tokens';
  const pct = (tok / CLAUDE_CTX) * 100;
  pill.className = 'token-pill' + (pct > 80 ? ' danger' : pct > 50 ? ' warn' : '');
}

// ─────────────────────────────────────────
//  FILE MANAGEMENT
// ─────────────────────────────────────────
// ─────────────────────────────────────────
//  FOLDER MANAGEMENT
// ─────────────────────────────────────────
function addFolder(name, parentId = null) {
  for (const [id, f] of folders) {
    if (f.name === name && f.parentId === parentId) return id;
  }
  const id = uid();
  folders.set(id, { name, parentId, collapsed: false });
  return id;
}

function deleteFolder(folderId, e) {
  if (e) e.stopPropagation();
  for (const [id, f] of files) {
    if (f.folderId === folderId || isDescendantFolder(f.folderId, folderId)) {
      files.delete(id);
      if (activeFileId === id) { activeFileId = null; showEditorEmpty(); showOutEmpty(); }
    }
  }
  for (const [id] of folders) {
    if (isDescendantFolder(id, folderId)) folders.delete(id);
  }
  folders.delete(folderId);
  renderFileList(); updateFileCount(); updateGlobalStats();
  if (activeFileId === null && files.size > 0) selectFile(files.keys().next().value);
}

function isDescendantFolder(folderId, ancestorId) {
  if (!folderId) return false;
  let cur = folderId;
  while (cur) {
    const f = folders.get(cur);
    if (!f) return false;
    if (f.parentId === ancestorId) return true;
    cur = f.parentId;
  }
  return false;
}

function toggleFolder(folderId) {
  const f = folders.get(folderId); if (!f) return;
  f.collapsed = !f.collapsed;
  renderFileList();
}

function getFolderPath(folderId) {
  const parts = [];
  let cur = folderId;
  while (cur) {
    const f = folders.get(cur);
    if (!f) break;
    parts.unshift(f.name);
    cur = f.parentId;
  }
  return parts.join('/');
}

function addFile(name, content, folderId = null) {
  if (!isCompressible(name)) { showToast('Skipped: ' + name + ' (unsupported type)', 'err'); return; }
  for (const [id, f] of files) {
    if (f.name === name && f.folderId === folderId) {
      f.content = content; f.tokenIn = estTok(content);
      f.compressed = ''; f.ctxMap = []; f.pseudo = '';
      renderFileList();
      return id;
    }
  }
  const id = uid();
  files.set(id, { name, content, lang: getLang(name), folderId, compressed: '', ctxMap: [], pseudo: '', tokenIn: estTok(content), tokenOut: 0 });
  renderFileList();
  if (!activeFileId) selectFile(id);
  updateFileCount();
  return id;
}

// ─────────────────────────────────────────
//  HANDLE DROPPED / SELECTED FILES
// ─────────────────────────────────────────
async function handleFiles(fileList, parentFolderId = null) {
  const arr = Array.from(fileList);
  for (const f of arr) {
    if (f.name.endsWith('.zip')) await handleZip(f, parentFolderId);
    else { const text = await f.text(); addFile(f.name, text, parentFolderId); }
  }
}

async function handleDataTransferItems(items) {
  const entries = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) await handleFiles([f]);
    }
  }
  for (const entry of entries) {
    await processEntry(entry, null);
  }
  renderFileList(); updateFileCount(); updateGlobalStats();
}

async function processEntry(entry, parentFolderId) {
  if (entry.isDirectory) {
    const folderId = addFolder(entry.name, parentFolderId);
    const reader = entry.createReader();
    const allEntries = [];
    const readBatch = () => new Promise((res, rej) => reader.readEntries(res, rej));
    let batch;
    do {
      batch = await readBatch();
      allEntries.push(...batch);
    } while (batch.length > 0);
    for (const child of allEntries) await processEntry(child, folderId);
  } else if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    if (file.name.endsWith('.zip')) await handleZip(file, parentFolderId);
    else if (isCompressible(file.name)) {
      const text = await file.text();
      addFile(file.name, text, parentFolderId);
    }
  }
}

// ─────────────────────────────────────────
//  LAZY LOAD JSZip
// ─────────────────────────────────────────
let _jszipPromise = null;
function loadJSZip() {
  if (typeof JSZip !== 'undefined') return Promise.resolve();
  if (_jszipPromise) return _jszipPromise;
  _jszipPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Failed to load JSZip'));
    document.head.appendChild(script);
  });
  return _jszipPromise;
}

async function handleZip(file, parentFolderId = null) {
  try {
    await loadJSZip();
    const zip = await JSZip.loadAsync(file);
    const folderCache = {};
    function ensureFolder(parts, parent) {
      if (!parts.length) return parent;
      const key = parts.join('/');
      if (folderCache[key]) return folderCache[key];
      const id = addFolder(parts[parts.length - 1], parent);
      folderCache[key] = id;
      return id;
    }
    const entries = [];
    zip.forEach((path, entry) => {
      if (!entry.dir && isCompressible(path.split('/').pop())) entries.push({ path, entry });
    });
    if (!entries.length) { showToast('ZIP has no supported code files', 'err'); return; }
    let added = 0;
    for (const { path, entry } of entries) {
      const parts = path.split('/').filter(Boolean);
      const fileName = parts.pop();
      let fid = parentFolderId;
      if (parts.length) {
        for (let i = 0; i < parts.length; i++) {
          fid = ensureFolder(parts.slice(0, i + 1), i === 0 ? parentFolderId : folderCache[parts.slice(0, i).join('/')]);
        }
      }
      const text = await entry.async('text');
      addFile(fileName, text, fid); added++;
    }
    showToast(`Extracted ${added} files from ${file.name}`);
  } catch (e) { showToast('Failed to read ZIP: ' + e.message, 'err'); }
}

async function handleFolderInputChange(input) {
  const fileArr = Array.from(input.files);
  const folderCache = {};
  function ensureFolder(parts, startParent) {
    let parent = startParent || null;
    let pathSoFar = '';
    for (let i = 0; i < parts.length; i++) {
      pathSoFar = pathSoFar ? pathSoFar + '/' + parts[i] : parts[i];
      if (folderCache[pathSoFar]) {
        parent = folderCache[pathSoFar];
      } else {
        const id = addFolder(parts[i], parent);
        folderCache[pathSoFar] = id;
        parent = id;
      }
    }
    return parent;
  }
  for (const f of fileArr) {
    const rel = f.webkitRelativePath || f.name;
    const parts = rel.split('/').filter(Boolean);
    const fileName = parts.pop();
    const folderId = parts.length ? ensureFolder(parts, null) : null;
    if (!isCompressible(fileName)) { continue; }
    const text = await f.text();
    addFile(fileName, text, folderId);
  }
  input.value = '';
  renderFileList(); updateFileCount();
}

function handleFileInputChange(input) { handleFiles(input.files); input.value = ''; }
function triggerFileInput() { document.getElementById('globalFileInput').click(); }
function triggerFolderInput() { document.getElementById('globalFolderInput').click(); }

// ─────────────────────────────────────────
//  FILE SEARCH / FILTER
// ─────────────────────────────────────────
let fileFilter = '';
function filterFiles(q) { fileFilter = q.toLowerCase(); renderFileList(); }

// ─────────────────────────────────────────
//  FILE LIST RENDER (tree-aware)
// ─────────────────────────────────────────
function countLines(content) { return content ? content.split('\n').length : 0; }

function createFileElement(id, f, depth, isActive) {
  const lines = countLines(f.content);
  const hasDone = f.compressed !== '';
  const div = document.createElement('div');
  div.className = 'file-item' + (isActive ? ' active' : '') + (depth > 0 ? ' indented' : '');
  div.dataset.id = id; div.dataset.depth = depth;
  div.style.setProperty('--depth', depth);
  div.tabIndex = 0;
  div.setAttribute('role', 'button');
  div.setAttribute('aria-label', 'File ' + f.name);
  let tokChip = '';
  if (hasDone) {
    const saved = f.tokenIn - f.tokenOut;
    const pct = f.tokenIn > 0 ? Math.round((saved / f.tokenIn) * 100) : 0;
    tokChip = `<span class="fi-tok compressed" title="Before: ${f.tokenIn} · After: ${f.tokenOut} · -${pct}%">${f.tokenOut}tok</span>`;
  } else {
    tokChip = `<span class="fi-tok" title="${f.tokenIn} tokens">${f.tokenIn}tok</span>`;
  }
  div.innerHTML = `
    <span class="fi-status ${hasDone ? 'done' : 'pending'}"></span>
    <span class="fi-icon">${getLangIcon(f.lang)}</span>
    <span class="fi-name" title="${escAttr(f.name)}">${escH(f.name)}</span>
    <span class="fi-lines">${lines.toLocaleString()}L</span>
    ${tokChip}
    <button class="fi-del" onclick="deleteFile('${id}',event)" title="Remove">✕</button>
  `;
  div.addEventListener('click', () => selectFile(id));
  div.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFile(id); } });
  return div;
}

function renderFileList() {
  const list = document.getElementById('fileList');
  if (!list) return;
  list.innerHTML = '';
  if (!files.size) { list.innerHTML = '<div style="text-align:center;padding:20px 10px;font-size:10px;color:var(--muted)">No files yet</div>'; return; }

  function getChildren(parentFolderId) {
    const childFolders = [];
    const childFiles = [];
    for (const [id, f] of folders) { if (f.parentId === parentFolderId) childFolders.push(id); }
    for (const [id, f] of files) { if (f.folderId === parentFolderId) childFiles.push(id); }
    return { childFolders, childFiles };
  }

  function renderFolderNode(container, fid, depth) {
    const fo = folders.get(fid); if (!fo) return;
    const subtreeFiles = [...files.values()].filter(f => f.folderId === fid || isDescendantFolder(f.folderId, fid));
    const div = document.createElement('div');
    div.className = 'folder-item' + (depth > 0 ? ' indented' : '');
    div.dataset.depth = depth;
    div.style.setProperty('--depth', depth);
    div.innerHTML = `
      <span class="folder-toggle ${fo.collapsed ? '' : 'open'}" id="ftgl_${fid}">▶</span>
      <span class="folder-icon">📁</span>
      <span class="folder-name" title="${escAttr(getFolderPath(fid))}">${escH(fo.name)}</span>
      <span class="folder-count">${subtreeFiles.length}</span>
      <button class="folder-del" onclick="deleteFolder('${fid}',event)" title="Remove folder">✕</button>
    `;
    div.addEventListener('click', e => { if (!e.target.classList.contains('folder-del')) toggleFolder(fid); });
    container.appendChild(div);
    const childWrap = document.createElement('div');
    childWrap.className = 'folder-children' + (fo.collapsed ? ' collapsed' : '');
    if (fo.collapsed) childWrap.style.maxHeight = '0px';
    container.appendChild(childWrap);
    renderNodeInto(childWrap, fid, depth + 1);
  }

  function renderNodeInto(container, parentFolderId, depth) {
    const { childFolders, childFiles } = getChildren(parentFolderId);
    for (const fid of childFolders) {
      renderFolderNode(container, fid, depth);
    }
    for (const id of childFiles) {
      const f = files.get(id);
      if (fileFilter && !f.name.toLowerCase().includes(fileFilter)) continue;
      container.appendChild(createFileElement(id, f, depth, id === activeFileId));
    }
  }

  // Root folders
  const rootFolders = [...folders.entries()].filter(([, f]) => f.parentId === null);
  for (const [fid] of rootFolders) {
    renderFolderNode(list, fid, 0);
  }

  // Root-level files
  const rootFiles = [...files.entries()].filter(([, f]) => f.folderId === null);
  for (const [id, f] of rootFiles) {
    if (fileFilter && !f.name.toLowerCase().includes(fileFilter)) continue;
    list.appendChild(createFileElement(id, f, 0, id === activeFileId));
  }
}

function selectFile(id) {
  activeFileId = id;
  const f = files.get(id); if (!f) return;
  renderFileList();
  const ee = document.getElementById('editorEmpty');
  if (ee) ee.style.display = 'none';
  const ed = document.getElementById('codeEditor');
  if (ed) { ed.style.display = 'block'; ed.value = f.content; }
  const ef = document.getElementById('editorFilename');
  if (ef) ef.textContent = f.name;
  const lb = document.getElementById('langBadge');
  if (lb) { lb.textContent = f.lang.toUpperCase(); lb.className = 'lang-badge ' + getLangBadgeClass(f.lang); }
  updateTokenPill(estTok(f.content));
  updateBudgetBar();
  updateEditorMeta();
  const of = document.getElementById('outFilename');
  if (of) of.textContent = f.name;
  if (f.compressed) renderOutput(id);
  else showOutEmpty();
}

function deleteFile(id, e) {
  e.stopPropagation();
  files.delete(id);
  if (activeFileId === id) { activeFileId = null; showEditorEmpty(); showOutEmpty(); }
  renderFileList(); updateFileCount(); updateGlobalStats();
  if (activeFileId === null && files.size > 0) selectFile(files.keys().next().value);
}

function updateFileCount() {
  const n = files.size;
  const badge = document.getElementById('fileCountBadge');
  const btn = document.getElementById('compressAllBtn');
  if (badge) badge.textContent = n === 0 ? 'No files loaded' : `${n} file${n === 1 ? '' : 's'} loaded`;
  if (btn) btn.disabled = n === 0;
}

function showEditorEmpty() {
  const ee = document.getElementById('editorEmpty');
  const ed = document.getElementById('codeEditor');
  const meta = document.getElementById('editorMetaRow');
  const ef = document.getElementById('editorFilename');
  const lb = document.getElementById('langBadge');
  if (ee) ee.style.display = 'flex';
  if (ed) ed.style.display = 'none';
  if (meta) meta.style.display = 'none';
  if (ef) ef.textContent = 'No file selected';
  if (lb) { lb.textContent = '—'; lb.className = 'lang-badge lang-other'; }
  updateTokenPill(0);
  const bf = document.getElementById('budgetBarFill');
  if (bf) bf.style.width = '0%';
}
function showOutEmpty() {
  const oe = document.getElementById('outEmpty');
  const oc = document.getElementById('outCode');
  const sb = document.getElementById('statsBar');
  if (oe) oe.style.display = 'flex';
  if (oc) oc.style.display = 'none';
  if (sb) sb.style.display = 'none';
  const pseudo = document.getElementById('pseudoBar');
  const ctx = document.getElementById('ctxDrawer');
  const diff = document.getElementById('diffView');
  const prompt = document.getElementById('promptView');
  const bundle = document.getElementById('bundleView');
  const hist = document.getElementById('historyView');
  if (pseudo) pseudo.classList.remove('show');
  if (ctx) ctx.classList.remove('open');
  if (diff) diff.classList.remove('show');
  if (prompt) prompt.classList.remove('show');
  if (bundle) bundle.classList.remove('show');
  if (hist) hist.classList.remove('show');
  setProgress(0);
}

// ─────────────────────────────────────────
//  DRAG & DROP
// ─────────────────────────────────────────
function onDragOver(e, id) { e.preventDefault(); document.getElementById(id)?.classList.add('drag-over'); }
function onDragLeave(id) { document.getElementById(id)?.classList.remove('drag-over'); }
function onDrop(e, id) {
  e.preventDefault();
  document.getElementById(id)?.classList.remove('drag-over');
  const dt = e.dataTransfer;
  if (dt.items && dt.items.length > 0) {
    handleDataTransferItems(dt.items);
  } else {
    handleFiles(dt.files);
  }
}
document.body.addEventListener('dragover', e => e.preventDefault());
document.body.addEventListener('drop', e => {
  e.preventDefault();
  const dt = e.dataTransfer;
  if (dt.items && dt.items.length > 0) handleDataTransferItems(dt.items);
  else handleFiles(dt.files);
});

// ─────────────────────────────────────────
//  EDITOR LIVE UPDATE
// ─────────────────────────────────────────
function onEditorInput() {
  const f = files.get(activeFileId); if (!f) return;
  f.content = document.getElementById('codeEditor').value;
  f.compressed = ''; f.ctxMap = []; f.pseudo = ''; f.tokenIn = estTok(f.content);
  updateTokenPill(f.tokenIn);
  updateBudgetBar();
  updateEditorMeta();
  renderFileList();
  const autoEl = document.getElementById('tglAutoCompress');
  if (autoEl && autoEl.checked) {
    clearTimeout(autoCompressTimer);
    autoCompressTimer = setTimeout(() => compressCurrent(), AUTO_COMPRESS_DELAY);
  }
}

// ─────────────────────────────────────────
//  FIND / REPLACE
// ─────────────────────────────────────────
let findMatches = [], findIdx = 0;
function openFindBar() {
  const bar = document.getElementById('findBar');
  const input = document.getElementById('findInput');
  if (bar) bar.classList.add('show');
  if (input) input.focus();
}
function closeFindBar() {
  const bar = document.getElementById('findBar');
  if (bar) bar.classList.remove('show');
  const ta = document.getElementById('codeEditor');
  if (ta) ta.focus();
  findMatches = []; findIdx = 0;
}
function doFind() {
  const q = document.getElementById('findInput').value;
  const ta = document.getElementById('codeEditor');
  findMatches = []; findIdx = 0;
  if (!q) { const fi = document.getElementById('findInfo'); if (fi) fi.textContent = '0/0'; return; }
  const text = ta.value; let i = 0;
  while ((i = text.indexOf(q, i)) !== -1) { findMatches.push(i); i += q.length; }
  const fi = document.getElementById('findInfo');
  if (fi) fi.textContent = findMatches.length ? `1/${findMatches.length}` : '0/0';
  if (findMatches.length) highlightFind(0);
}
function highlightFind(idx) {
  const ta = document.getElementById('codeEditor');
  const q = document.getElementById('findInput').value;
  findIdx = idx;
  ta.focus(); ta.setSelectionRange(findMatches[idx], findMatches[idx] + q.length);
  const fi = document.getElementById('findInfo');
  if (fi) fi.textContent = `${idx + 1}/${findMatches.length}`;
}
function findNext() { if (!findMatches.length) return; highlightFind((findIdx + 1) % findMatches.length); }
function findPrev() { if (!findMatches.length) return; highlightFind((findIdx - 1 + findMatches.length) % findMatches.length); }
function doReplace() {
  const ta = document.getElementById('codeEditor');
  const q = document.getElementById('findInput').value;
  const r = document.getElementById('replaceInput').value;
  if (!q || !findMatches.length) return;
  const pos = findMatches[findIdx];
  ta.setSelectionRange(pos, pos + q.length);
  document.execCommand('insertText', false, r);
  onEditorInput(); doFind();
}
function doReplaceAll() {
  const ta = document.getElementById('codeEditor');
  const q = document.getElementById('findInput').value;
  const r = document.getElementById('replaceInput').value;
  if (!q) return;
  const count = (ta.value.match(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  ta.value = ta.value.split(q).join(r);
  onEditorInput(); doFind();
  showToast(`Replaced ${count} occurrence${count !== 1 ? 's' : ''}`);
}

// ─────────────────────────────────────────
//  AI STRATEGY
// ─────────────────────────────────────────
function setStrategy(s, el) {
  currentStrategy = s;
  document.querySelectorAll('.spill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
}

// ─────────────────────────────────────────
//  LOCAL COMPRESSION ENGINE
// ─────────────────────────────────────────
function stripCommentsJS(code) {
  let r = '', i = 0;
  while (i < code.length) {
    if (code[i] === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i++; }
    else if (code[i] === '/' && code[i + 1] === '*') { i += 2; while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++; i += 2; }
    else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const q = code[i]; r += code[i++];
      while (i < code.length) { if (code[i] === '\\') { r += code[i++]; r += code[i++]; continue; } r += code[i]; if (code[i++] === q) break; }
    } else { r += code[i++]; }
  }
  return r;
}
function stripCommentsHTML(code) { return code.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, ''); }

function stripWhitespace(code, lang) {
  if (lang === 'html') return code.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').replace(/>\s+</g, '><').replace(/;\s+/g, ';').replace(/\{\s+/g, '{').replace(/\s+\}/g, '}').replace(/:\s+/g, ':').trim();
  if (lang === 'css') return code.replace(/\s*\n\s*/g, '').replace(/\s{2,}/g, ' ').replace(/\s*\{\s*/g, '{').replace(/\s*\}\s*/g, '}').replace(/\s*:\s*/g, ':').replace(/\s*;\s*/g, ';').replace(/\s*,\s*/g, ',').replace(/;}/g, '}').trim();
  return code.replace(/\r?\n\s*/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').replace(/ *([=+\-*/<>!&|,;:{}()[\]]) */g, '$1').replace(/\n([=+\-*/<>!&|,;{}()[\]])/g, '$1').replace(/([=+\-*/<>!&|,;{}()[\]])\n/g, '$1').trim();
}

const RESERVED = new Set(['break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'null', 'return', 'static', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'async', 'await', 'of', 'from', 'get', 'set', 'arguments', 'undefined', 'NaN', 'Infinity', 'console', 'document', 'window', 'process', 'module', 'require', 'exports', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Error', 'Math', 'JSON', 'Date', 'Map', 'Set', 'Symbol', 'Proxy', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'fetch', 'XMLHttpRequest', 'addEventListener', 'querySelector', 'getElementById', 'length', 'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every', 'includes', 'indexOf', 'slice', 'splice', 'join', 'split', 'toString', 'valueOf', 'hasOwnProperty', 'prototype', 'constructor', 'keys', 'values', 'entries', 'assign', 'create', 'freeze', 'log', 'warn', 'error', 'info', 'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race', 'any', 'next', 'done', 'value', 'type', 'name', 'message', 'stack', 'code', 'status', 'data', 'body', 'headers', 'url', 'method', 'params', 'options', 'config', 'response', 'request', 'callback', 'event', 'target', 'src', 'href', 'id', 'className', 'style', 'innerHTML', 'textContent', 'append', 'remove', 'setAttribute', 'getAttribute', 'children', 'parentNode', 'call', 'apply', 'bind', 'sort', 'reverse', 'concat', 'flat', 'fill', 'replaceAll', 'replace', 'match', 'test', 'exec', 'search', 'trim', 'startsWith', 'endsWith', 'padStart', 'padEnd', 'repeat', 'charAt', 'stringify', 'parse', 'max', 'min', 'abs', 'ceil', 'floor', 'round', 'random', 'pow', 'sqrt', 'PI', 'E', 'sin', 'cos', 'tan', 'now', 'getTime', 'size', 'has', 'add', 'delete', 'clear', 'emit', 'on', 'off', 'once']);

function minifyIds(code) {
  const cands = {};
  const re = /\b([a-zA-Z_][a-zA-Z0-9_$]*)\b/g; let m;
  while ((m = re.exec(code)) !== null) { const id = m[1]; if (!RESERVED.has(id) && id.length > 4) cands[id] = (cands[id] || 0) + 1; }
  const sorted = Object.entries(cands).filter(([k, v]) => k.length > 4).sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length));
  const cs = 'abcdefghijklmnopqrstuvwxyz';
  const gen = i => i < 26 ? '_' + cs[i] : '_' + cs[Math.floor(i / 26) - 1] + cs[i % 26];
  const nameMap = {}; const ctxMap = [];
  sorted.slice(0, MAX_RENAME_COUNT).forEach(([id], i) => { nameMap[id] = gen(i); ctxMap.push({ from: id, to: gen(i), count: cands[id] }); });
  const result = code.replace(/\b([a-zA-Z_][a-zA-Z0-9_$]*)\b/g, w => nameMap[w] || w);
  return { code: result, ctxMap };
}

function localCompress(content, lang) {
  const doWS = document.getElementById('tglWS').checked;
  const doCmt = document.getElementById('tglCmt').checked;
  const doRename = document.getElementById('tglRename').checked;
  let code = content;
  if (doCmt) code = lang === 'html' ? stripCommentsHTML(code) : stripCommentsJS(code);
  if (doWS) code = stripWhitespace(code, lang);
  let ctxMap = [];
  if (doRename && lang !== 'html' && lang !== 'css') { const r = minifyIds(code); code = r.code; ctxMap = r.ctxMap; }
  return { code, ctxMap };
}

// ─────────────────────────────────────────
//  AI COMPRESSION
// ─────────────────────────────────────────
async function aiCompressCode(code, strategy, lang, fileName) {
  const P = {
    pseudo: `You are a code compression expert. Given this ${lang} code from file "${fileName}", produce:
1. A maximally compressed but valid version
2. A 2-sentence summary of what it does

Respond ONLY as JSON (no fences): {"compressed":"...","summary":"..."}

CODE:
${code.slice(0, MAX_CODE_CHARS)}`,

    semantic: `You are an expert at compressing ${lang} code for AI consumption. Rewrite it maximally compressed:
- Collapse multi-line logic into single expressions
- Use shorthand/ternary/destructuring aggressively
- Remove dead code, redundant variables, unnecessary wrappers
- Inline single-call functions
- Keep 100% logical equivalence

Respond ONLY as JSON (no fences): {"compressed":"...","summary":"...one sentence what this does..."}

CODE:
${code.slice(0, MAX_CODE_CHARS)}`,

    deep: `You are the world's most aggressive token optimizer for ${lang}. File: "${fileName}".
Apply ALL of: remove whitespace, rename identifiers to 1-2 chars, collapse all logic, inline vars, chain methods, implicit returns, ternaries everywhere, bitwise where shorter.
Also output renamed identifier map and one-line summary.

Respond ONLY as JSON (no fences): {"compressed":"...","contextMap":[{"from":"...","to":"..."}],"summary":"..."}

CODE:
${code.slice(0, MAX_CODE_CHARS)}`
  };

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: MAX_AI_TOKENS, messages: [{ role: 'user', content: P[strategy] }] })
    });
  } catch (e) {
    throw new Error('Network error: ' + e.message);
  }
  const data = await res.json();
  const text = data.content.map(b => b.text || '').join('');
  const clean = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); }
  catch (e) { const m = clean.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error('AI parse failed'); }
}

// ─────────────────────────────────────────
//  COMPRESS SINGLE
// ─────────────────────────────────────────
async function compressCurrent() {
  if (!activeFileId) { showToast('No file selected', 'err'); return; }
  await compressFileById(activeFileId, true);
}

async function compressFileById(id, showUI = false) {
  const f = files.get(id); if (!f) return;
  const statusEl = document.querySelector(`.file-item[data-id="${id}"] .fi-status`);
  if (statusEl) statusEl.className = 'fi-status processing';
  setProgress(20);
  const { code: localCode, ctxMap: localCtx } = localCompress(f.content, f.lang);
  setProgress(50);
  let finalCode = localCode, ctxMap = localCtx, pseudo = '';
  if (currentStrategy !== 'none') {
    if (showUI) document.getElementById('aiOverlay').classList.add('show');
    setAIProg(20, 'Analyzing code structure...');
    try {
      const r = await aiCompressCode(localCode, currentStrategy, f.lang, f.name);
      finalCode = r.compressed || localCode;
      pseudo = r.summary || '';
      const aiCtx = (r.contextMap || []).map(i => ({ from: i.from, to: i.to, count: 1, source: 'AI' }));
      ctxMap = [...localCtx, ...aiCtx];
      setAIProg(90, 'Finalizing...');
    } catch (e) { showToast('AI error: ' + e.message, 'err'); }
    if (showUI) document.getElementById('aiOverlay').classList.remove('show');
  }
  f.compressed = finalCode; f.ctxMap = ctxMap; f.pseudo = pseudo;
  f.tokenIn = estTok(f.content); f.tokenOut = estTok(finalCode);

  compressionHistory.unshift({
    ts: Date.now(), fileName: f.name,
    tokenIn: f.tokenIn, tokenOut: f.tokenOut,
    reduction: f.tokenIn > 0 ? Math.round(((f.tokenIn - f.tokenOut) / f.tokenIn) * 100) : 0,
    compressed: finalCode, ctxMap: [...ctxMap],
    strategy: currentStrategy
  });
  if (compressionHistory.length > MAX_HISTORY_SIZE) compressionHistory.pop();

  setProgress(100);
  setTimeout(() => setProgress(0), 700);
  renderFileList();
  updateGlobalStats();
  if (id === activeFileId) renderOutput(id);
  return f;
}

// ─────────────────────────────────────────
//  COMPRESS ALL
// ─────────────────────────────────────────
async function compressAll() {
  if (!files.size) { showToast('No files loaded', 'err'); return; }
  const ids = [...files.keys()];
  const btn = document.getElementById('compressAllBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>⚙️</span> Compressing...'; }
  const overlay = document.getElementById('aiOverlay');
  const fileListEl = document.getElementById('aiFileList');
  if (overlay) overlay.classList.add('show');
  if (fileListEl) fileListEl.innerHTML = ids.map(id => `<div class="ai-file-item" id="aif_${id}">○ ${escAttr(files.get(id).name)}</div>`).join('');
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const f = files.get(id);
    setAIProg(Math.round((i / ids.length) * 100), `Processing ${i + 1}/${ids.length}: ${f.name}`);
    const el = document.getElementById('aif_' + id);
    if (el) { el.className = 'ai-file-item active'; el.textContent = '⟳ ' + f.name; }
    await compressFileById(id, false);
    if (el) { el.className = 'ai-file-item done'; el.textContent = '✓ ' + f.name; }
  }
  setAIProg(100, 'Done!');
  setTimeout(() => { if (overlay) overlay.classList.remove('show'); }, 600);
  if (btn) { btn.disabled = false; btn.innerHTML = '<span>⚡</span> Compress All'; }
  buildBundleView();
  switchTabByName('bundle');
  showToast(`Compressed ${ids.length} files successfully`);
}

// ─────────────────────────────────────────
//  RENDER OUTPUT
// ─────────────────────────────────────────
function renderOutput(id) {
  const f = files.get(id); if (!f || !f.compressed) return;
  const oe = document.getElementById('outEmpty');
  if (oe) oe.style.display = 'none';
  const oc = document.getElementById('outCode');
  if (oc) { oc.value = f.compressed; oc.style.display = 'block'; }
  const sb = document.getElementById('statsBar');
  if (sb) sb.style.display = 'block';
  const saved = f.tokenIn - f.tokenOut;
  const pct = f.tokenIn > 0 ? Math.round((saved / f.tokenIn) * 100) : 0;
  const sIn = document.getElementById('sIn');
  const sOut = document.getElementById('sOut');
  const sPct = document.getElementById('sPct');
  const sBadge = document.getElementById('savingsBadge');
  if (sIn) sIn.textContent = f.tokenIn.toLocaleString();
  if (sOut) sOut.textContent = f.tokenOut.toLocaleString();
  if (sPct) sPct.textContent = pct + '%';
  if (sBadge) sBadge.textContent = '-' + saved.toLocaleString() + ' tok';
  const gw = Math.min(100, Math.round((f.tokenOut / f.tokenIn) * 100));
  const gf = document.getElementById('gaugeFill');
  if (gf) { gf.style.width = gw + '%'; gf.className = 'gauge-fill ' + (gw < 40 ? 'low' : gw < 70 ? 'mid' : 'high'); }
  const gl = document.getElementById('gaugeLbl');
  if (gl) gl.textContent = `${gw}% of original`;
  const pb = document.getElementById('pseudoBar');
  const pt = document.getElementById('pseudoText');
  if (f.pseudo) { if (pt) pt.textContent = f.pseudo; if (pb) pb.classList.add('show'); }
  else { if (pb) pb.classList.remove('show'); }
  renderCtxMap(f.ctxMap);
  buildDiff(f.content, f.compressed);
  buildPromptView(f);
  buildBundleView();
  const activeTab = document.querySelector('.out-tab.active')?.dataset?.tab || 'compressed';
  switchTabByName(activeTab);
}

function renderCtxMap(ctxMap) {
  const body = document.getElementById('ctxBody');
  const badge = document.getElementById('ctxBadge');
  if (body) body.innerHTML = '';
  if (badge) badge.textContent = ctxMap.length;
  const drawer = document.getElementById('ctxDrawer');
  if (!ctxMap.length) { if (drawer) drawer.classList.remove('open'); return; }
  ctxMap.forEach(i => {
    const d = document.createElement('div'); d.className = 'ctx-item';
    d.innerHTML = `<span class="ctx-from">${escH(i.from)}</span><span class="ctx-arr">→</span><span class="ctx-to">${escH(i.to)}</span>${i.source === 'AI' ? '<span class="ctx-tag">AI</span>' : ''}`;
    if (body) body.appendChild(d);
  });
  if (drawer) drawer.classList.add('open');
  const chev = document.getElementById('ctxChev');
  if (chev) chev.textContent = '▼';
}

function buildDiff(orig, comp) {
  const el = document.getElementById('diffView'); if (!el) return; el.innerHTML = '';
  if (!orig || !comp) return;
  const oLines = orig.split('\n').slice(0, 60);
  const cLines = comp.split('\n').slice(0, 60);
  const beforeLbl = document.createElement('div');
  beforeLbl.className = 'diff-section-label before';
  beforeLbl.textContent = '− Before';
  el.appendChild(beforeLbl);
  for (let i = 0; i < Math.min(oLines.length, 30); i++) {
    const d = document.createElement('div'); d.className = 'diff-line rem';
    d.textContent = '- ' + (oLines[i] || ''); el.appendChild(d);
  }
  const afterLbl = document.createElement('div');
  afterLbl.className = 'diff-section-label after';
  afterLbl.style.marginTop = '12px';
  afterLbl.textContent = '+ After';
  el.appendChild(afterLbl);
  for (let i = 0; i < Math.min(cLines.length, 30); i++) {
    const d = document.createElement('div'); d.className = 'diff-line add';
    d.textContent = '+ ' + (cLines[i] || ''); el.appendChild(d);
  }
  if (oLines.length > 30 || cLines.length > 30) {
    const d = document.createElement('div'); d.className = 'diff-line ctx';
    d.style.marginTop = '8px';
    d.textContent = `… ${orig.split('\n').length} → ${comp.split('\n').length} lines total`; el.appendChild(d);
  }
}

function buildPromptView(f) {
  if (!f) f = files.get(activeFileId); if (!f) return;
  const prefix = document.getElementById('prefixInput').value;
  const mapStr = f.ctxMap.length > 0 ? '\n[CONTEXT MAP]\n' + f.ctxMap.map(i => `${i.to}=${i.from}`).join(', ') : '';
  const pseudoStr = f.pseudo ? '\n[LOGIC SUMMARY]\n' + f.pseudo : '';
  const pv = document.getElementById('promptView');
  if (pv) pv.textContent = `${prefix}${pseudoStr}${mapStr}\n\n[CODE: ${f.name}]\n${f.compressed}`;
}

function buildBundleView() {
  const el = document.getElementById('bundleView'); if (!el) return; el.innerHTML = '';
  const done = [...files.values()].filter(f => f.compressed);
  if (!done.length) { el.innerHTML = '<div style="color:var(--muted);font-size:11px">No files compressed yet</div>'; return; }
  const prefix = document.getElementById('prefixInput').value;
  const header = document.createElement('div');
  header.style.cssText = 'margin-bottom:12px;font-size:11px;color:var(--muted);border-bottom:1px solid var(--border);padding-bottom:8px';
  const totalIn = done.reduce((s, f) => s + f.tokenIn, 0);
  const totalOut = done.reduce((s, f) => s + f.tokenOut, 0);
  header.innerHTML = `${prefix}<br><br><span style="color:var(--accent2)">[${done.length} FILES BUNDLE — ${totalIn.toLocaleString()} → ${totalOut.toLocaleString()} tokens, ${Math.round((1 - totalOut / totalIn) * 100)}% reduction]</span>`;
  el.appendChild(header);
  done.forEach(f => {
    const block = document.createElement('div'); block.className = 'bundle-file-block';
    const allCtx = [...f.ctxMap].map(i => `${i.to}=${i.from}`).join(', ');
    block.innerHTML = `<div class="bundle-file-hdr"><span>${escH(f.name)}</span><span>${f.tokenIn}→${f.tokenOut} tok</span></div>${allCtx ? `<div style="font-size:9px;color:var(--muted);margin-bottom:3px;word-break:break-all">[MAP] ${escH(allCtx)}</div>` : ''}${f.pseudo ? `<div style="font-size:9px;color:var(--text2);font-style:italic;margin-bottom:3px">${escH(f.pseudo)}</div>` : ''}<div class="bundle-file-code">${escH(f.compressed)}</div>`;
    el.appendChild(block);
  });
}

// ─────────────────────────────────────────
//  HISTORY VIEW
// ─────────────────────────────────────────
function buildHistoryView() {
  const el = document.getElementById('historyView'); if (!el) return; el.innerHTML = '';
  if (!compressionHistory.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:11px;text-align:center;padding-top:24px">No compressions yet this session</div>';
    return;
  }
  compressionHistory.forEach((h, idx) => {
    const entry = document.createElement('div'); entry.className = 'hist-entry';
    entry.innerHTML = `
      <div class="hist-hdr" onclick="toggleHistEntry(${idx})">
        <span style="font-size:10px;font-family:var(--mono);color:var(--text2)">${escH(h.fileName)}</span>
        <span class="hist-badge">-${h.reduction}%</span>
        <span style="font-size:9px;color:var(--muted)">${h.tokenIn}→${h.tokenOut} tok</span>
        <span class="hist-ts">${fmtTime(h.ts)}</span>
        <button class="hist-restore-btn" onclick="restoreFromHistory(${idx},event)" title="Restore this output">Restore</button>
      </div>
      <div class="hist-body" id="histBody_${idx}">${escH(h.compressed.slice(0, 400))}${h.compressed.length > 400 ? '\n…' : ''}</div>
    `;
    el.appendChild(entry);
  });
}

function toggleHistEntry(idx) {
  const b = document.getElementById('histBody_' + idx);
  if (b) b.classList.toggle('open');
}

function restoreFromHistory(idx, e) {
  e.stopPropagation();
  const h = compressionHistory[idx];
  const f = files.get(activeFileId);
  if (!f) { showToast('No file selected', 'err'); return; }
  f.compressed = h.compressed; f.ctxMap = h.ctxMap;
  f.tokenOut = h.tokenOut;
  renderOutput(activeFileId);
  switchTabByName('compressed');
  showToast('Restored from history');
}

function rebuildPrompt() {
  const f = files.get(activeFileId); if (f && f.compressed) buildPromptView(f);
  buildBundleView();
  switchTabByName('prompt');
}

// ─────────────────────────────────────────
//  TABS
// ─────────────────────────────────────────
function switchTab(name, el) { switchTabByName(name); }
function switchTabByName(name) {
  document.querySelectorAll('.out-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  const oc = document.getElementById('outCode');
  const dv = document.getElementById('diffView');
  const pv = document.getElementById('promptView');
  const bv = document.getElementById('bundleView');
  const hv = document.getElementById('historyView');
  if (oc) oc.style.display = 'none';
  [dv, pv, bv, hv].forEach(v => { if (v) v.classList.remove('show'); });
  const f = files.get(activeFileId);
  const hasOut = f && f.compressed;
  const oe = document.getElementById('outEmpty');
  if (name === 'compressed') {
    if (hasOut) {
      if (oe) oe.style.display = 'none';
      if (oc) oc.style.display = 'block';
    } else {
      if (oe) oe.style.display = 'flex';
    }
  } else if (name === 'diff') {
    if (oe) oe.style.display = 'none';
    if (hasOut) buildDiff(f.content, f.compressed);
    if (dv) dv.classList.add('show');
  } else if (name === 'prompt') {
    if (oe) oe.style.display = 'none';
    if (hasOut) buildPromptView(f);
    if (pv) pv.classList.add('show');
  } else if (name === 'bundle') {
    if (oe) oe.style.display = 'none';
    if (bv) bv.classList.add('show');
    buildBundleView();
  } else if (name === 'history') {
    if (oe) oe.style.display = 'none';
    if (hv) hv.classList.add('show');
    buildHistoryView();
  }
}

function toggleCtx() {
  const d = document.getElementById('ctxDrawer'); if (d) d.classList.toggle('open');
  const chev = document.getElementById('ctxChev');
  if (chev) chev.textContent = d && d.classList.contains('open') ? '▼' : '▲';
}

// ─────────────────────────────────────────
//  COPY
// ─────────────────────────────────────────
async function copyOutput() {
  const activeTab = document.querySelector('.out-tab.active')?.dataset?.tab || 'compressed';
  let text = '';
  if (activeTab === 'compressed') { const f = files.get(activeFileId); text = f?.compressed || ''; }
  else if (activeTab === 'prompt') { text = document.getElementById('promptView').textContent; }
  else if (activeTab === 'bundle') { text = getBundleText(); }
  else if (activeTab === 'diff') { text = document.getElementById('diffView').textContent; }
  if (!text) { showToast('Nothing to copy', 'err'); return; }
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    showToast('Copy failed: ' + e.message, 'err');
    return;
  }
  const btn = document.getElementById('copyBtn');
  if (btn) { btn.textContent = '✓ Copied!'; btn.classList.add('ok'); }
  setTimeout(() => { if (btn) { btn.textContent = 'Copy'; btn.classList.remove('ok'); } }, 2000);
  showToast('Copied to clipboard');
}

function getBundleText() {
  const done = [...files.values()].filter(f => f.compressed);
  const prefix = document.getElementById('prefixInput').value;
  const totalIn = done.reduce((s, f) => s + f.tokenIn, 0);
  const totalOut = done.reduce((s, f) => s + f.tokenOut, 0);
  let out = `${prefix}\n\n[${done.length} FILES — ${totalIn} → ${totalOut} tokens, ${Math.round((1 - totalOut / totalIn) * 100)}% reduction]\n\n`;
  done.forEach(f => {
    const map = f.ctxMap.map(i => `${i.to}=${i.from}`).join(', ');
    out += `// FILE: ${f.name}\n`;
    if (map) out += `// MAP: ${map}\n`;
    if (f.pseudo) out += `// SUMMARY: ${f.pseudo}\n`;
    out += f.compressed + '\n\n';
  });
  return out;
}

// ─────────────────────────────────────────
//  EXPORT BUNDLE
// ─────────────────────────────────────────
async function exportBundle() {
  const done = [...files.entries()].filter(([, f]) => f.compressed);
  if (!done.length) { showToast('No compressed files to export', 'err'); return; }
  try { await loadJSZip(); } catch (e) { showToast('Failed to load JSZip: ' + e.message, 'err'); return; }
  const zip = new JSZip();
  done.forEach(([, f]) => zip.file(f.name, f.compressed));
  zip.file('_tokencrush_bundle.txt', getBundleText());
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'tokencrush_bundle.zip';
  a.click(); URL.revokeObjectURL(url);
  showToast(`Exported ${done.length} compressed files`);
}

// ─────────────────────────────────────────
//  TOGGLE SETTINGS PERSISTENCE
// ─────────────────────────────────────────
const TOGGLE_KEY = 'tokencrush-toggles';
function saveToggles() {
  const toggles = {};
  ['tglWS', 'tglCmt', 'tglRename', 'tglContextMap', 'tglAutoCompress'].forEach(id => {
    const el = document.getElementById(id);
    if (el) toggles[id] = el.checked;
  });
  try { localStorage.setItem(TOGGLE_KEY, JSON.stringify(toggles)); } catch (e) { }
}
function restoreToggles() {
  let data;
  try { data = JSON.parse(localStorage.getItem(TOGGLE_KEY)); } catch (e) { return; }
  if (!data) return;
  Object.entries(data).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.checked = val;
  });
}

// ─────────────────────────────────────────
//  KEYBOARD SHORTCUTS
// ─────────────────────────────────────────
document.addEventListener('keydown', e => {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && e.key === 'Enter') { e.preventDefault(); compressCurrent(); }
  if (mod && e.key === 'f') { e.preventDefault(); openFindBar(); }
  if (mod && e.key === 's') { e.preventDefault(); compressCurrent(); showToast('Saved & compressed'); }
  if (e.key === 'Escape') { closeFindBar(); }
});

// ─────────────────────────────────────────
//  COMPRESS BUTTON (injected)
// ─────────────────────────────────────────
(function () {
  const hdr = document.querySelector('.editor-header');
  if (!hdr) return;
  const btn = document.createElement('button');
  btn.className = 'btn btn-accent'; btn.textContent = '⚡ Compress'; btn.style.flexShrink = '0';
  btn.onclick = compressCurrent;
  hdr.appendChild(btn);
})();

// ─────────────────────────────────────────
//  RESIZABLE PANELS
// ─────────────────────────────────────────
(function () {
  function makeResizable(handleId, leftEl, rightEl, minLeft, minRight) {
    const handle = document.getElementById(handleId);
    if (!handle || !leftEl || !rightEl) return;
    let dragging = false, startX = 0, startLeft = 0, startRight = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true; startX = e.clientX;
      startLeft = leftEl.offsetWidth; startRight = rightEl.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const nl = Math.max(minLeft, startLeft + dx);
      const nr = Math.max(minRight, startRight - dx);
      leftEl.style.width = nl + 'px'; leftEl.style.flex = 'none';
      rightEl.style.width = nr + 'px'; rightEl.style.flex = 'none';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; handle.classList.remove('dragging');
      document.body.style.userSelect = ''; document.body.style.cursor = '';
    });
    handle.addEventListener('dblclick', () => {
      leftEl.style.width = ''; leftEl.style.flex = '';
      rightEl.style.width = ''; rightEl.style.flex = '';
    });
  }
  const sidebar = document.querySelector('.sidebar');
  const editorPanel = document.getElementById('editorPanel');
  const outputPanel = document.getElementById('outputPanel');
  makeResizable('rh1', sidebar, editorPanel, 140, 200);
  makeResizable('rh2', editorPanel, outputPanel, 200, 200);
})();

// ─────────────────────────────────────────
//  EXAMPLE
// ─────────────────────────────────────────
function loadExample() {
  const exFiles = [
    { name: 'auth.service.ts', content: `// Authentication Service - handles JWT tokens and user sessions
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { UserRepository } from './repositories/userRepository';
import { TokenBlacklist } from './utils/tokenBlacklist';
import { Logger } from './utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
const TOKEN_EXPIRY = process.env.TOKEN_EXPIRY || '24h';
const SALT_ROUNDS = 12;

export class AuthenticationService {
  private userRepository: UserRepository;
  private tokenBlacklist: TokenBlacklist;
  private logger: Logger;

  constructor(userRepository: UserRepository, tokenBlacklist: TokenBlacklist, logger: Logger) {
    this.userRepository = userRepository;
    this.tokenBlacklist = tokenBlacklist;
    this.logger = logger;
  }

  async authenticateUser(emailAddress: string, plainTextPassword: string): Promise<AuthResult> {
    try {
      const foundUser = await this.userRepository.findByEmail(emailAddress);
      if (!foundUser) {
        this.logger.warn('Login failed: user not found', { email: emailAddress });
        throw new Error('Invalid credentials');
      }
      const passwordIsValid = await bcrypt.compare(plainTextPassword, foundUser.passwordHash);
      if (!passwordIsValid) {
        this.logger.warn('Login failed: wrong password', { userId: foundUser.id });
        throw new Error('Invalid credentials');
      }
      const accessToken = jwt.sign({ userId: foundUser.id, role: foundUser.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
      return { accessToken, user: { id: foundUser.id, email: foundUser.email, role: foundUser.role } };
    } catch (error) {
      if (error.message !== 'Invalid credentials') this.logger.error('Auth error', { error });
      throw error;
    }
  }
}` },
    { name: 'api.utils.js', content: `// Utility functions for API request handling
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_RETRIES = 3;
const RATE_LIMIT_DELAY = 1000;

async function makeApiRequest(endpoint, options = {}, maxRetries = DEFAULT_RETRIES) {
  const requestOptions = {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(options.timeout || DEFAULT_TIMEOUT)
  };
  let lastError;
  for (let attemptNumber = 0; attemptNumber < maxRetries; attemptNumber++) {
    try {
      const apiResponse = await fetch(endpoint, requestOptions);
      if (!apiResponse.ok) {
        if (apiResponse.status === 429) {
          const retryAfter = apiResponse.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : RATE_LIMIT_DELAY * Math.pow(2, attemptNumber);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        throw new Error(\`HTTP \${apiResponse.status}: \${apiResponse.statusText}\`);
      }
      const responseData = await apiResponse.json();
      return { success: true, data: responseData.data || responseData, timestamp: new Date().toISOString() };
    } catch (requestError) {
      lastError = requestError;
      if (attemptNumber < maxRetries - 1) await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY * (attemptNumber + 1)));
    }
  }
  throw lastError;
}

export { makeApiRequest };` }
  ];
  clearAll();
  exFiles.forEach(f => addFile(f.name, f.content));
  showToast('Example files loaded — try Compress All!');
}

function clearAll() {
  files.clear(); activeFileId = null;
  renderFileList(); showEditorEmpty(); showOutEmpty(); updateFileCount(); updateGlobalStats();
}

// ─────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────
applyTheme(document.documentElement.getAttribute('data-theme') || 'dark');
restoreToggles();
updateFileCount();

// Persist toggle changes
['tglWS', 'tglCmt', 'tglRename', 'tglContextMap', 'tglAutoCompress'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', saveToggles);
});

// ─────────────────────────────────────────
//  ACCESSIBILITY: output tabs
// ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.out-tab').forEach(t => {
    t.setAttribute('role', 'tab');
    t.setAttribute('aria-selected', t.classList.contains('active') ? 'true' : 'false');
    t.tabIndex = 0;
    t.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const tabName = t.dataset.tab;
        if (tabName) switchTabByName(tabName);
      }
    });
  });
});
