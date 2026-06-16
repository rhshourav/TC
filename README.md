<div align="center">

<img src="docs/og-image.png" alt="TokenCrush Banner" width="100%" style="border-radius:12px" />

<br />

# ⚡ TokenCrush

**Smart Code Compressor for Claude — paste more, burn less context.**

[![Deploy Status](https://img.shields.io/github/actions/workflow/status/rhshourav/tokencrush/deploy.yml?branch=main&label=deploy&style=flat-square&color=7c6dfa)](https://github.com/rhshourav/tokencrush/actions)
[![Live Site](https://img.shields.io/badge/live-tokencrush.github.io-3ecf8e?style=flat-square)](https://rhshourav.github.io/tokencrush)
[![License](https://img.shields.io/github/license/rhshourav/tokencrush?style=flat-square&color=a393ff)](LICENSE)
[![Single File](https://img.shields.io/badge/zero_deps-single_html-f5a623?style=flat-square)](#)

</div>

---

## What is it?

TokenCrush is a **zero-dependency, single-file web app** that strips your code down before you paste it into a Claude prompt. Drop in your files, choose a compression strategy, and get back a tighter version — with a live token counter, a diff viewer, and a ready-to-paste prompt bundle.

It runs entirely in the browser. No server. No install. No data leaves your machine (unless you turn on AI mode, which calls the Anthropic API directly from your client).

---

## Features

**File handling** — drag-and-drop individual files or whole `.zip` archives. Supports JS/TS, HTML, CSS/SCSS/SASS, Python, JSON, Markdown, and more. Each file gets its own status indicator so you know what's been processed at a glance.

**Local compression engine** — three independent toggles you can mix and match:
- Strip comments (handles JS block/line comments and HTML `<!-- -->` correctly, string-aware so it won't eat regex or template literals)
- Collapse whitespace (language-aware: different rules for HTML, CSS, and general code)
- Rename identifiers (minifies long variable/function names to 2-char aliases, skips all JS reserved words and browser globals)

**AI compression modes** — optionally calls `claude-sonnet-4-6` for deeper compression:
- **Pseudo** — compresses and returns a 2-sentence summary of what the file does
- **Semantic** — rewrites with ternaries, destructuring, and method chaining while keeping 100% logical equivalence
- **Deep** — most aggressive: renames identifiers, collapses everything, outputs a full identifier map

**Context map** — whenever identifiers are renamed (locally or by AI), a collapsible drawer lists every `originalName → _x` mapping so Claude can still reason about your code.

**Output tabs** — four views on the result:
- `Compressed` — the raw output, copyable
- `Diff` — red/green line-by-line diff against the original
- `Prompt` — output wrapped in a ready-to-paste Claude prompt block with your custom prefix
- `Bundle` — all loaded files combined into a single structured prompt block

**Stats bar** — shows input tokens, output tokens, percentage saved, and a colour-coded gauge (green → amber → red) based on how much of the original context you're still using.

**Theme** — light/dark toggle with system-preference detection and `localStorage` persistence. The correct theme is applied before first paint to prevent flash.

**Keyboard shortcut** — `Cmd/Ctrl + Enter` compresses the active file instantly.

---

## Getting Started

No build step. Just open `docs/index.html` in a browser — or visit the live site:

**[https://rhshourav.github.io/tokencrush](https://rhshourav.github.io/tokencrush)**

### Using AI mode

AI compression calls the Anthropic API from your browser. You'll need an API key with access to `claude-sonnet-4-6`. The key is never stored — it lives only in the current session.

> AI mode is optional. The local engine alone typically saves 30–60% of tokens.

---

## Repository Layout

```
tokencrush/
├── .github/
│   └── workflows/
│       └── deploy.yml        # Validate + deploy to GitHub Pages
├── docs/                     # Everything served as the live site
│   ├── index.html            # The entire app — HTML, CSS, JS in one file
│   ├── 404.html              # Custom 404 page
│   ├── og-image.png          # Open Graph social preview (1200×630)
│   ├── apple-touch-icon.png  # iOS home screen icon (180×180)
│   ├── robots.txt            # Search crawler rules
│   └── gen_assets.py         # Script to (re)generate PNG assets
├── img/
│   └── baner.png             # Source banner for README / marketing
├── .gitignore
├── LICENSE
└── README.md
```

---

## CI / CD

Every push and pull request to `main` runs the validation job. Deployment only happens on a direct push to `main`.

```
push / PR to main
       │
       ▼
┌─────────────────────────────────┐
│  validate                       │
│  ├─ html-validate docs/index.html│
│  ├─ asset existence check       │
│  └─ broken local href check     │
└────────────────┬────────────────┘
                 │  (main push only)
                 ▼
┌─────────────────────────────────┐
│  deploy                         │
│  └─ docs/ → GitHub Pages        │
└─────────────────────────────────┘
```

The workflow file lives at `.github/workflows/deploy.yml`. See it for full details.

---

## Supported File Types

| Language | Extensions |
|---|---|
| JavaScript / TypeScript | `.js` `.jsx` `.ts` `.tsx` `.mjs` `.cjs` |
| HTML | `.html` `.htm` |
| CSS | `.css` `.scss` `.sass` `.less` |
| Python | `.py` |
| Other text | `.json` `.md` `.txt` `.yaml` `.yml` |
| Archives | `.zip` (extracted automatically) |

---

## How Token Estimation Works

TokenCrush estimates token count as `ceil(characters / 3.8)` — a reasonable approximation of Claude's tokenizer for mixed code. The exact count Claude sees may differ slightly, but the savings percentage is consistent and useful for comparing strategies.

---

## Contributing

1. Fork and clone the repo
2. Edit `docs/index.html` directly — everything is in one file
3. Open it locally in a browser to test (no build step needed)
4. Open a PR against `main` — the CI will lint and check assets automatically

Please keep the single-file constraint. The whole point is zero friction to deploy and share.

---

## License

[MIT](LICENSE) — free to use, fork, and embed.

---

<div align="center">

Made by [**@rhshourav**](https://github.com/rhshourav)

*If TokenCrush saved you some context window, consider starring the repo ⭐*

</div>
