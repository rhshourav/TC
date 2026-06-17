# Contributing to TokenCrush

Thanks for your interest in contributing! This guide covers everything you need to know.

---

## Quick Start

```bash
git clone https://github.com/rhshourav/tc.git
cd tc
# Open docs/index.html in your browser — no build step needed
```

Edit files in `docs/js/` and refresh the browser. That's it.

---

## Project Structure

```
docs/js/
├── app.js              # Entry point — wires everything together
├── core/               # Core logic
│   ├── engine.js       # Compression pipeline (addFile, compressFileById, etc.)
│   ├── state.js        # Global state (files Map, folders Map, activeFileId)
│   ├── config.js       # Constants (CLAUDE_CTX, MAX_RENAME_COUNT, etc.)
│   └── helpers.js      # Utilities (uid, escH, estTok, fmtBytes)
├── languages/          # Language definitions
│   ├── registry.js     # registerLanguage(), getLanguage(), isCompressible()
│   ├── javascript.js   # JS/TS
│   ├── c-cpp.js        # C/C++
│   ├── css.js          # CSS/SCSS
│   ├── html.js         # HTML
│   ├── python.js       # Python
│   └── other.js        # JSON, MD, YAML, etc.
├── passes/             # Compression passes
│   ├── registry.js     # registerPass(), runPasses(), setPassEnabled()
│   ├── comments.js     # Comment stripping (language-aware)
│   ├── whitespace.js   # Whitespace optimization
│   └── identifiers.js  # Identifier minification
├── ai/                 # AI layer
│   └── compressor.js   # Anthropic API calls
└── ui/                 # UI modules
    ├── sidebar.js      # File list, folder tree, drag-and-drop
    ├── editor.js       # Code editor, token pill, budget bar
    ├── output.js       # Output tabs, diff, prompt, bundle, history
    ├── theme.js        # Light/dark toggle
    └── find.js         # Find & replace
```

---

## How to Add a New Language

### 1. Create the language file

Create `docs/js/languages/mylang.js`:

```javascript
import { registerLanguage } from './registry.js';

registerLanguage('rust', {
  name: 'Rust',
  extensions: ['rs'],           // File extensions to match
  icon: '🦀',                   // Emoji for file list
  badgeClass: 'lang-rust',      // CSS class for badge color
  supportsIdRenaming: true,     // Can we safely rename identifiers?
  commentStyle: 'c-style',      // 'c-style' | 'python' | 'html' | null
  whitespaceRules: 'c-style'    // Passed to whitespace pass
});
```

### 2. Add comment stripping (if needed)

If your language uses non-standard comments, add a case in `docs/js/passes/comments.js`:

```javascript
// In the registerPass('Comments', { run(code, lang) { ... } }) function:
case 'rust':
  return stripCStyleComments(code);  // Rust uses // and /* */
```

### 3. Add whitespace rules (if needed)

Add a case in `docs/js/passes/whitespace.js`:

```javascript
case 'rust':
  return stripWhitespaceC(code);  // Rust uses C-style braces
```

### 4. Add reserved words (if identifier renaming is supported)

Add a reserved word Set in `docs/js/passes/identifiers.js`:

```javascript
const RUST_RESERVED = new Set([
  'fn', 'let', 'mut', 'pub', 'use', 'mod', 'struct', 'enum', 'impl',
  'trait', 'self', 'Self', 'super', 'crate', 'as', 'break', 'continue',
  // ... add all keywords + std lib names
]);

// Then add to the reservedSets map:
const reservedSets = {
  js: JS_RESERVED,
  c: C_CPP_RESERVED,
  cpp: C_CPP_RESERVED,
  'c-cpp': C_CPP_RESERVED,
  py: PYTHON_RESERVED,
  rust: RUST_RESERVED,
};
```

### 5. Register the import

Add to `docs/js/languages/index.js`:

```javascript
import './rust.js';
```

### 6. Add CSS badge (optional)

Add to `docs/styles.css`:

```css
.lang-rust{background:rgba(222,165,95,.15);color:#dea55f;border:1px solid rgba(222,165,95,.25)}
```

### 7. Update HTML file input (optional)

Add extensions to the `accept` attribute in `docs/index.html`:

```html
<input type="file" accept=".js,...,.rs" ...>
```

---

## How to Add a New Compression Pass

### 1. Create the pass

Create `docs/js/passes/myformat.js` or add to an existing file:

```javascript
import { registerPass } from './registry.js';

registerPass('MyPass', {
  name: 'My Pass',
  description: 'Does something useful',
  order: 4,                          // Execution order (after comments=1, whitespace=2, identifiers=3)
  requiresLang: null,                // null = all languages, or 'js', 'c-cpp', etc.
  run(code, lang, options) {
    // Transform the code
    const result = code.replace(/foo/g, 'bar');
    return result;                    // Return string, or { code, ctxMap } for passes that rename
  }
});
```

### 2. Register the import

Add to `docs/js/passes/index.js`:

```javascript
import './myformat.js';
```

---

## How to Add a New Output Tab

### 1. Add the tab button in `docs/index.html`

```html
<div class="out-tab" data-tab="mytab" onclick="switchTab('mytab',this)">
  <span class="tab-icon">🔧</span>My Tab
</div>
```

### 2. Add the content area

```html
<div class="my-tab-view" id="myTabView"></div>
```

### 3. Add a case in `docs/js/ui/output.js`

In the `switchTab()` function:

```javascript
case 'mytab': buildMyTab(); break;
```

And add the builder:

```javascript
function buildMyTab() {
  const view = document.getElementById('myTabView');
  if (!view) return;
  view.innerHTML = '<div class="my-content">...</div>';
}
```

### 4. Style it in `docs/js/ui/output.js`

```javascript
document.querySelectorAll('.out-content > div').forEach(d => d.classList.remove('show'));
const tabMap = { ..., mytab: 'myTabView' };
```

---

## Code Style

- **No build step** — use ES modules (`import`/`export`), no bundlers
- **No external dependencies** — everything is vanilla JS
- **Browser-first** — test in Chrome/Firefox/Safari
- **Functional where possible** — avoid classes, prefer pure functions
- **String escaping** — use `escH()` for innerHTML, `escAttr()` for attributes
- **Reserved words** — always maintain comprehensive sets per language

---

## Pull Request Process

1. **Fork** the repo
2. **Create a branch** from `main`: `git checkout -b feat/my-feature`
3. **Make your changes** in `docs/js/`
4. **Test** by opening `docs/index.html` in a browser
5. **Run validation**: `npx html-validate@8 docs/index.html`
6. **Commit** with a clear message: `git commit -m "feat: add Rust language support"`
7. **Push** and open a PR against `main`

### PR Guidelines

- Keep changes focused — one feature or fix per PR
- Add reserved words if adding a new language
- Test compression on sample files before submitting
- Update README.md if adding new features
- Follow existing code style

---

## Reporting Issues

Open an issue with:
- What you expected
- What happened
- Steps to reproduce
- Browser and OS info

---

## Questions?

Open a discussion or ping **@rhshourav** on GitHub.
