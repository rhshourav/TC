import { state } from '../core/state.js';
import { estTok } from '../core/helpers.js';
import { getLanguage, getLangBadgeClass } from '../languages/index.js';
import { CLAUDE_CTX, AUTO_COMPRESS_DELAY } from '../core/config.js';

let _onFileSelect = null;
let _onRenderOutput = null;
export function onFileSelect(cb) { _onFileSelect = cb; }
export function onRenderOutput(cb) { _onRenderOutput = cb; }

export function selectFile(id) {
  const f = state.files.get(id);
  if (!f) return;

  const ee = document.getElementById('editorEmpty');
  const ed = document.getElementById('codeEditor');
  const ef = document.getElementById('editorFilename');
  const lb = document.getElementById('langBadge');
  const pill = document.getElementById('editorTokenPill');

  if (ee) ee.style.display = 'none';
  if (ed) { ed.style.display = 'block'; ed.value = f.content; }
  if (ef) ef.textContent = f.name;

  const lang = getLanguage(f.name);
  if (lb && lang) {
    lb.textContent = lang.name.toUpperCase();
    lb.className = 'lang-badge ' + lang.badgeClass;
  }

  if (pill) {
    const tok = estTok(f.content);
    pill.textContent = tok + ' tokens';
    updateTokenPill(tok);
  }

  updateEditorMeta();
  updateBudgetBar();

  if (_onFileSelect) _onFileSelect(f);
  if (_onRenderOutput) _onRenderOutput(id);
}

export function showEditorEmpty() {
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

  const pill = document.getElementById('editorTokenPill');
  if (pill) pill.textContent = '0 tokens';
}

export function updateEditorMeta() {
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

export function updateTokenPill(tok) {
  const pill = document.getElementById('editorTokenPill');
  if (!pill) return;
  const pct = (tok / CLAUDE_CTX) * 100;
  pill.className = 'token-pill' + (pct > 80 ? ' danger' : pct > 50 ? ' warn' : '');
}

export function updateBudgetBar() {
  if (!state.activeFileId) return;
  const f = state.files.get(state.activeFileId);
  if (!f) return;
  const tok = estTok(f.content);
  const pct = Math.min(100, Math.round((tok / CLAUDE_CTX) * 100));
  const fill = document.getElementById('budgetBarFill');
  const wrap = document.getElementById('budgetBarWrap');
  if (fill) { fill.style.width = pct + '%'; fill.className = 'budget-bar-fill' + (pct > 80 ? ' warn' : ''); }
  if (wrap) wrap.title = `${tok.toLocaleString()} / ${CLAUDE_CTX.toLocaleString()} tokens (${pct}% of Claude context)`;
}

export function onEditorInput() {
  if (!state.activeFileId) return;
  const f = state.files.get(state.activeFileId);
  const ed = document.getElementById('codeEditor');
  if (!f || !ed) return;

  f.content = ed.value;
  f.compressed = null;
  f.ctxMap = [];
  f.pseudo = '';

  const tok = estTok(f.content);
  const pill = document.getElementById('editorTokenPill');
  if (pill) pill.textContent = tok + ' tokens';
  updateTokenPill(tok);
  updateBudgetBar();
  updateEditorMeta();

  // Debounced auto-compress — uses AUTO_COMPRESS_DELAY from config
  if (document.getElementById('tglAutoCompress')?.checked) {
    if (state.autoCompressTimer !== null) clearTimeout(state.autoCompressTimer);
    state.autoCompressTimer = setTimeout(() => {
      state.autoCompressTimer = null;
      if (state.activeFileId) {
        // Import lazily to avoid circular deps at module load time
        import('../core/engine.js').then(({ compressFileById }) => {
          compressFileById(state.activeFileId);
          // Trigger output re-render via the registered callback
          if (_onRenderOutput) _onRenderOutput(state.activeFileId);
        });
      }
    }, AUTO_COMPRESS_DELAY);
  }
}
