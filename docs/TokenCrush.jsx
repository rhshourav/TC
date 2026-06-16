import { useState, useRef, useCallback, useEffect } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────
const CLAUDE_CTX = 200000;
const SUPPORTED = ["js","ts","jsx","tsx","py","css","html","vue","svelte","json","md","rb","go","rs","java","cpp","c","cs","php","swift","kt","sh","yaml","yml","toml","xml"];
const RESERVED = new Set(['break','case','catch','class','const','continue','debugger','default','delete','do','else','export','extends','false','finally','for','function','if','import','in','instanceof','let','new','null','return','static','super','switch','this','throw','true','try','typeof','var','void','while','with','yield','async','await','of','from','get','set','arguments','undefined','NaN','Infinity','console','document','window','process','module','require','exports','Promise','Array','Object','String','Number','Boolean','Error','Math','JSON','Date','Map','Set','Symbol','Proxy','parseInt','parseFloat','isNaN','isFinite','setTimeout','clearTimeout','setInterval','clearInterval','fetch','XMLHttpRequest','addEventListener','querySelector','getElementById','length','push','pop','shift','unshift','map','filter','reduce','forEach','find','some','every','includes','indexOf','slice','splice','join','split','toString','valueOf','hasOwnProperty','prototype','constructor','keys','values','entries','assign','create','freeze','log','warn','error','info','then','catch','finally','resolve','reject','all','race','any','next','done','value','type','name','message','stack','code','status','data','body','headers','url','method','params','options','config','response','request','callback','event','target','src','href','id','className','style','innerHTML','textContent','append','remove','setAttribute','getAttribute','children','parentNode','call','apply','bind','sort','reverse','concat','flat','fill','replaceAll','replace','match','test','exec','search','trim','startsWith','endsWith','padStart','padEnd','repeat','charAt','stringify','parse','max','min','abs','ceil','floor','round','random','pow','sqrt','PI','E','sin','cos','tan','now','getTime','size','has','add','delete','clear','emit','on','off','once']);

// ─── HELPERS ────────────────────────────────────────────────
const uid = () => Math.random().toString(36).slice(2, 10);
const estTok = s => Math.ceil((s || "").length / 4);
const fmtBytes = n => n < 1024 ? n + "B" : n < 1048576 ? (n / 1024).toFixed(1) + "KB" : (n / 1048576).toFixed(1) + "MB";
const fmtTime = ts => { const d = new Date(ts); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); };
const getLang = name => { const ext = name.split(".").pop().toLowerCase(); return SUPPORTED.includes(ext) ? ext : "other"; };
const isCompressible = name => { const ext = name.split(".").pop().toLowerCase(); return SUPPORTED.includes(ext); };
const getLangIcon = lang => ({ js: "📜", ts: "🔷", jsx: "⚛️", tsx: "⚛️", py: "🐍", css: "🎨", html: "🌐", json: "📋", md: "📝", rs: "🦀", go: "🐹", java: "☕", cpp: "⚙️", c: "⚙️", rb: "💎", swift: "🦅", kt: "🎯" }[lang] || "📄");
const getLangBadge = lang => ({ js: "#f5a623", ts: "#3178c6", jsx: "#61dafb", tsx: "#61dafb", py: "#3776ab", css: "#1572b6", html: "#e44d26", rs: "#ce422b", go: "#00add8" }[lang] || "#888");
const escH = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

// ─── LOCAL COMPRESSION ───────────────────────────────────────
function stripCommentsJS(code) {
  let r = "", i = 0;
  while (i < code.length) {
    if (code[i] === "/" && code[i+1] === "/") { while (i < code.length && code[i] !== "\n") i++; }
    else if (code[i] === "/" && code[i+1] === "*") { i += 2; while (i < code.length && !(code[i] === "*" && code[i+1] === "/")) i++; i += 2; }
    else if (code[i] === '"' || code[i] === "'" || code[i] === "`") {
      const q = code[i]; r += code[i++];
      while (i < code.length) { if (code[i] === "\\") { r += code[i++]; r += code[i++]; continue; } r += code[i]; if (code[i++] === q) break; }
    } else { r += code[i++]; }
  }
  return r;
}
function stripCommentsHTML(code) { return code.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); }
function stripWhitespace(code, lang) {
  if (lang === "html") return code.replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").replace(/>\s+</g, "><").replace(/;\s+/g, ";").replace(/\{\s+/g, "{").replace(/\s+\}/g, "}").replace(/:\s+/g, ":").trim();
  if (lang === "css") return code.replace(/\s*\n\s*/g, "").replace(/\s{2,}/g, " ").replace(/\s*\{\s*/g, "{").replace(/\s*\}\s*/g, "}").replace(/\s*:\s*/g, ":").replace(/\s*;\s*/g, ";").replace(/\s*,\s*/g, ",").replace(/;}/g, "}").trim();
  return code.replace(/\r?\n\s*/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").replace(/ *([=+\-*/<>!&|,;:{}()[\]]) */g, "$1").replace(/\n([=+\-*/<>!&|,;{}()[\]])/g, "$1").replace(/([=+\-*/<>!&|,;{}()[\]])\n/g, "$1").trim();
}
function minifyIds(code) {
  const cands = {};
  const re = /\b([a-zA-Z_][a-zA-Z0-9_$]*)\b/g; let m;
  while ((m = re.exec(code)) !== null) { const id = m[1]; if (!RESERVED.has(id) && id.length > 4) cands[id] = (cands[id] || 0) + 1; }
  const sorted = Object.entries(cands).filter(([k]) => k.length > 4).sort((a, b) => (b[1] * b[0].length) - (a[1] * a[0].length));
  const cs = "abcdefghijklmnopqrstuvwxyz";
  const gen = i => i < 26 ? "_" + cs[i] : "_" + cs[Math.floor(i / 26) - 1] + cs[i % 26];
  const nameMap = {}; const ctxMap = [];
  sorted.slice(0, 80).forEach(([id], i) => { nameMap[id] = gen(i); ctxMap.push({ from: id, to: gen(i), count: cands[id] }); });
  const result = code.replace(/\b([a-zA-Z_][a-zA-Z0-9_$]*)\b/g, w => nameMap[w] || w);
  return { code: result, ctxMap };
}
function localCompress(content, lang, opts) {
  let code = content;
  if (opts.stripComments) code = lang === "html" ? stripCommentsHTML(code) : stripCommentsJS(code);
  if (opts.stripWhitespace) code = stripWhitespace(code, lang);
  let ctxMap = [];
  if (opts.renameIds && lang !== "html" && lang !== "css") { const r = minifyIds(code); code = r.code; ctxMap = r.ctxMap; }
  return { code, ctxMap };
}

// ─── AI COMPRESSION ──────────────────────────────────────────
const PROMPTS = {
  pseudo: (lang, name, code) => `You are a code compression expert. Given this ${lang} code from file "${name}", produce:
1. A maximally compressed but valid version
2. A 2-sentence summary of what it does

Respond ONLY as JSON (no fences): {"compressed":"...","summary":"..."}

CODE:
${code.slice(0, 5000)}`,
  semantic: (lang, name, code) => `You are an expert at compressing ${lang} code for AI consumption. Rewrite it maximally compressed:
- Collapse multi-line logic into single expressions
- Use shorthand/ternary/destructuring aggressively
- Remove dead code, redundant variables, unnecessary wrappers
- Keep 100% logical equivalence

Respond ONLY as JSON (no fences): {"compressed":"...","summary":"...one sentence what this does..."}

CODE:
${code.slice(0, 5000)}`,
  deep: (lang, name, code) => `You are the world's most aggressive token optimizer for ${lang}. File: "${name}".
Apply ALL of: remove whitespace, rename identifiers to 1-2 chars, collapse all logic, inline vars, chain methods, implicit returns, ternaries everywhere.
Also output renamed identifier map and one-line summary.

Respond ONLY as JSON (no fences): {"compressed":"...","contextMap":[{"from":"...","to":"..."}],"summary":"..."}

CODE:
${code.slice(0, 5500)}`
};

async function aiCompressCode(code, strategy, lang, fileName) {
  const prompt = PROMPTS[strategy](lang, fileName, code);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = data.content.map(b => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); }
  catch { const m = clean.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error("AI parse failed"); }
}

// ─── STYLES ──────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');
  :root {
    --bg: #0b0b0e; --surface: #141418; --surface2: #1e1e26; --surface3: #28282f;
    --border: rgba(255,255,255,0.07); --border2: rgba(255,255,255,0.13); --border3: rgba(255,255,255,0.22);
    --text: #ededf0; --text2: #a0a0aa; --muted: #606068;
    --accent: #7c6dfa; --accent2: #a393ff; --accent-dim: rgba(124,109,250,0.12);
    --green: #3ecf8e; --green-dim: rgba(62,207,142,0.10);
    --red: #f05252; --amber: #f5a623; --amber-dim: rgba(245,166,35,0.10);
    --mono: 'JetBrains Mono', 'Fira Code', monospace;
    --radius: 8px; --radius-lg: 12px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: 'Inter', -apple-system, sans-serif; font-size: 13px; line-height: 1.5; overflow: hidden; height: 100vh; }
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }
  ::-webkit-scrollbar-track { background: transparent; }

  /* HEADER */
  .hdr { height: 52px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 16px; gap: 12px; flex-shrink: 0; background: var(--surface); }
  .logo { display: flex; align-items: center; gap: 9px; text-decoration: none; }
  .logo-icon { width: 26px; height: 26px; background: var(--accent); border-radius: 7px; display: flex; align-items: center; justify-content: center; font-size: 13px; }
  .logo-text { font-weight: 700; font-size: 14px; letter-spacing: -.4px; color: var(--text); }
  .logo-badge { font-size: 9px; background: var(--accent-dim); color: var(--accent2); border: 1px solid rgba(124,109,250,.25); border-radius: 4px; padding: 2px 6px; font-weight: 600; letter-spacing: .6px; }
  .hdr-right { margin-left: auto; display: flex; align-items: center; gap: 6px; }
  .hdr-sep { width: 1px; height: 22px; background: var(--border2); }
  .gs-item { display: flex; align-items: center; gap: 4px; font-size: 10px; color: var(--muted); white-space: nowrap; }
  .gs-val { color: var(--text2); font-weight: 600; font-family: var(--mono); }
  .gs-val.green { color: var(--green); }

  /* BUTTONS */
  .btn { padding: 5px 11px; border-radius: var(--radius); border: 1px solid var(--border2); background: var(--surface2); color: var(--text2); font-size: 11px; font-weight: 500; cursor: pointer; transition: all .15s; white-space: nowrap; font-family: inherit; }
  .btn:hover { border-color: var(--border3); color: var(--text); background: var(--surface3); }
  .btn:disabled { opacity: .4; cursor: not-allowed; }
  .btn-accent { background: var(--accent); border-color: var(--accent); color: #fff; }
  .btn-accent:hover:not(:disabled) { background: var(--accent2); border-color: var(--accent2); color: #fff; }
  .btn-green { background: var(--green-dim); border-color: rgba(62,207,142,.3); color: var(--green); }
  .btn-green:hover:not(:disabled) { background: rgba(62,207,142,.18); }
  .btn-sm { padding: 3px 8px; font-size: 10px; }

  /* WORKSPACE */
  .workspace { display: flex; height: calc(100vh - 52px); }

  /* SIDEBAR */
  .sidebar { width: 228px; flex-shrink: 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--surface); }
  .sidebar-hdr { padding: 10px 12px; border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 6px; }
  .sidebar-title { font-size: 10px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: .8px; flex: 1; }
  .add-btn { width: 20px; height: 20px; border-radius: 5px; border: 1px solid var(--border2); background: transparent; color: var(--muted); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; line-height: 1; transition: all .15s; }
  .add-btn:hover { border-color: var(--accent); color: var(--accent2); }

  /* DROP ZONE */
  .drop-zone { margin: 10px; border: 1.5px dashed var(--border2); border-radius: var(--radius-lg); padding: 16px 10px; text-align: center; cursor: pointer; transition: all .2s; flex-shrink: 0; }
  .drop-zone:hover, .drop-zone.drag-over { border-color: var(--accent); background: var(--accent-dim); }
  .dz-icon { font-size: 20px; margin-bottom: 6px; opacity: .5; }
  .dz-title { font-size: 11px; color: var(--text2); font-weight: 600; margin-bottom: 3px; }
  .dz-sub { font-size: 10px; color: var(--muted); line-height: 1.5; }

  /* SEARCH */
  .search-bar { padding: 6px 8px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .search-input { width: 100%; background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 11px; padding: 4px 8px; outline: none; font-family: inherit; }
  .search-input:focus { border-color: var(--accent); }
  .search-input::placeholder { color: var(--muted); }

  /* FILE LIST */
  .file-list { flex: 1; overflow-y: auto; padding: 4px 6px; }
  .file-item { display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: var(--radius); cursor: pointer; transition: all .15s; margin-bottom: 2px; border: 1px solid transparent; }
  .file-item:hover { background: var(--surface2); }
  .file-item.active { background: var(--accent-dim); border-color: rgba(124,109,250,.2); }
  .fi-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; transition: background .3s; }
  .fi-dot.done { background: var(--green); }
  .fi-dot.pending { background: var(--muted); }
  .fi-dot.processing { background: var(--amber); animation: pulse 1s infinite; }
  .fi-icon { font-size: 13px; flex-shrink: 0; width: 16px; text-align: center; }
  .fi-name { flex: 1; font-size: 11px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: var(--mono); }
  .fi-size { font-size: 9px; color: var(--muted); flex-shrink: 0; }
  .fi-del { opacity: 0; font-size: 11px; color: var(--muted); cursor: pointer; padding: 2px; border-radius: 3px; flex-shrink: 0; background: none; border: none; transition: .15s; }
  .file-item:hover .fi-del { opacity: 1; }
  .fi-del:hover { color: var(--red); background: rgba(240,82,82,.15); }

  /* SIDEBAR FOOTER */
  .sidebar-footer { border-top: 1px solid var(--border); padding: 10px 12px; flex-shrink: 0; }
  .compress-all-btn { width: 100%; padding: 8px; border-radius: var(--radius); background: var(--accent); border: none; color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; display: flex; align-items: center; justify-content: center; gap: 6px; font-family: inherit; }
  .compress-all-btn:hover:not(:disabled) { background: var(--accent2); transform: translateY(-1px); }
  .compress-all-btn:disabled { opacity: .4; cursor: not-allowed; }
  .file-count-badge { margin-top: 6px; text-align: center; font-size: 10px; color: var(--muted); }

  /* EDITOR PANEL */
  .editor-panel { flex: 1; display: flex; flex-direction: column; min-width: 0; border-right: 1px solid var(--border); }
  .editor-hdr { height: 40px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 14px; gap: 10px; flex-shrink: 0; background: var(--surface); }
  .editor-filename { font-size: 12px; font-weight: 600; font-family: var(--mono); color: var(--text2); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lang-badge { font-size: 9px; padding: 2px 7px; border-radius: 4px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; border: 1px solid; }
  .token-pill { font-size: 10px; color: var(--muted); background: var(--surface3); border-radius: 4px; padding: 2px 8px; white-space: nowrap; }
  .token-pill.warn { color: var(--amber); background: var(--amber-dim); }
  .token-pill.danger { color: var(--red); background: rgba(240,82,82,.1); }

  /* CONTROLS BAR */
  .controls-bar { border-bottom: 1px solid var(--border); padding: 8px 14px; background: var(--surface); flex-shrink: 0; }
  .ctrl-row1 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .tgl-grp { display: flex; align-items: center; gap: 5px; }
  .tgl-lbl { font-size: 10px; color: var(--text2); white-space: nowrap; user-select: none; }
  .tgl { position: relative; width: 28px; height: 15px; flex-shrink: 0; }
  .tgl input { opacity: 0; width: 0; height: 0; position: absolute; }
  .tgl-s { position: absolute; inset: 0; background: var(--surface3); border-radius: 8px; cursor: pointer; border: 1px solid var(--border2); transition: .2s; }
  .tgl-s:before { content: ''; position: absolute; width: 11px; height: 11px; left: 1px; top: 1px; background: var(--muted); border-radius: 50%; transition: .2s; }
  .tgl input:checked + .tgl-s { background: var(--accent); border-color: var(--accent); }
  .tgl input:checked + .tgl-s:before { transform: translateX(13px); background: #fff; }
  .sep { width: 1px; height: 16px; background: var(--border2); flex-shrink: 0; }
  .ctrl-row2 { display: flex; align-items: center; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
  .ai-lbl { font-size: 10px; color: var(--muted); white-space: nowrap; }
  .spill { font-size: 10px; padding: 3px 9px; border-radius: 5px; border: 1px solid var(--border2); color: var(--muted); cursor: pointer; transition: all .15s; display: flex; align-items: center; gap: 4px; white-space: nowrap; background: none; font-family: inherit; }
  .spill.active { border-color: var(--accent); color: var(--accent2); background: var(--accent-dim); }
  .spill .sd { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
  .spill.deep { color: var(--green); border-color: rgba(62,207,142,.3); }
  .spill.deep.active { background: var(--green-dim); border-color: rgba(62,207,142,.5); }

  /* BUDGET BAR */
  .budget-bar { height: 2px; background: var(--surface3); flex-shrink: 0; overflow: hidden; }
  .budget-fill { height: 100%; background: linear-gradient(90deg, var(--green), var(--accent)); transition: width .4s ease; }
  .budget-fill.warn { background: linear-gradient(90deg, var(--amber), var(--red)); }

  /* CODE EDITOR */
  .code-wrap { flex: 1; position: relative; overflow: hidden; }
  .code-editor { position: absolute; inset: 0; background: transparent; border: none; color: var(--text); font-family: var(--mono); font-size: 12px; line-height: 1.7; padding: 14px; resize: none; outline: none; tab-size: 2; width: 100%; height: 100%; }
  .code-editor::placeholder { color: var(--muted); }
  .empty-drop { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; pointer-events: none; }
  .ed-icon { font-size: 36px; opacity: .15; }
  .ed-hint { font-size: 12px; color: var(--muted); text-align: center; line-height: 1.8; }

  /* EDITOR META */
  .editor-meta { border-top: 1px solid var(--border); padding: 4px 14px; background: var(--surface); display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
  .em-stat { font-size: 9px; color: var(--muted); }
  .em-stat span { color: var(--text2); }

  /* OUTPUT PANEL */
  .output-panel { width: 400px; flex-shrink: 0; display: flex; flex-direction: column; }
  .out-hdr { height: 40px; border-bottom: 1px solid var(--border); display: flex; align-items: center; padding: 0 14px; gap: 8px; flex-shrink: 0; background: var(--surface); }
  .out-filename { font-size: 12px; font-weight: 600; font-family: var(--mono); color: var(--text2); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .out-tabs { display: flex; border-bottom: 1px solid var(--border); flex-shrink: 0; background: var(--surface); }
  .out-tab { padding: 7px 14px; font-size: 10px; font-weight: 600; color: var(--muted); cursor: pointer; border-bottom: 2px solid transparent; transition: all .15s; text-transform: uppercase; letter-spacing: .6px; white-space: nowrap; background: none; border-left: none; border-right: none; border-top: none; font-family: inherit; }
  .out-tab.active { color: var(--accent2); border-bottom-color: var(--accent); }
  .out-tab:hover:not(.active) { color: var(--text2); }
  .progress-strip { height: 2px; background: var(--surface3); flex-shrink: 0; overflow: hidden; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, var(--accent), var(--green)); transition: width .3s; }

  /* OUTPUT CONTENT */
  .out-content { flex: 1; overflow: hidden; display: flex; flex-direction: column; position: relative; }
  .out-empty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; color: var(--muted); }
  .oe-icon { font-size: 28px; opacity: .2; }
  .out-code { flex: 1; background: transparent; border: none; color: var(--green); font-family: var(--mono); font-size: 11.5px; line-height: 1.7; padding: 14px; resize: none; outline: none; width: 100%; height: 100%; }
  .scroll-view { flex: 1; overflow-y: auto; padding: 14px; font-family: var(--mono); font-size: 11px; line-height: 1.7; }

  /* STATS BAR */
  .stats-bar { border-top: 1px solid var(--border); padding: 8px 14px; background: var(--surface); flex-shrink: 0; display: flex; align-items: center; gap: 10px; }
  .stat-item { display: flex; flex-direction: column; gap: 1px; }
  .stat-lbl { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: .5px; }
  .stat-val { font-size: 12px; font-weight: 700; color: var(--text); font-family: var(--mono); }
  .stat-val.green { color: var(--green); }
  .stat-sep { width: 1px; height: 28px; background: var(--border2); }
  .savings-badge { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--green); background: var(--green-dim); border: 1px solid rgba(62,207,142,.25); border-radius: var(--radius); padding: 4px 10px; }

  /* DIFF */
  .diff-line { padding: 1px 6px; border-radius: 2px; white-space: pre-wrap; word-break: break-all; }
  .diff-line.rem { background: rgba(240,82,82,.07); color: var(--red); }
  .diff-line.add { background: rgba(62,207,142,.07); color: var(--green); }

  /* BUNDLE */
  .bundle-block { border: 1px solid var(--border2); border-radius: var(--radius); margin-bottom: 8px; overflow: hidden; }
  .bundle-block-hdr { background: var(--surface2); padding: 6px 10px; display: flex; justify-content: space-between; font-size: 10px; }
  .bundle-block-code { padding: 8px 10px; font-size: 10px; color: var(--green); white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto; }

  /* HISTORY */
  .hist-entry { border: 1px solid var(--border); border-radius: var(--radius); margin-bottom: 6px; overflow: hidden; }
  .hist-hdr { padding: 6px 10px; background: var(--surface2); display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .hist-badge { font-size: 9px; background: var(--green-dim); color: var(--green); border: 1px solid rgba(62,207,142,.25); border-radius: 4px; padding: 1px 5px; font-weight: 600; flex-shrink: 0; }
  .hist-ts { font-size: 9px; color: var(--muted); margin-left: auto; flex-shrink: 0; }
  .hist-body { padding: 8px 10px; font-size: 10px; white-space: pre-wrap; word-break: break-all; color: var(--text2); max-height: 80px; overflow: hidden; }
  .hist-body.open { max-height: none; }
  .hist-restore { font-size: 9px; padding: 2px 6px; margin-left: 4px; }

  /* PSEUDO BAR */
  .pseudo-bar { border-top: 1px solid var(--border); padding: 8px 14px; background: var(--surface); flex-shrink: 0; font-size: 11px; color: var(--text2); font-style: italic; }

  /* PREFIX ROW */
  .prefix-row { border-top: 1px solid var(--border); padding: 8px 14px; background: var(--surface); flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
  .prefix-lbl { font-size: 10px; color: var(--muted); white-space: nowrap; }
  .prefix-input { flex: 1; background: var(--surface2); border: 1px solid var(--border); border-radius: 5px; color: var(--text); font-size: 11px; padding: 3px 7px; outline: none; font-family: var(--mono); }
  .prefix-input:focus { border-color: var(--accent); }

  /* AI OVERLAY */
  .ai-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.75); display: flex; align-items: center; justify-content: center; z-index: 999; backdrop-filter: blur(6px); }
  .ai-card { background: var(--surface); border: 1px solid var(--border2); border-radius: 16px; padding: 32px 36px; width: 360px; text-align: center; }
  .ai-spin { width: 36px; height: 36px; border: 2.5px solid var(--border2); border-top-color: var(--accent); border-radius: 50%; animation: spin .7s linear infinite; margin: 0 auto 16px; }
  .ai-card h3 { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
  .ai-card p { color: var(--muted); font-size: 12px; line-height: 1.6; }
  .ai-prog-track { height: 3px; background: var(--surface3); border-radius: 2px; overflow: hidden; margin: 16px 0 6px; }
  .ai-prog-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width .4s; }
  .ai-stage { font-size: 11px; color: var(--accent2); font-family: var(--mono); }
  .ai-file-list { margin-top: 12px; text-align: left; font-size: 10px; font-family: var(--mono); color: var(--muted); max-height: 80px; overflow-y: auto; }
  .ai-fi { padding: 2px 0; display: flex; align-items: center; gap: 6px; }
  .ai-fi.done { color: var(--green); }
  .ai-fi.active { color: var(--accent2); }

  /* TOAST */
  .toast { position: fixed; bottom: 20px; right: 20px; background: var(--surface2); border: 1px solid var(--border2); border-radius: var(--radius); padding: 10px 16px; font-size: 12px; color: var(--text); z-index: 9999; pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  .toast.ok { border-color: rgba(62,207,142,.4); color: var(--green); }
  .toast.err { border-color: rgba(240,82,82,.4); color: var(--red); }

  /* CTX DRAWER */
  .ctx-drawer { border-top: 1px solid var(--border); background: var(--surface); flex-shrink: 0; overflow: hidden; max-height: 0; transition: max-height .25s ease; }
  .ctx-drawer.open { max-height: 120px; }
  .ctx-drawer-hdr { padding: 5px 14px; display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .ctx-title { font-size: 10px; color: var(--muted); text-transform: uppercase; letter-spacing: .6px; }
  .ctx-badge { font-size: 9px; background: var(--accent-dim); color: var(--accent2); border-radius: 3px; padding: 1px 5px; }
  .ctx-body { padding: 0 14px 8px; display: flex; flex-wrap: wrap; gap: 4px; overflow-y: auto; max-height: 80px; }
  .ctx-item { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; font-family: var(--mono); background: var(--surface2); border: 1px solid var(--border2); border-radius: 4px; padding: 2px 7px; }
  .ctx-from { color: var(--text2); }
  .ctx-arr { color: var(--muted); }
  .ctx-to { color: var(--accent2); }
  .ctx-tag { font-size: 8px; background: var(--accent-dim); color: var(--accent2); border-radius: 3px; padding: 1px 4px; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.3; } }
`;

// ─── MAIN APP ────────────────────────────────────────────────
export default function TokenCrush() {
  const [files, setFiles] = useState(new Map());
  const [activeId, setActiveId] = useState(null);
  const [strategy, setStrategy] = useState("none");
  const [opts, setOpts] = useState({ stripComments: true, stripWhitespace: true, renameIds: false, autoCompress: false });
  const [activeTab, setActiveTab] = useState("compressed");
  const [prefix, setPrefix] = useState("Below is compressed source code. Use the context map to decode identifiers.");
  const [fileFilter, setFileFilter] = useState("");
  const [aiState, setAiState] = useState(null); // {progress, stage, files:[{name,status}]}
  const [toast, setToast] = useState(null);
  const [history, setHistory] = useState([]);
  const [ctxOpen, setCtxOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [openHistIdx, setOpenHistIdx] = useState(null);
  const fileInputRef = useRef(null);
  const autoTimer = useRef(null);

  const activeFile = files.get(activeId);

  const showToast = useCallback((msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2800);
  }, []);

  // ── FILE MANAGEMENT ──
  const addFile = useCallback((name, content) => {
    if (!isCompressible(name)) { showToast("Skipped: " + name + " (unsupported)", "err"); return null; }
    const id = uid();
    setFiles(prev => {
      const next = new Map(prev);
      next.set(id, { name, content, lang: getLang(name), compressed: "", ctxMap: [], pseudo: "", tokenIn: estTok(content), tokenOut: 0, status: "pending" });
      return next;
    });
    return id;
  }, [showToast]);

  const deleteFile = useCallback((id, e) => {
    e?.stopPropagation();
    setFiles(prev => { const next = new Map(prev); next.delete(id); return next; });
    setActiveId(prev => prev === id ? null : prev);
  }, []);

  const handleFileDrop = useCallback(async (fileList) => {
    const arr = Array.from(fileList);
    let firstId = null;
    for (const f of arr) {
      const text = await f.text();
      const id = addFile(f.name, text);
      if (!firstId && id) firstId = id;
    }
    if (firstId) setActiveId(firstId);
  }, [addFile]);

  // ── COMPRESS ──
  const compressFile = useCallback(async (id, showOverlay = false) => {
    const f = files.get(id);
    if (!f) return;
    setFiles(prev => { const next = new Map(prev); next.set(id, { ...next.get(id), status: "processing" }); return next; });
    const { code: localCode, ctxMap: localCtx } = localCompress(f.content, f.lang, opts);
    let finalCode = localCode, ctxMap = localCtx, pseudo = "";
    if (strategy !== "none") {
      try {
        setAiState(s => s ? { ...s, stage: "Analyzing code..." } : null);
        const r = await aiCompressCode(localCode, strategy, f.lang, f.name);
        finalCode = r.compressed || localCode;
        pseudo = r.summary || "";
        const aiCtx = (r.contextMap || []).map(i => ({ from: i.from, to: i.to, count: 1, source: "AI" }));
        ctxMap = [...localCtx, ...aiCtx];
      } catch (e) {
        showToast("AI error: " + e.message, "err");
      }
    }
    const tokenIn = estTok(f.content);
    const tokenOut = estTok(finalCode);
    const reduction = tokenIn > 0 ? Math.round(((tokenIn - tokenOut) / tokenIn) * 100) : 0;
    setFiles(prev => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id), compressed: finalCode, ctxMap, pseudo, tokenIn, tokenOut, status: "done" });
      return next;
    });
    setHistory(prev => [{
      ts: Date.now(), fileName: f.name, tokenIn, tokenOut, reduction, compressed: finalCode, ctxMap: [...ctxMap], strategy
    }, ...prev.slice(0, 49)]);
    return { finalCode, ctxMap, pseudo, tokenIn, tokenOut };
  }, [files, opts, strategy, showToast]);

  const compressCurrent = useCallback(async () => {
    if (!activeId) { showToast("No file selected", "err"); return; }
    await compressFile(activeId, true);
  }, [activeId, compressFile, showToast]);

  const compressAll = useCallback(async () => {
    const ids = [...files.keys()];
    if (!ids.length) { showToast("No files loaded", "err"); return; }
    setAiState({ progress: 0, stage: "Starting...", files: ids.map(id => ({ id, name: files.get(id).name, status: "pending" })) });
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setAiState(prev => prev ? {
        ...prev,
        progress: Math.round((i / ids.length) * 100),
        stage: `Processing ${i+1}/${ids.length}: ${files.get(id)?.name}`,
        files: prev.files.map(fi => fi.id === id ? { ...fi, status: "active" } : fi)
      } : null);
      await compressFile(id, false);
      setAiState(prev => prev ? {
        ...prev,
        files: prev.files.map(fi => fi.id === id ? { ...fi, status: "done" } : fi)
      } : null);
    }
    setAiState(prev => prev ? { ...prev, progress: 100, stage: "Done!" } : null);
    setTimeout(() => { setAiState(null); setActiveTab("bundle"); }, 700);
    showToast(`Compressed ${ids.length} files!`);
  }, [files, compressFile, showToast]);

  // ── AUTO COMPRESS ──
  useEffect(() => {
    if (opts.autoCompress && activeFile) {
      clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(compressCurrent, 1200);
    }
  }, [activeFile?.content, opts.autoCompress]);

  // ── STATS ──
  const done = [...files.values()].filter(f => f.compressed);
  const totalIn = done.reduce((s, f) => s + f.tokenIn, 0);
  const totalOut = done.reduce((s, f) => s + f.tokenOut, 0);
  const saved = totalIn - totalOut;
  const avgPct = totalIn > 0 ? Math.round((saved / totalIn) * 100) : 0;

  const activeTok = activeFile ? estTok(activeFile.content) : 0;
  const budgetPct = Math.min(100, Math.round((activeTok / CLAUDE_CTX) * 100));

  // ── COPY ──
  const copyOutput = async () => {
    let text = "";
    if (activeTab === "compressed" && activeFile?.compressed) text = activeFile.compressed;
    else if (activeTab === "prompt" && activeFile?.compressed) text = buildPromptText(activeFile);
    else if (activeTab === "bundle") text = buildBundleText();
    else if (activeTab === "diff" && activeFile) text = activeFile.compressed;
    if (!text) { showToast("Nothing to copy", "err"); return; }
    await navigator.clipboard.writeText(text);
    showToast("Copied to clipboard");
  };

  const buildPromptText = (f) => {
    const mapStr = f.ctxMap.length > 0 ? "\n[CONTEXT MAP]\n" + f.ctxMap.map(i => `${i.to}=${i.from}`).join(", ") : "";
    const pseudoStr = f.pseudo ? "\n[LOGIC SUMMARY]\n" + f.pseudo : "";
    return `${prefix}${pseudoStr}${mapStr}\n\n[CODE: ${f.name}]\n${f.compressed}`;
  };

  const buildBundleText = () => {
    const doneFiles = [...files.values()].filter(f => f.compressed);
    let out = `${prefix}\n\n[${doneFiles.length} FILES — ${totalIn} → ${totalOut} tokens, ${Math.round((1 - totalOut / totalIn) * 100)}% reduction]\n\n`;
    doneFiles.forEach(f => {
      const map = f.ctxMap.map(i => `${i.to}=${i.from}`).join(", ");
      out += `// FILE: ${f.name}\n`;
      if (map) out += `// MAP: ${map}\n`;
      if (f.pseudo) out += `// SUMMARY: ${f.pseudo}\n`;
      out += f.compressed + "\n\n";
    });
    return out;
  };

  const restoreHistory = (h) => {
    const f = files.get(activeId);
    if (!f) { showToast("No file selected", "err"); return; }
    setFiles(prev => { const next = new Map(prev); next.set(activeId, { ...next.get(activeId), compressed: h.compressed, ctxMap: h.ctxMap, tokenOut: h.tokenOut, status: "done" }); return next; });
    setActiveTab("compressed");
    showToast("Restored from history");
  };

  const loadExample = () => {
    setFiles(new Map()); setActiveId(null);
    const ex = [
      { name: "auth.service.ts", content: `// Authentication Service\nimport jwt from 'jsonwebtoken';\nimport bcrypt from 'bcryptjs';\n\nconst JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';\nconst TOKEN_EXPIRY = '24h';\nconst SALT_ROUNDS = 12;\n\nexport class AuthenticationService {\n  async authenticateUser(emailAddress, plainTextPassword) {\n    const foundUser = await this.userRepository.findByEmail(emailAddress);\n    if (!foundUser) throw new Error('Invalid credentials');\n    const passwordIsValid = await bcrypt.compare(plainTextPassword, foundUser.passwordHash);\n    if (!passwordIsValid) throw new Error('Invalid credentials');\n    const accessToken = jwt.sign({ userId: foundUser.id, role: foundUser.role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });\n    return { accessToken, user: { id: foundUser.id, email: foundUser.email, role: foundUser.role } };\n  }\n}` },
      { name: "api.utils.js", content: `// API utility functions\nconst DEFAULT_TIMEOUT = 30000;\nconst DEFAULT_RETRIES = 3;\n\nasync function makeApiRequest(endpoint, options = {}, maxRetries = DEFAULT_RETRIES) {\n  const requestOptions = {\n    method: options.method || 'GET',\n    headers: { 'Content-Type': 'application/json', ...options.headers },\n    body: options.body ? JSON.stringify(options.body) : undefined,\n  };\n  let lastError;\n  for (let attemptNumber = 0; attemptNumber < maxRetries; attemptNumber++) {\n    try {\n      const apiResponse = await fetch(endpoint, requestOptions);\n      if (!apiResponse.ok) throw new Error('HTTP ' + apiResponse.status);\n      const responseData = await apiResponse.json();\n      return { success: true, data: responseData };\n    } catch (requestError) {\n      lastError = requestError;\n    }\n  }\n  throw lastError;\n}\n\nexport { makeApiRequest };` }
    ];
    let firstId = null;
    ex.forEach(({ name, content }) => {
      const id = uid();
      setFiles(prev => { const next = new Map(prev); next.set(id, { name, content, lang: getLang(name), compressed: "", ctxMap: [], pseudo: "", tokenIn: estTok(content), tokenOut: 0, status: "pending" }); return next; });
      if (!firstId) { firstId = id; setActiveId(id); }
    });
    showToast("Example files loaded — try Compress All!");
  };

  const filteredFiles = [...files.entries()].filter(([, f]) => !fileFilter || f.name.toLowerCase().includes(fileFilter.toLowerCase()));

  // ── RENDER ──
  return (
    <>
      <style>{styles}</style>

      {/* AI OVERLAY */}
      {aiState && (
        <div className="ai-overlay">
          <div className="ai-card">
            <div className="ai-spin" />
            <h3>Claude is compressing your code</h3>
            <p>Semantic analysis and token optimization in progress.</p>
            <div className="ai-prog-track"><div className="ai-prog-fill" style={{ width: aiState.progress + "%" }} /></div>
            <div className="ai-stage">{aiState.stage}</div>
            <div className="ai-file-list">
              {aiState.files?.map(fi => (
                <div key={fi.id} className={`ai-fi ${fi.status}`}>
                  {fi.status === "done" ? "✓" : fi.status === "active" ? "⟳" : "○"} {fi.name}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TOAST */}
      {toast && <div className={`toast ${toast.type}`}>{toast.msg}</div>}

      {/* HEADER */}
      <header className="hdr">
        <a className="logo" href="#">
          <div className="logo-icon">⚡</div>
          <span className="logo-text">TokenCrush</span>
          <span className="logo-badge">FOR CLAUDE</span>
        </a>
        {done.length > 0 && <>
          <div className="hdr-sep" />
          <div className="gs-item">Files: <span className="gs-val">{done.length}</span></div>
          <div className="gs-item">Saved: <span className="gs-val green">{saved.toLocaleString()}</span> tok</div>
          <div className="gs-item">Avg: <span className="gs-val green">-{avgPct}%</span></div>
        </>}
        <div className="hdr-right">
          <button className="btn btn-sm" onClick={loadExample}>Load Example</button>
          {files.size > 0 && <button className="btn btn-sm" onClick={() => { setFiles(new Map()); setActiveId(null); }}>Clear All</button>}
        </div>
      </header>

      <div className="workspace">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <div className="sidebar-hdr">
            <span className="sidebar-title">Files</span>
            <button className="add-btn" onClick={() => fileInputRef.current?.click()} title="Add file">+</button>
            <input ref={fileInputRef} type="file" multiple style={{ display: "none" }} accept={SUPPORTED.map(e => "." + e).join(",")} onChange={e => { handleFileDrop(e.target.files); e.target.value = ""; }} />
          </div>

          <div
            className={`drop-zone ${dragOver ? "drag-over" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFileDrop(e.dataTransfer.files); }}
          >
            <div className="dz-icon">📂</div>
            <div className="dz-title">Drop files here</div>
            <div className="dz-sub">or click to browse<br />.js .ts .py .css .html + more</div>
          </div>

          {files.size > 0 && (
            <div className="search-bar">
              <input className="search-input" placeholder="Filter files…" value={fileFilter} onChange={e => setFileFilter(e.target.value)} />
            </div>
          )}

          <div className="file-list">
            {files.size === 0 && <div style={{ textAlign: "center", padding: "20px 10px", fontSize: "10px", color: "var(--muted)" }}>No files yet</div>}
            {filteredFiles.map(([id, f]) => (
              <div key={id} className={`file-item ${id === activeId ? "active" : ""}`} onClick={() => setActiveId(id)}>
                <div className={`fi-dot ${f.status}`} />
                <span className="fi-icon">{getLangIcon(f.lang)}</span>
                <span className="fi-name" title={f.name}>{f.name}</span>
                <span className="fi-size">{fmtBytes(new Blob([f.content]).size)}</span>
                <button className="fi-del" onClick={e => deleteFile(id, e)}>✕</button>
              </div>
            ))}
          </div>

          <div className="sidebar-footer">
            <button className="compress-all-btn" onClick={compressAll} disabled={files.size === 0}>
              <span>⚡</span> Compress All
            </button>
            <div className="file-count-badge">{files.size === 0 ? "No files loaded" : `${files.size} file${files.size === 1 ? "" : "s"} loaded`}</div>
          </div>
        </aside>

        {/* EDITOR PANEL */}
        <div className="editor-panel">
          <div className="editor-hdr">
            <span className="editor-filename">{activeFile?.name || "No file selected"}</span>
            {activeFile && (
              <span className="lang-badge" style={{ color: getLangBadge(activeFile.lang), borderColor: getLangBadge(activeFile.lang) + "44", backgroundColor: getLangBadge(activeFile.lang) + "18" }}>
                {activeFile.lang.toUpperCase()}
              </span>
            )}
            <span className={`token-pill ${budgetPct > 80 ? "danger" : budgetPct > 50 ? "warn" : ""}`}>
              {activeTok.toLocaleString()} tokens
            </span>
            <button className="btn btn-accent btn-sm" onClick={compressCurrent} disabled={!activeId}>⚡ Compress</button>
          </div>

          <div className="controls-bar">
            <div className="ctrl-row1">
              {[["stripComments","Strip comments"],["stripWhitespace","Minify whitespace"],["renameIds","Rename vars"],["autoCompress","Auto"]].map(([k, lbl]) => (
                <label key={k} className="tgl-grp" style={{ cursor: "pointer" }}>
                  <span className="tgl-lbl">{lbl}</span>
                  <label className="tgl">
                    <input type="checkbox" checked={opts[k]} onChange={e => setOpts(o => ({ ...o, [k]: e.target.checked }))} />
                    <span className="tgl-s" />
                  </label>
                </label>
              ))}
            </div>
            <div className="ctrl-row2">
              <span className="ai-lbl">AI Mode:</span>
              {[["none","None"],["pseudo","Summary"],["semantic","Semantic"],["deep","Deep"]].map(([s, lbl]) => (
                <button key={s} className={`spill ${s === "deep" ? "deep" : ""} ${strategy === s ? "active" : ""}`} onClick={() => setStrategy(s)}>
                  <span className="sd" />{lbl}
                </button>
              ))}
            </div>
          </div>

          <div className="budget-bar">
            <div className={`budget-fill ${budgetPct > 80 ? "warn" : ""}`} style={{ width: budgetPct + "%" }} />
          </div>

          <div className="code-wrap"
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleFileDrop(e.dataTransfer.files); }}
          >
            {!activeFile && (
              <div className="empty-drop">
                <div className="ed-icon">📂</div>
                <div className="ed-hint">Drop a file here or select from the sidebar<br/>Supports JS, TS, Python, CSS, HTML, and more</div>
              </div>
            )}
            {activeFile && (
              <textarea
                className="code-editor"
                value={activeFile.content}
                placeholder="Paste code here…"
                onChange={e => {
                  const content = e.target.value;
                  setFiles(prev => { const next = new Map(prev); next.set(activeId, { ...next.get(activeId), content, compressed: "", ctxMap: [], pseudo: "", tokenIn: estTok(content), status: "pending" }); return next; });
                }}
                spellCheck={false}
              />
            )}
          </div>

          {activeFile && (
            <div className="editor-meta">
              <span className="em-stat">Lines: <span>{activeFile.content.split("\n").length.toLocaleString()}</span></span>
              <span className="em-stat">Chars: <span>{activeFile.content.length.toLocaleString()}</span></span>
              <span className="em-stat">Context: <span>{budgetPct}%</span></span>
            </div>
          )}
        </div>

        {/* OUTPUT PANEL */}
        <div className="output-panel">
          <div className="out-hdr">
            <span className="out-filename">{activeFile?.name || "Output"}</span>
            <button className="btn btn-green btn-sm" id="copyBtn" onClick={copyOutput}>Copy</button>
          </div>

          <div className="out-tabs">
            {[["compressed","Output"],["diff","Diff"],["prompt","Prompt"],["bundle","Bundle"],["history","History"]].map(([t, lbl]) => (
              <button key={t} className={`out-tab ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>{lbl}</button>
            ))}
          </div>

          <div className="progress-strip">
            <div className="progress-fill" style={{ width: aiState ? aiState.progress + "%" : "0%" }} />
          </div>

          <div className="out-content">
            {/* COMPRESSED TAB */}
            {activeTab === "compressed" && (
              !activeFile?.compressed
                ? <div className="out-empty"><div className="oe-icon">⚡</div><p style={{ fontSize: "11px" }}>Press Compress to see output</p></div>
                : <textarea className="out-code" readOnly value={activeFile.compressed} />
            )}

            {/* DIFF TAB */}
            {activeTab === "diff" && (
              !activeFile?.compressed
                ? <div className="out-empty"><div className="oe-icon">⚡</div><p style={{ fontSize: "11px" }}>Compress a file to see diff</p></div>
                : <div className="scroll-view">
                    {activeFile.content.split("\n").slice(0, 40).map((line, i) => (
                      <div key={i} className="diff-line rem">- {line}</div>
                    ))}
                    {activeFile.compressed.split("\n").slice(0, 40).map((line, i) => (
                      <div key={i} className="diff-line add">+ {line}</div>
                    ))}
                    <div className="diff-line" style={{ color: "var(--muted)", marginTop: "6px" }}>
                      {activeFile.content.split("\n").length} → {activeFile.compressed.split("\n").length} lines
                    </div>
                  </div>
            )}

            {/* PROMPT TAB */}
            {activeTab === "prompt" && (
              !activeFile?.compressed
                ? <div className="out-empty"><div className="oe-icon">⚡</div><p style={{ fontSize: "11px" }}>Compress a file first</p></div>
                : <div className="scroll-view" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", color: "var(--text2)", fontSize: "11px" }}>
                    {buildPromptText(activeFile)}
                  </div>
            )}

            {/* BUNDLE TAB */}
            {activeTab === "bundle" && (
              done.length === 0
                ? <div className="out-empty"><div className="oe-icon">📦</div><p style={{ fontSize: "11px" }}>Compress files to build bundle</p></div>
                : <div className="scroll-view">
                    <div style={{ marginBottom: "12px", fontSize: "11px", color: "var(--muted)" }}>
                      {done.length} files · {totalIn.toLocaleString()} → {totalOut.toLocaleString()} tokens · <span style={{ color: "var(--green)" }}>-{Math.round((1 - totalOut / totalIn) * 100)}%</span>
                    </div>
                    {[...files.values()].filter(f => f.compressed).map((f, i) => (
                      <div key={i} className="bundle-block">
                        <div className="bundle-block-hdr">
                          <span style={{ fontFamily: "var(--mono)", color: "var(--text2)" }}>{f.name}</span>
                          <span style={{ color: "var(--green)" }}>{f.tokenIn}→{f.tokenOut} tok</span>
                        </div>
                        {f.pseudo && <div style={{ padding: "4px 10px", fontSize: "10px", color: "var(--text2)", fontStyle: "italic", borderTop: "1px solid var(--border)" }}>{f.pseudo}</div>}
                        <div className="bundle-block-code">{f.compressed.slice(0, 300)}{f.compressed.length > 300 ? "…" : ""}</div>
                      </div>
                    ))}
                  </div>
            )}

            {/* HISTORY TAB */}
            {activeTab === "history" && (
              history.length === 0
                ? <div className="out-empty"><div className="oe-icon">🕐</div><p style={{ fontSize: "11px" }}>No compressions yet</p></div>
                : <div className="scroll-view">
                    {history.map((h, i) => (
                      <div key={i} className="hist-entry">
                        <div className="hist-hdr" onClick={() => setOpenHistIdx(openHistIdx === i ? null : i)}>
                          <span style={{ fontSize: "10px", fontFamily: "var(--mono)", color: "var(--text2)", flex: 1 }}>{h.fileName}</span>
                          <span className="hist-badge">-{h.reduction}%</span>
                          <span style={{ fontSize: "9px", color: "var(--muted)" }}>{h.tokenIn}→{h.tokenOut}</span>
                          <span className="hist-ts">{fmtTime(h.ts)}</span>
                          <button className="btn btn-sm hist-restore" onClick={e => { e.stopPropagation(); restoreHistory(h); }}>Restore</button>
                        </div>
                        <div className={`hist-body ${openHistIdx === i ? "open" : ""}`}>{h.compressed.slice(0, 400)}{h.compressed.length > 400 ? "\n…" : ""}</div>
                      </div>
                    ))}
                  </div>
            )}
          </div>

          {/* STATS BAR */}
          {activeFile?.compressed && activeTab !== "history" && activeTab !== "bundle" && (
            <div className="stats-bar">
              <div className="stat-item"><div className="stat-lbl">Original</div><div className="stat-val">{activeFile.tokenIn.toLocaleString()}</div></div>
              <div className="stat-sep" />
              <div className="stat-item"><div className="stat-lbl">Compressed</div><div className="stat-val">{activeFile.tokenOut.toLocaleString()}</div></div>
              <div className="stat-sep" />
              <div className="stat-item"><div className="stat-lbl">Reduction</div><div className="stat-val green">{activeFile.tokenIn > 0 ? Math.round(((activeFile.tokenIn - activeFile.tokenOut) / activeFile.tokenIn) * 100) : 0}%</div></div>
              <div className="savings-badge">-{(activeFile.tokenIn - activeFile.tokenOut).toLocaleString()} tok</div>
            </div>
          )}

          {/* PSEUDO BAR */}
          {activeFile?.pseudo && (
            <div className="pseudo-bar">💡 {activeFile.pseudo}</div>
          )}

          {/* CTX DRAWER */}
          {activeFile?.ctxMap?.length > 0 && (
            <div className={`ctx-drawer ${ctxOpen ? "open" : ""}`}>
              <div className="ctx-drawer-hdr" onClick={() => setCtxOpen(o => !o)}>
                <span className="ctx-title">Context Map</span>
                <span className="ctx-badge">{activeFile.ctxMap.length}</span>
                <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--muted)" }}>{ctxOpen ? "▼" : "▲"}</span>
              </div>
              <div className="ctx-body">
                {activeFile.ctxMap.map((item, i) => (
                  <div key={i} className="ctx-item">
                    <span className="ctx-from">{item.from}</span>
                    <span className="ctx-arr">→</span>
                    <span className="ctx-to">{item.to}</span>
                    {item.source === "AI" && <span className="ctx-tag">AI</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PREFIX ROW */}
          {activeTab === "prompt" && (
            <div className="prefix-row">
              <span className="prefix-lbl">Prefix:</span>
              <input className="prefix-input" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="Add a prefix to your prompt…" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
