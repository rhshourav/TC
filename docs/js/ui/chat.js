import { state } from '../core/state.js';
import { escH } from '../core/helpers.js';

let generator = null;
let modelReady = false;
let isLoading = false;
let currentFile = null;
let conversation = [];

function $(id) { return document.getElementById(id); }

function checkRequirements() {
  const issues = [];
  const warnings = [];

  // Check WebGPU support
  if (!navigator.gpu) {
    issues.push('WebGPU is not supported in your browser');
  }

  // Check available memory
  const minMemoryMB = 800;
  let availableMemoryMB = null;

  if (navigator.deviceMemory) {
    availableMemoryMB = navigator.deviceMemory * 1024;
  } else if (performance && performance.memory) {
    availableMemoryMB = performance.memory.jsHeapSizeLimit / (1024 * 1024);
  }

  if (availableMemoryMB !== null) {
    const freeMemoryMB = availableMemoryMB * 0.25;
    if (freeMemoryMB < minMemoryMB) {
      warnings.push(`Low memory: ~${Math.round(freeMemoryMB)}MB available, ~${minMemoryMB}MB recommended`);
    }
  }

  // Check browser
  const ua = navigator.userAgent;
  const isChrome = /Chrome\/(\d+)/.test(ua) && !/Edg\//.test(ua);
  const isEdge = /Edg\//.test(ua);
  const isFirefox = /Firefox\//.test(ua);

  if (!isChrome && !isEdge && !isFirefox) {
    warnings.push('Browser may not fully support WebGPU');
  }

  return { issues, warnings };
}

function showRequirementsWarning(warnings) {
  if (warnings.length === 0) return true;

  const msg = 'Warnings:\n• ' + warnings.join('\n• ') + '\n\nContinue anyway?';
  return confirm(msg);
}

export function initChat() {
  const input = $('chatInput');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
  }

  updateRequirementsUI();
}

function updateRequirementsUI() {
  const webgpuEl = $('reqWebGPU');
  const memoryEl = $('reqMemory');
  if (!webgpuEl || !memoryEl) return;

  const { issues, warnings } = checkRequirements();

  // WebGPU check
  const webgpuOk = !issues.some(i => i.includes('WebGPU'));
  const webgpuIcon = webgpuEl.querySelector('.chat-req-icon');
  const webgpuStatus = webgpuEl.querySelector('.chat-req-status');

  if (webgpuOk) {
    webgpuEl.classList.add('ok');
    webgpuIcon.textContent = '✓';
    webgpuStatus.textContent = 'Supported';
  } else {
    webgpuEl.classList.add('fail');
    webgpuIcon.textContent = '✕';
    webgpuStatus.textContent = 'Not supported';
  }

  // Memory check
  const memoryWarning = warnings.some(w => w.includes('memory'));
  const memoryIcon = memoryEl.querySelector('.chat-req-icon');
  const memoryStatus = memoryEl.querySelector('.chat-req-status');

  if (memoryWarning) {
    memoryEl.classList.add('warn');
    memoryIcon.textContent = '⚠';
    memoryStatus.textContent = 'Low memory';
  } else {
    memoryEl.classList.add('ok');
    memoryIcon.textContent = '✓';
    memoryStatus.textContent = 'Sufficient';
  }

  // Disable download if critical issues
  if (issues.length > 0) {
    const btn = $('chatDownloadBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Cannot load model';
      btn.style.opacity = '.5';
    }
  }
}

export function setChatContext(file) {
  currentFile = file;
  const ctxFile = $('chatCtxFile');
  const ctxBar = $('chatContextBar');
  if (file && ctxFile) {
    ctxFile.textContent = file.name;
    if (ctxBar) ctxBar.classList.add('show');
  } else if (!file && ctxBar) {
    ctxBar.classList.remove('show');
  }
}

export function chatClearContext() {
  currentFile = null;
  const ctxBar = $('chatContextBar');
  if (ctxBar) ctxBar.classList.remove('show');
}

function getSystemPrompt() {
  let base = 'You are a helpful coding assistant. You help developers understand their code. Be concise and direct.';
  if (currentFile) {
    const maxLen = 2000;
    const content = currentFile.content.length > maxLen
      ? currentFile.content.substring(0, maxLen) + '\n... (truncated)'
      : currentFile.content;
    base += `\n\nThe user is currently viewing this file: ${currentFile.name}\n\`\`\`\n${content}\n\`\`\``;
  }
  return base;
}

function formatPrompt(userText) {
  const messages = [{ role: 'system', content: getSystemPrompt() }];
  for (const m of conversation) {
    messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: userText });
  return messages;
}

export async function chatDownloadModel() {
  if (modelReady || isLoading) return;

  const { issues, warnings } = checkRequirements();

  if (issues.length > 0) {
    appendMessage('system', 'Cannot load model:\n• ' + issues.join('\n• '));
    return;
  }

  if (warnings.length > 0 && !showRequirementsWarning(warnings)) {
    return;
  }

  isLoading = true;

  const btn = $('chatDownloadBtn');
  const progress = $('chatProgress');
  const progressFill = $('chatProgressFill');
  const progressText = $('chatProgressText');

  if (btn) btn.style.display = 'none';
  if (progress) progress.classList.remove('hidden');

  try {
    const transformers = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0');
    const { pipeline, env } = transformers;
    env.allowLocalModels = true;
    env.cacheDir = 'tokencrush-models';
    env.useWasmCache = true;

    if (progressText) progressText.textContent = 'Checking local cache...';

    generator = await pipeline(
      'text-generation',
      'onnx-community/Qwen2.5-0.5B-Instruct',
      {
        progress_callback: (p) => {
          if (p.status === 'cache') {
            if (progressText) progressText.textContent = `Loading from cache: ${p.file || ''}`;
          } else if (p.status === 'download' || p.status === 'downloading') {
            const pct = p.progress || 0;
            const file = p.file || '';
            const fileSize = p.totalSize ? ` (${(p.totalSize / 1048576).toFixed(1)}MB)` : '';
            if (progressFill) progressFill.style.width = pct + '%';
            if (progressText) progressText.textContent = `Downloading to cache: ${file}${fileSize} (${Math.round(pct)}%)`;
          } else if (p.status === 'loading') {
            if (progressText) progressText.textContent = 'Loading model into memory...';
            if (progressFill) progressFill.style.width = '100%';
          } else if (p.status === 'ready') {
            if (progressText) progressText.textContent = 'Model ready!';
          }
        }
      }
    );

    modelReady = true;
    isLoading = false;

    if (progress) progress.classList.add('hidden');
    if (btn) {
      btn.textContent = '✓ Model Loaded';
      btn.style.display = 'block';
      btn.disabled = true;
      btn.style.opacity = '.5';
    }

    const sendBtn = $('chatSendBtn');
    const readmeBtn = $('chatReadmeBtn');
    if (sendBtn) sendBtn.disabled = false;
    if (readmeBtn) readmeBtn.disabled = false;

    appendMessage('system', 'Model loaded! Ask me anything about your code.');
  } catch (err) {
    isLoading = false;
    if (progress) progress.classList.add('hidden');
    if (btn) {
      btn.textContent = '✕ Failed — Retry';
      btn.style.display = 'block';
    }
    appendMessage('system', 'Failed to load model: ' + err.message);
  }
}

export async function chatSend() {
  const input = $('chatInput');
  const text = input?.value?.trim();
  if (!text || !modelReady || isLoading) return;

  input.value = '';
  input.style.height = 'auto';

  conversation.push({ role: 'user', content: text });
  appendMessage('user', text);

  const typingEl = appendTyping();
  isLoading = true;

  try {
    const messages = formatPrompt(text);
    let response = '';

    const result = await generator(messages, {
      max_new_tokens: 512,
      temperature: 0.7,
      do_sample: true
    });

    if (result && result[0]) {
      const generated = result[0].generated_text;
      if (Array.isArray(generated)) {
        response = generated[generated.length - 1]?.content || '';
      } else if (typeof generated === 'string') {
        response = generated;
      } else {
        response = JSON.stringify(generated);
      }
    }

    removeTyping(typingEl);
    if (response) {
      conversation.push({ role: 'assistant', content: response });
      appendMessage('assistant', response);
    } else {
      appendMessage('assistant', '(No response from model)');
    }
  } catch (err) {
    removeTyping(typingEl);
    appendMessage('system', 'Error: ' + err.message);
  }

  isLoading = false;
}

function appendMessage(role, text) {
  const container = $('chatMessages');
  if (!container) return;

  const welcome = container.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  const div = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function appendTyping() {
  const container = $('chatMessages');
  if (!container) return null;

  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.innerHTML = '<div class="chat-typing"><span></span><span></span><span></span></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function removeTyping(el) {
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

export function chatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    chatSend();
  }
}

export function chatClear() {
  conversation = [];
  const container = $('chatMessages');
  if (!container) return;
  container.innerHTML = `
    <div class="chat-welcome">
      <div class="chat-welcome-icon">💬</div>
      <p>Chat with your code. Ask questions about the selected file.</p>
      <p class="chat-welcome-sub">Model runs 100% in your browser — no data leaves your device.</p>
    </div>
  `;
}

function renderMarkdown(md) {
  // Escape HTML first, then selectively re-render markdown constructs
  const esc = String(md)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return esc
    // Fenced code blocks (``` or ~~~)
    .replace(/```[\w]*\n([\s\S]*?)```/g, '<pre class="readme-code"><code>$1</code></pre>')
    .replace(/~~~[\w]*\n([\s\S]*?)~~~/g, '<pre class="readme-code"><code>$1</code></pre>')
    // Headings
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="readme-inline-code">$1</code>')
    // Unordered lists
    .replace(/^[-*+] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Ordered lists
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr>')
    // Paragraphs (blank-line separated blocks that aren't already tags)
    .replace(/\n\n(?!<)/g, '</p><p>')
    .replace(/^(?!<)/, '<p>')
    .replace(/(?<!>)$/, '</p>');
}

export async function chatGenReadme() {
  if (!modelReady || isLoading) return;

  const files = [...state.files.entries()];
  if (files.length === 0) {
    appendMessage('system', 'Load some files first before generating a README.');
    return;
  }

  let codeSummary = '';
  let totalLen = 0;
  const maxLen = 3000;

  for (const [, f] of files) {
    const block = `\n--- ${f.name} ---\n`;
    if (totalLen + block.length + f.content.length > maxLen) {
      codeSummary += block + f.content.substring(0, maxLen - totalLen - block.length - 50) + '\n... (truncated)\n';
      break;
    }
    codeSummary += block + f.content + '\n';
    totalLen += block.length + f.content.length;
  }

  const prompt = `Generate a comprehensive README.md for this codebase. Include:
1. Project title and description
2. Features
3. File structure
4. How to use / setup

Here are the files:\n${codeSummary}`;

  conversation.push({ role: 'user', content: '[Generate README]' });
  appendMessage('user', 'Generate a README for my code');

  const typingEl = appendTyping();
  isLoading = true;

  try {
    const messages = formatPrompt(prompt);
    let response = '';

    const result = await generator(messages, {
      max_new_tokens: 1024,
      temperature: 0.5,
      do_sample: true
    });

    if (result && result[0]) {
      const generated = result[0].generated_text;
      if (Array.isArray(generated)) {
        response = generated[generated.length - 1]?.content || '';
      } else if (typeof generated === 'string') {
        response = generated;
      }
    }

    removeTyping(typingEl);
    if (response) {
      conversation.push({ role: 'assistant', content: response });
      const container = $('chatMessages');
      if (container) {
        const readmeDiv = document.createElement('div');
        readmeDiv.className = 'chat-msg readme';
        readmeDiv.innerHTML = `
          <div class="readme-header">
            <span>Generated README.md</span>
            <button class="btn btn-sm" onclick="navigator.clipboard.writeText(this.closest('.chat-msg').querySelector('.readme-body').textContent)">Copy</button>
          </div>
          <div class="readme-body">${renderMarkdown(response)}</div>
        `;
        container.appendChild(readmeDiv);
        container.scrollTop = container.scrollHeight;
      }
    } else {
      appendMessage('assistant', '(No response from model)');
    }
  } catch (err) {
    removeTyping(typingEl);
    appendMessage('system', 'Error generating README: ' + err.message);
  }

  isLoading = false;
}


