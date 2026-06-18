import { state } from '../core/state.js';
import { estTok } from '../core/helpers.js';

export function renderOutput(id) {
  const f = state.files.get(id);
  if (!f || !f.compressed) {
    showOutEmpty();
    return;
  }

  const oe = document.getElementById('outEmpty');
  const oc = document.getElementById('outCode');
  const sb = document.getElementById('statsBar');
  const ofn = document.getElementById('outFilename');

  if (oe) oe.style.display = 'none';
  if (oc) { oc.classList.remove('hidden'); oc.value = f.compressed; oc.style.display = 'block'; }
  if (sb) sb.style.display = 'block';
  if (ofn) { ofn.textContent = f.name; ofn.title = f.name; }

  const saved = f.tokenIn - f.tokenOut;
  const pct = f.tokenIn > 0 ? Math.round((saved / f.tokenIn) * 100) : 0;

  const sIn = document.getElementById('sIn');
  const sOut = document.getElementById('sOut');
  const sPct = document.getElementById('sPct');
  const sBadge = document.getElementById('savingsBadge');

  if (sIn) sIn.textContent = f.tokenIn.toLocaleString();
  if (sOut) sOut.textContent = f.tokenOut.toLocaleString();
  if (sPct) sPct.textContent = pct + '%';
  if (sBadge) sBadge.textContent = '-' + saved.toLocaleString();

  updateGauge(f.tokenIn);
  renderCtxMap(f.ctxMap);
  buildDiff(f.content, f.compressed);
  buildPromptView(f);
}

export function showOutEmpty() {
  const oe = document.getElementById('outEmpty');
  const oc = document.getElementById('outCode');
  const sb = document.getElementById('statsBar');

  if (oe) oe.style.display = 'flex';
  if (oc) { oc.classList.add('hidden'); oc.style.display = 'none'; }
  if (sb) sb.style.display = 'none';

  const pseudo = document.getElementById('pseudoBar');
  const ctx = document.getElementById('ctxDrawer');
  if (pseudo) pseudo.classList.remove('show');
  if (ctx) ctx.classList.remove('open');

  setProgress(0);
}

export function updateGauge(tokens) {
  const ctx = 200000;
  const pct = Math.min(100, Math.round((tokens / ctx) * 100));
  const fill = document.getElementById('gaugeFill');
  const lbl = document.getElementById('gaugeLbl');
  const pctEl = document.getElementById('gaugePct');
  if (fill) { fill.style.width = pct + '%'; fill.className = 'gauge-fill' + (pct > 80 ? ' high' : pct > 50 ? ' mid' : ' low'); }
  if (lbl) lbl.textContent = 'Tokens used';
  if (pctEl) pctEl.textContent = pct + '%';
}

export function renderCtxMap(ctxMap) {
  const body = document.getElementById('ctxBody');
  const badge = document.getElementById('ctxBadge');
  const tabView = document.getElementById('contextView');

  const emptyHtml = '<div class="ctx-empty" style="padding:20px;text-align:center;color:var(--muted);font-size:12px">No identifier mappings</div>';

  if (!ctxMap || ctxMap.length === 0) {
    if (body) body.innerHTML = emptyHtml;
    if (badge) badge.textContent = '0';
    if (tabView) tabView.innerHTML = emptyHtml;
    return;
  }

  if (badge) badge.textContent = ctxMap.length;

  let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px;padding:14px">';
  for (const entry of ctxMap) {
    html += `<div class="ctx-item">
      <span class="ctx-from">${escH(entry.from)}</span>
      <span class="ctx-arrow">→</span>
      <span class="ctx-to">${escH(entry.to)}</span>
      <span class="ctx-count">(${entry.count})</span>
    </div>`;
  }
  html += '</div>';

  if (body) body.innerHTML = html;
  if (tabView) tabView.innerHTML = html;
}

function escH(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildDiff(orig, comp) {
  const diffView = document.getElementById('diffView');
  if (!diffView) return;

  if (!orig || !comp) {
    diffView.innerHTML = '<div class="diff-empty" style="padding:20px;text-align:center;color:var(--muted);font-size:12px">Compress the file first to see the diff</div>';
    return;
  }

  const origLines = orig.split('\n').slice(0, 30);
  const compLines = comp.split('\n').slice(0, 30);

  let html = '<div class="diff-container">';
  html += '<div class="diff-col diff-orig"><div class="diff-header">Original</div>';
  for (let i = 0; i < origLines.length; i++) {
    html += `<div class="diff-line del"><span class="diff-num">${i + 1}</span>${escH(origLines[i])}</div>`;
  }
  html += '</div>';

  html += '<div class="diff-col diff-comp"><div class="diff-header">Compressed</div>';
  for (let i = 0; i < compLines.length; i++) {
    html += `<div class="diff-line add"><span class="diff-num">${i + 1}</span>${escH(compLines[i])}</div>`;
  }
  html += '</div></div>';

  diffView.innerHTML = html;
}

export function buildPromptView(f) {
  const promptView = document.getElementById('promptView');
  if (!promptView) return;

  if (!f.compressed) {
    promptView.innerHTML = '<div class="prompt-empty" style="padding:20px;text-align:center;color:var(--muted)">Compress the file first to see the prompt</div>';
    return;
  }

  const prefix = document.getElementById('prefixInput')?.value || '';
  let prompt = prefix + '\n\n';

  if (f.pseudo) {
    prompt += 'Logic summary: ' + f.pseudo + '\n\n';
  }

  if (f.ctxMap && f.ctxMap.length > 0) {
    prompt += 'Identifier mappings:\n';
    for (const entry of f.ctxMap) {
      prompt += `${entry.from} → ${entry.to}\n`;
    }
    prompt += '\n';
  }

  prompt += f.compressed;

  promptView.innerHTML = `<div class="prompt-content"><pre>${escH(prompt)}</pre></div>`;
}

export function buildBundleView() {
  const bundleView = document.getElementById('bundleView');
  if (!bundleView) return;

  const compressed = [...state.files.entries()].filter(([, f]) => f.compressed);
  if (compressed.length === 0) {
    bundleView.innerHTML = '<div class="bundle-empty">No files compressed yet</div>';
    return;
  }

  let html = '<div class="bundle-content">';
  let totalIn = 0, totalOut = 0;

  for (const [id, f] of compressed) {
    totalIn += f.tokenIn;
    totalOut += f.tokenOut;
    const saved = f.tokenIn - f.tokenOut;
    const pct = f.tokenIn > 0 ? Math.round((saved / f.tokenIn) * 100) : 0;

    html += `<div class="bundle-file">
      <div class="bundle-file-header">
        <span class="bundle-fname">${escH(f.name)}</span>
        <span class="bundle-stats">${f.tokenIn} → ${f.tokenOut} tokens (${pct}% saved)</span>
      </div>
      <pre class="bundle-code">${escH(f.compressed)}</pre>
    </div>`;
  }

  const totalSaved = totalIn - totalOut;
  const totalPct = totalIn > 0 ? Math.round((totalSaved / totalIn) * 100) : 0;
  html += `<div class="bundle-summary">
    Total: ${totalIn.toLocaleString()} → ${totalOut.toLocaleString()} tokens (${totalPct}% saved)
  </div></div>`;

  bundleView.innerHTML = html;
}

export function buildHistoryView() {
  const historyView = document.getElementById('historyView');
  if (!historyView) return;

  if (state.compressionHistory.length === 0) {
    historyView.innerHTML = '<div class="history-empty">No compression history</div>';
    return;
  }

  let html = '<div class="history-list">';
  for (let i = state.compressionHistory.length - 1; i >= 0; i--) {
    const entry = state.compressionHistory[i];
    const saved = entry.tokenIn - entry.tokenOut;
    const pct = entry.tokenIn > 0 ? Math.round((saved / entry.tokenIn) * 100) : 0;
    const time = new Date(entry.timestamp).toLocaleTimeString();

    html += `<div class="history-entry">
      <div class="history-header">
        <span class="history-name">${escH(entry.name)}</span>
        <span class="history-time">${time}</span>
      </div>
      <div class="history-stats">
        ${entry.tokenIn} → ${entry.tokenOut} tokens (${pct}% saved)
      </div>
    </div>`;
  }
  html += '</div>';

  historyView.innerHTML = html;
}

export function setProgress(pct) {
  const fill = document.getElementById('progressFill');
  if (fill) fill.style.width = pct + '%';
}

export function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`)?.classList.add('active');

  const chatPanel = document.getElementById('chatPanel');
  const outEmpty = document.getElementById('outEmpty');
  const outCode = document.getElementById('outCode');

  const ctxDrawer = document.getElementById('ctxDrawer');
  const pseudoBar = document.getElementById('pseudoBar');

  if (outEmpty) outEmpty.style.display = 'none';
  if (outCode) { outCode.classList.add('hidden'); outCode.style.display = 'none'; }
  if (chatPanel) chatPanel.classList.add('hidden');
  if (ctxDrawer && name !== 'context') ctxDrawer.classList.remove('open');
  if (pseudoBar && name !== 'compressed') pseudoBar.classList.remove('show');
  document.querySelectorAll('.diff-view,.prompt-view,.context-view,.bundle-view,.history-view,.allstats-view').forEach(d => d.classList.remove('show'));

  if (name === 'chat') {
    if (chatPanel) chatPanel.classList.remove('hidden');
    const messages = document.getElementById('chatMessages');
    if (messages) messages.scrollTop = messages.scrollHeight;
    return;
  }

  const activeFileId = state.activeFileId;
  const f = activeFileId ? state.files.get(activeFileId) : null;

  if (name === 'compressed') {
    if (f && f.compressed) {
      if (outCode) { outCode.classList.remove('hidden'); outCode.value = f.compressed; outCode.style.display = 'block'; }
    } else {
      if (outEmpty) outEmpty.style.display = 'flex';
    }
    if (pseudoBar) pseudoBar.classList.add('show');
    return;
  }

  const tabMap = {
    diff: 'diffView',
    prompt: 'promptView',
    context: 'contextView',
    bundle: 'bundleView',
    history: 'historyView',
    allstats: 'allstatsView'
  };
  const target = document.getElementById(tabMap[name]);
  if (target) target.classList.add('show');

  if (name === 'diff') {
    buildDiff(f ? f.content : null, f ? f.compressed : null);
  }
  if (name === 'prompt' && f) {
    buildPromptView(f);
  }
  if (name === 'context' && f) {
    renderCtxMap(f.ctxMap);
  }
  if (name === 'bundle') buildBundleView();
  if (name === 'history') buildHistoryView();
}

export function toggleCtx() {
  const drawer = document.getElementById('ctxDrawer');
  if (drawer) drawer.classList.toggle('open');
}

export function copyOutput() {
  const activeTab = document.querySelector('.tab.active')?.dataset.tab || 'compressed';
  let text = '';

  switch (activeTab) {
    case 'compressed':
      text = document.getElementById('outCode')?.value || '';
      break;
    case 'prompt':
      text = document.querySelector('.prompt-content pre')?.textContent || '';
      break;
    case 'bundle':
      text = getBundleText();
      break;
    case 'diff':
      text = document.querySelector('.diff-container')?.textContent || '';
      break;
  }

  if (text) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('Copied to clipboard');
    }).catch(() => {
      showToast('Failed to copy', 'err');
    });
  }
}

export function getBundleText() {
  const compressed = [...state.files.entries()].filter(([, f]) => f.compressed);
  let text = '';

  for (const [, f] of compressed) {
    text += `// === ${f.name} ===\n`;
    text += f.compressed + '\n\n';
  }

  return text;
}

export function showToast(msg, type = 'ok', dur = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show ' + (type === 'ok' ? 'ok' : 'err');
  setTimeout(() => t.className = 'toast', dur);
}

export function exportBundle() {
  const compressed = [...state.files.entries()].filter(([, f]) => f.compressed);
  if (compressed.length === 0) {
    showToast('No files to export', 'err');
    return;
  }

  let text = getBundleText();
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'tokencrush_bundle.txt';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Bundle exported');
}

export function rebuildPrompt() {
  const activeFileId = state.activeFileId;
  const f = activeFileId ? state.files.get(activeFileId) : null;
  if (!f || !f.compressed) {
    showToast('Compress a file first', 'err');
    return;
  }
  buildPromptView(f);
  switchTab('prompt');
  showToast('Prompt rebuilt');
}
