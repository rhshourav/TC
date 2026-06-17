import './languages/index.js';
import './passes/index.js';
import { state } from './core/state.js';
import { estTok } from './core/helpers.js';
import { addFile, addFolder, clearAll, compressFileById, compressAllFiles } from './core/engine.js';
import { getLanguage, isCompressible, getLangBadgeClass } from './languages/index.js';
import { renderFileList, updateFileCount, filterFiles } from './ui/sidebar.js';
import { selectFile, showEditorEmpty, updateEditorMeta, onEditorInput, updateBudgetBar, onFileSelect } from './ui/editor.js';
import { renderOutput, showOutEmpty, switchTab, setProgress, copyOutput, exportBundle, showToast, buildBundleView, buildHistoryView, toggleCtx } from './ui/output.js';
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
  let added = 0;
  for (const file of fileList) {
    if (file.name.endsWith('.zip')) {
      handleZip(file, parentFolderId);
      continue;
    }
    if (!isCompressible(file.name)) continue;

    const reader = new FileReader();
    reader.onload = (e) => {
      addFile(file.name, e.target.result, parentFolderId);
      added++;
      renderFileList();
      updateFileCount();
    };
    reader.readAsText(file);
  }
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
  for (const item of items) {
    if (item.kind === 'file') {
      entries.push(item.webkitGetAsEntry ? item.webkitGetAsEntry() : item.getAsEntry());
    }
  }
  processEntries(entries);
}

async function processEntries(entries) {
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) {
      await processDirectory(entry);
    } else {
      const file = entry.file ? entry.file() : null;
      if (file) handleFiles([file]);
    }
  }
}

async function processDirectory(entry, parentId = null) {
  const folderId = addFolder(entry.name, parentId);
  renderFileList();

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
      });
    };
    readBatch();
  });

  for (const child of entries) {
    if (child.isDirectory) {
      await processDirectory(child, folderId);
    } else {
      const file = child.file ? child.file() : null;
      if (file) handleFiles([file], folderId);
    }
  }
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
  document.querySelectorAll('.spill').forEach(s => s.classList.remove('active'));
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
      if (state.activeFileId) compressFileById(state.activeFileId);
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

  document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    if (overlay) overlay.classList.remove('show');

    const dt = e.dataTransfer;
    let count = 0;

    if (dt.items && dt.items.length > 0) {
      const entries = [];
      let allNull = true;
      for (const item of dt.items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry) { entries.push(entry); allNull = false; }
        }
      }
      if (entries.length > 0) {
        processEntries(entries);
        count = dt.items.length;
      } else if (dt.files && dt.files.length > 0) {
        handleFiles(dt.files);
        count = dt.files.length;
      }
    } else if (dt.files && dt.files.length > 0) {
      handleFiles(dt.files);
      count = dt.files.length;
    }

    if (count > 0) {
      showToast(`Processing ${count} item${count > 1 ? 's' : ''}...`);
    } else {
      showToast('No supported files found', 'err');
    }
  });
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
  document.querySelectorAll('.out-tab').forEach(tab => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', tab.classList.contains('active'));
    tab.addEventListener('click', () => {
      document.querySelectorAll('.out-tab').forEach(t => t.setAttribute('aria-selected', 'false'));
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
    buildBundleView();
    switchTab('bundle');
    showToast('All files compressed');
  };

  window.onDragOver = (e, id) => { e.preventDefault(); document.getElementById(id)?.classList.add('drag-over'); };
  window.onDragLeave = (id) => { document.getElementById(id)?.classList.remove('drag-over'); };
  window.onDrop = (e, id) => {
    e.preventDefault();
    document.getElementById(id)?.classList.remove('drag-over');
    const dt = e.dataTransfer;
    if (dt.items && dt.items.length > 0) {
      handleDataTransferItems(dt.items);
    } else {
      handleFiles(dt.files);
    }
  };

  window.chatSend = chatSend;
  window.chatKeydown = chatKeydown;
  window.chatDownloadModel = chatDownloadModel;
  window.chatClear = chatClear;
  window.chatClearContext = chatClearContext;
  window.chatGenReadme = chatGenReadme;

  renderFileList();
  updateFileCount();
});
