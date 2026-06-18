import './languages/index.js';
import './passes/index.js';
import { state } from './core/state.js';
import { estTok } from './core/helpers.js';
import { addFile, addFolder, clearAll, compressFileById, compressAllFiles } from './core/engine.js';
import { getLanguage, isCompressible, getLangBadgeClass } from './languages/index.js';
import { renderFileList, updateFileCount, filterFiles } from './ui/sidebar.js';
import { selectFile, showEditorEmpty, updateEditorMeta, onEditorInput, updateBudgetBar, onFileSelect, onRenderOutput } from './ui/editor.js';
import { renderOutput, showOutEmpty, switchTab, setProgress, copyOutput, exportBundle, showToast, buildBundleView, buildHistoryView, toggleCtx, rebuildPrompt } from './ui/output.js';
import { initTheme, toggleTheme } from './ui/theme.js';
import { openFindBar, closeFindBar, doFind, findNext, findPrev, doReplace, doReplaceAll } from './ui/find.js';
import { initChat, chatSend, chatKeydown, chatDownloadModel, chatClear, chatClearContext, chatGenReadme, setChatContext } from './ui/chat.js';
import { initStats, trackFileCompressed } from './ui/stats.js';

window.selectFile = selectFile;
window.showEditorEmpty = showEditorEmpty;
window.showOutEmpty = showOutEmpty;
window.renderFileList = renderFileList;
window.updateFileCount = updateFileCount;
window.filterFiles = filterFiles;
window.compressFileById = compressFileById;
window.compressAllFiles = compressAllFiles;
window.clearAll = clearAll;
window.switchTab = switchTab;
window.copyOutput = copyOutput;
window.exportBundle = exportBundle;
window.showToast = showToast;
window.toggleCtx = toggleCtx;
window.toggleTheme = toggleTheme;
window.openFindBar = openFindBar;
window.closeFindBar = closeFindBar;
window.doFind = doFind;
window.findNext = findNext;
window.findPrev = findPrev;
window.doReplace = doReplace;
window.doReplaceAll = doReplaceAll;
window.onEditorInput = onEditorInput;

function handleFiles(fileList, parentFolderId = null) {
  const promises = [];
  let added = 0;
  let skipped = 0;
  for (let i = 0; i < fileList.length; i++) {
    const file = fileList[i];
    if (!file) continue;
    if (file.name && file.name.endsWith('.zip')) {
      promises.push(handleZip(file, parentFolderId));
      added++;
      continue;
    }
    if (!isCompressible(file.name)) { skipped++; continue; }

    added++;
    const p = new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = (e) => {
          addFile(file.name, e.target.result, parentFolderId);
          renderFileList();
          updateFileCount();
          resolve();
        };
        reader.onerror = () => resolve();
        reader.readAsText(file);
      } catch (e) {
        console.warn('FileReader error', e);
        resolve();
      }
    });
    promises.push(p);
  }
  return Promise.all(promises).then(() => ({ added, skipped }));
}

async function handleZip(file, parentFolderId) {
  try {
    const JSZip = window.JSZip || await loadJSZip();
    const zip = await JSZip.loadAsync(file);

    const folders = new Set();
    const filesList = [];

    zip.forEach((relativePath, zipEntry) => {
      if (zipEntry.dir) return;
      const parts = relativePath.split('/');
      if (parts.length > 1) {
        for (let i = 0; i < parts.length - 1; i++) {
          folders.add(parts.slice(0, i + 1).join('/'));
        }
      }
      filesList.push({ path: relativePath, entry: zipEntry });
    });

    const folderMap = new Map();
    for (const folderPath of [...folders].sort()) {
      const parts = folderPath.split('/');
      const name = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const parentId = folderMap.get(parentPath) || parentFolderId;
      const id = addFolder(name, parentId);
      folderMap.set(folderPath, id);
    }

    for (const { path, entry } of filesList) {
      if (!isCompressible(path)) continue;
      const content = await entry.async('text');
      const parts = path.split('/');
      const folderPath = parts.length > 1 ? parts.slice(0, -1).join('/') : null;
      const folderId = folderMap.get(folderPath) || parentFolderId;
      addFile(parts[parts.length - 1], content, folderId);
    }

    renderFileList();
    updateFileCount();
    showToast('ZIP extracted');
  } catch (err) {
    showToast('Failed to extract ZIP: ' + err.message, 'err');
  }
}

async function loadJSZip() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    script.onload = () => resolve(window.JSZip);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function handleDataTransferItems(items) {
  const entries = [];
  const len = items.length;
  for (let i = 0; i < len; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      try {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : item.getAsEntry();
        if (entry) entries.push(entry);
      } catch (e) {
        console.warn('Failed to read dropped entry', e);
      }
    }
  }
  return processEntries(entries);
}

// FileSystemFileEntry.file() is callback-based, NOT a Promise — it must be
// wrapped or `await`/return-value usage silently yields undefined and the
// file is dropped on the floor. This wrapper is the actual fix.
function getEntryFile(entry) {
  return new Promise((resolve) => {
    if (!entry || !entry.file) return resolve(null);
    entry.file(resolve, (err) => {
      console.error('Failed to read dropped file', entry.fullPath || entry.name, err);
      resolve(null);
    });
  });
}

async function processEntries(entries) {
  const stats = { added: 0, skipped: 0 };
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) {
      const r = await processDirectory(entry);
      stats.added += r.added;
      stats.skipped += r.skipped;
    } else {
      const file = await getEntryFile(entry);
      if (file) {
        const r = await handleFiles([file]);
        stats.added += r.added;
        stats.skipped += r.skipped;
      }
    }
  }
  return stats;
}

async function processDirectory(entry, parentId = null) {
  const folderId = addFolder(entry.name, parentId);
  renderFileList();
  const stats = { added: 0, skipped: 0 };

  const reader = entry.createReader();
  const entries = await new Promise((resolve) => {
    const all = [];
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all.push(...batch);
          readBatch();
        }
      }, (err) => {
        console.error('Failed to read directory entries', entry.fullPath || entry.name, err);
        resolve(all);
      });
    };
    readBatch();
  });

  for (const child of entries) {
    if (child.isDirectory) {
      const r = await processDirectory(child, folderId);
      stats.added += r.added;
      stats.skipped += r.skipped;
    } else {
      const file = await getEntryFile(child);
      if (file) {
        const r = await handleFiles([file], folderId);
        stats.added += r.added;
        stats.skipped += r.skipped;
      }
    }
  }
  return stats;
}

function handleFolderInputChange(input) {
  if (!input.files || input.files.length === 0) return;

  const topLevel = new Map();
  for (const file of input.files) {
    const parts = file.webkitRelativePath.split('/');
    const folderName = parts[0];
    if (!topLevel.has(folderName)) {
      topLevel.set(folderName, addFolder(folderName));
    }
  }

  for (const file of input.files) {
    const parts = file.webkitRelativePath.split('/');
    const folderName = parts[0];
    const folderId = topLevel.get(folderName);

    if (parts.length > 2) {
      let currentParent = folderId;
      for (let i = 1; i < parts.length - 1; i++) {
        const subName = parts[i];
        const existing = [...state.folders.entries()].find(([, f]) => f.name === subName && f.parentId === currentParent);
        if (existing) {
          currentParent = existing[0];
        } else {
          currentParent = addFolder(subName, currentParent);
        }
      }
      handleFiles([file], currentParent);
    } else {
      handleFiles([file], folderId);
    }
  }

  renderFileList();
  updateFileCount();
}

function handleFileInputChange(input) {
  handleFiles(input.files);
  input.value = '';
}

function triggerFileInput() {
  document.getElementById('globalFileInput')?.click();
}

function triggerFolderInput() {
  document.getElementById('globalFolderInput')?.click();
}

function updateGlobalStats() {
  const done = [...state.files.values()].filter(f => f.compressed);
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

function setStrategy(strategy, el) {
  state.currentStrategy = strategy;
  document.querySelectorAll('.pill').forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
}

function loadExample() {
  clearAll();
  addFile('auth.service.js', `// Authentication service
class AuthService {
  constructor(config) {
    this.apiUrl = config.apiUrl;
    this.timeout = config.timeout || 5000;
    this.retries = config.retries || 3;
  }

  async login(email, password) {
    try {
      const response = await fetch(\`\${this.apiUrl}/auth/login\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!response.ok) throw new Error('Login failed');
      const data = await response.json();
      localStorage.setItem('token', data.token);
      return data;
    } catch (error) {
      console.error('Login error:', error);
      throw error;
    }
  }

  async logout() {
    localStorage.removeItem('token');
    return fetch(\`\${this.apiUrl}/auth/logout\`, { method: 'POST' });
  }

  isAuthenticated() {
    return !!localStorage.getItem('token');
  }
}`);
  addFile('utils.js', `// Utility functions
export function debounce(fn, delay) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

export function throttle(fn, limit) {
  let inThrottle;
  return function (...args) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

export function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => deepClone(item));
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, deepClone(value)])
  );
}`);
  renderFileList();
  updateFileCount();
  showToast('Example loaded');
}

function initResizablePanels() {
  const rh1 = document.getElementById('rh1');
  const rh2 = document.getElementById('rh2');
  const sidebar = document.querySelector('.sidebar');
  const editor = document.getElementById('editorPanel');
  const output = document.getElementById('outputPanel');

  function makeResizable(handle, leftEl, rightEl) {
    if (!handle || !leftEl || !rightEl) return;
    let startX, startLeftW, startRightW;

    handle.addEventListener('mousedown', (e) => {
      startX = e.clientX;
      startLeftW = leftEl.offsetWidth;
      startRightW = rightEl.offsetWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      const onMove = (e) => {
        const dx = e.clientX - startX;
        const newLeft = Math.max(150, startLeftW + dx);
        const newRight = Math.max(200, startRightW - dx);
        leftEl.style.width = newLeft + 'px';
        rightEl.style.width = newRight + 'px';
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  makeResizable(rh1, sidebar, editor);
  makeResizable(rh2, editor, output);
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (state.activeFileId) {
        compressFileById(state.activeFileId);
        renderOutput(state.activeFileId);
        renderFileList();
        updateFileCount();
        updateGlobalStats();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      openFindBar();
    }
    if (e.key === 'Escape') {
      closeFindBar();
    }
  });
}

function initDragDrop() {
  let dragCounter = 0;
  const overlay = document.getElementById('dragOverlay');

  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    if (dragCounter === 1 && overlay) overlay.classList.add('show');
  });

  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      if (overlay) overlay.classList.remove('show');
    }
  });

  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('drop', async (e) => {
    if (e.target.closest('.drop-zone')) return;

    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    if (overlay) overlay.classList.remove('show');

    const dt = e.dataTransfer;

    let result = null;
    if (dt.items && dt.items.length > 0) {
      showToast(`Loading...`);
      const entries = [];
      for (let i = 0; i < dt.items.length; i++) {
        const item = dt.items[i];
        if (item.kind === 'file') {
          try {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : item.getAsEntry();
            if (entry) entries.push(entry);
          } catch (err) {
            console.warn('getEntry failed', err);
          }
        }
      }
      if (entries.length > 0) {
        result = await processEntries(entries);
      }
    }
    if (!result || (result.added === 0 && result.skipped === 0)) {
      if (dt.files && dt.files.length > 0) {
        const count = dt.files.length;
        showToast(`Loading ${count} file${count > 1 ? 's' : ''}...`);
        result = await handleFiles(dt.files);
      }
    }
    if (result) {
      reportLoadResult(result.added, result.skipped);
    } else {
      showToast('No supported files found', 'err');
    }
  });
}

function reportLoadResult(added, skipped) {
  if (added > 0 && skipped > 0) {
    showToast(`Loaded ${added} file${added > 1 ? 's' : ''} (${skipped} unsupported skipped)`);
  } else if (added > 0) {
    showToast(`Loaded ${added} file${added > 1 ? 's' : ''}`);
  } else {
    showToast('No supported files found in drop', 'err');
  }
}

function initToggles() {
  const saved = localStorage.getItem('tokencrush-toggles');
  if (saved) {
    try {
      const toggles = JSON.parse(saved);
      const tglWS = document.getElementById('tglWS');
      const tglCmt = document.getElementById('tglCmt');
      const tglRename = document.getElementById('tglRename');
      const tglAutoCompress = document.getElementById('tglAutoCompress');
      if (tglWS && toggles.ws !== undefined) tglWS.checked = toggles.ws;
      if (tglCmt && toggles.cmt !== undefined) tglCmt.checked = toggles.cmt;
      if (tglRename && toggles.rename !== undefined) tglRename.checked = toggles.rename;
      if (tglAutoCompress && toggles.autoCompress !== undefined) tglAutoCompress.checked = toggles.autoCompress;
    } catch (e) {}
  }

  ['tglWS', 'tglCmt', 'tglRename', 'tglAutoCompress'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', saveToggles);
  });
}

function saveToggles() {
  const toggles = {
    ws: document.getElementById('tglWS')?.checked,
    cmt: document.getElementById('tglCmt')?.checked,
    rename: document.getElementById('tglRename')?.checked,
    autoCompress: document.getElementById('tglAutoCompress')?.checked
  };
  localStorage.setItem('tokencrush-toggles', JSON.stringify(toggles));
}

function initAccessibility() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', tab.classList.contains('active'));
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initToggles();
  initResizablePanels();
  initKeyboardShortcuts();
  initDragDrop();
  initAccessibility();
  initChat();
  initStats();
  onFileSelect(setChatContext);
  onRenderOutput((id) => {
    const f = state.files.get(id);
    if (f && !f.compressed && document.getElementById('tglAutoCompress')?.checked) {
      compressFileById(id);
      renderFileList();
      updateFileCount();
    }
    renderOutput(id);
  });

  // Responsive sidebar toggle
  function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (sidebar && overlay) {
      const isOpen = sidebar.classList.toggle('open');
      overlay.classList.toggle('show', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    }
  }
  window.toggleSidebar = toggleSidebar;

  const themeBtn = document.getElementById('themeToggle');
  if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

  const ta = document.getElementById('codeEditor');
  if (ta) {
    ta.addEventListener('input', onEditorInput);
    ta.addEventListener('click', updateEditorMeta);
    ta.addEventListener('keyup', updateEditorMeta);
  }

  window.triggerFileInput = triggerFileInput;
  window.triggerFolderInput = triggerFolderInput;
  window.handleFileInputChange = handleFileInputChange;
  window.handleFolderInputChange = handleFolderInputChange;
  window.handleFiles = handleFiles;
  window.handleDataTransferItems = handleDataTransferItems;
  window.setStrategy = setStrategy;
  window.loadExample = loadExample;
  window.clearAll = () => { clearAll(); renderFileList(); updateFileCount(); showEditorEmpty(); showOutEmpty(); };
  window.compressAll = async () => {
    const entries = [...state.files.entries()];
    if (entries.length === 0) return;
    let count = 0;
    for (const [id, f] of entries) {
      compressFileById(id);
      count++;
    }
    trackFileCompressed(count);
    renderFileList();
    updateFileCount();
    updateGlobalStats();
    const firstId = entries[0][0];
    state.activeFileId = firstId;
    renderOutput(firstId);
    renderFileList();
    showToast('All files compressed');
  };

  window.onDragOver = (e, id) => { e.preventDefault(); document.getElementById(id)?.classList.add('drag-over'); };
  window.onDragLeave = (id) => { document.getElementById(id)?.classList.remove('drag-over'); };
  window.onDrop = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    document.getElementById(id)?.classList.remove('drag-over');
    const dt = e.dataTransfer;

    let result = null;
    if (dt.items && dt.items.length > 0) {
      showToast(`Loading...`);
      result = await handleDataTransferItems(dt.items);
    }
    if (!result || (result.added === 0 && result.skipped === 0)) {
      if (dt.files && dt.files.length > 0) {
        const count = dt.files.length;
        showToast(`Loading ${count} file${count > 1 ? 's' : ''}...`);
        result = await handleFiles(dt.files);
      }
    }
    if (result) {
      reportLoadResult(result.added, result.skipped);
    } else {
      showToast('No supported files found', 'err');
    }
  };

  window.chatSend = chatSend;
  window.chatKeydown = chatKeydown;
  window.chatDownloadModel = chatDownloadModel;
  window.chatClear = chatClear;
  window.chatClearContext = chatClearContext;
  window.chatGenReadme = chatGenReadme;
window.rebuildPrompt = rebuildPrompt;

  renderFileList();
  updateFileCount();
});
