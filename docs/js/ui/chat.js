import { state } from '../core/state.js';

let generator = null;
let tokenizer = null;
let modelReady = false;
let isLoading = false;
let currentFile = null;
let conversation = [];
let TextStreamerClass = null;

function $(id) { return document.getElementById(id); }

export function initChat() {
  const input = $('chatInput');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
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
  let base = 'You are a helpful coding assistant. You help developers understand their code. Be concise and direct. Use markdown formatting for code examples.';
  if (currentFile) {
    const maxLen = 3000;
    const content = currentFile.content.length > maxLen
      ? currentFile.content.substring(0, maxLen) + '\n... (truncated)'
      : currentFile.content;
    base += `\n\nThe user is currently viewing this file: ${currentFile.name}\n\`\`\`\n${content}\n\`\`\``;
  }
  return base;
}

function buildMessages(userText) {
  const msgs = [{ role: 'system', content: getSystemPrompt() }];
  for (const m of conversation) {
    msgs.push({ role: m.role, content: m.content });
  }
  msgs.push({ role: 'user', content: userText });
  return msgs;
}

export async function chatDownloadModel() {
  if (modelReady || isLoading) return;
  isLoading = true;

  const btn = $('chatDownloadBtn');
  const progress = $('chatProgress');
  const progressFill = $('chatProgressFill');
  const progressText = $('chatProgressText');

  if (btn) btn.style.display = 'none';
  if (progress) progress.classList.remove('hidden');

  try {
    const { pipeline, env, TextStreamer } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4');
    env.allowLocalModels = false;
    TextStreamerClass = TextStreamer;

    if (progressText) progressText.textContent = 'Loading Transformers.js...';

    generator = await pipeline(
      'text-generation',
      'onnx-community/Qwen2.5-0.5B-Instruct',
      {
        dtype: 'q4',
        progress_callback: (p) => {
          if (p.status === 'downloading' && p.file) {
            const pct = p.progress || 0;
            if (progressFill) progressFill.style.width = pct + '%';
            if (progressText) progressText.textContent = `Downloading: ${p.file} (${Math.round(pct)}%)`;
          } else if (p.status === 'loading') {
            if (progressText) progressText.textContent = 'Loading model into memory...';
            if (progressFill) progressFill.style.width = '100%';
          } else if (p.status === 'ready') {
            if (progressText) progressText.textContent = 'Model ready!';
          }
        }
      }
    );

    tokenizer = generator.tokenizer;
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

    appendMessage('system', 'Model loaded. Ask me anything about your code!');
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
    const messages = buildMessages(text);
    let response = '';

    if (TextStreamerClass && tokenizer) {
      const streamer = new TextStreamerClass(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (token) => {
          response += token;
          updateLastAssistant(response);
        }
      });

      await generator(messages, {
        max_new_tokens: 512,
        temperature: 0.7,
        do_sample: true,
        streamer
      });
    } else {
      const result = await generator(messages, {
        max_new_tokens: 512,
        temperature: 0.7,
        do_sample: true
      });
      if (result && result[0]) {
        const generated = result[0].generated_text;
        if (Array.isArray(generated)) {
          response = generated[generated.length - 1]?.content || '';
        } else {
          response = generated || '';
        }
      }
      updateLastAssistant(response);
    }

    removeTyping(typingEl);
    conversation.push({ role: 'assistant', content: response });
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

function updateLastAssistant(text) {
  const container = $('chatMessages');
  if (!container) return;
  const msgs = container.querySelectorAll('.chat-msg.assistant');
  const last = msgs[msgs.length - 1];
  if (last) {
    last.textContent = text;
    container.scrollTop = container.scrollHeight;
  }
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

export async function chatGenReadme() {
  if (!modelReady || isLoading) return;

  const files = [...state.files.entries()];
  if (files.length === 0) {
    appendMessage('system', 'Load some files first before generating a README.');
    return;
  }

  let codeSummary = '';
  let totalLen = 0;
  const maxLen = 4000;

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
5. API or function references if applicable

Here are the files:\n${codeSummary}`;

  conversation.push({ role: 'user', content: '[Generate README]' });
  appendMessage('user', 'Generate a README for my code');

  const typingEl = appendTyping();
  isLoading = true;

  try {
    const messages = buildMessages(prompt);
    let response = '';

    if (TextStreamerClass && tokenizer) {
      const streamer = new TextStreamerClass(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (token) => {
          response += token;
          updateLastAssistant(response);
        }
      });

      await generator(messages, {
        max_new_tokens: 1024,
        temperature: 0.5,
        do_sample: true,
        streamer
      });
    } else {
      const result = await generator(messages, {
        max_new_tokens: 1024,
        temperature: 0.5,
        do_sample: true
      });
      if (result && result[0]) {
        const generated = result[0].generated_text;
        if (Array.isArray(generated)) {
          response = generated[generated.length - 1]?.content || '';
        } else {
          response = generated || '';
        }
      }
      updateLastAssistant(response);
    }

    removeTyping(typingEl);
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
        <div class="readme-body">${escH(response)}</div>
      `;
      container.appendChild(readmeDiv);
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    removeTyping(typingEl);
    appendMessage('system', 'Error generating README: ' + err.message);
  }

  isLoading = false;
}

function escH(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
