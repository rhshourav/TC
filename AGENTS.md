# OpenCode Architectural Routing Rules

## Model Delegation Protocol

Dynamically select between configured backends based on task complexity and nature.

---

### USE 21ST.DEV (claude-opus-4-6)

**For structural and reasoning tasks:**

- **Systems Architecture:** Broad planning, mapping folder structures, handling multi-file adjustments
- **Refactoring & Debugging:** Parsing error logs, reading stack traces, fixing broken code blocks
- **Conceptual Explanations:** Explaining complex engineering paradigms, documenting code
- **Code Review:** Analyzing existing code for issues, suggesting improvements
- **Documentation:** Writing README, API docs, inline comments

**Goal:** Leverage Claude Opus 4.6's deep reasoning for structural analysis and architectural decisions.

---

### USE 21ST.DEV (claude-sonnet-4-6)

**For precision code generation tasks:**

- **Code Generation:** Writing highly optimized UI components, full features, or algorithmic logic from scratch
- **Production-Ready Assets:** Bulletproof, production-grade snippets that work out of the box without boilerplate
- **Specialized Implementations:** Deep, technical code blocks requiring absolute precision
- **Performance-Critical Code:** Optimized algorithms, data structures, hot paths

**Goal:** Reserve Claude Sonnet 4.6 for intensive, high-value code writing with excellent instruction following.

---

### USE GOOGLE (gemini-3-pro)

**For broad analysis and exploration tasks:**

- **Codebase Exploration:** Fast file search, pattern matching, understanding project structure
- **Multi-file Analysis:** Scanning across large codebases for patterns and issues
- **Research:** Web searches, documentation lookup, API reference gathering

**Goal:** Use Gemini 3 Pro for fast, wide-scope analysis tasks where breadth matters more than depth.

---

## Routing Output Format

When executing a task, output:

```
🔀 Routing: [BACKEND] | Reason: [BRIEF JUSTIFICATION]
```

Then execute accordingly.

---

## Configured Backends

| Alias | Provider | Model ID | Use Case |
|-------|----------|----------|----------|
| gemini-3-pro | google | gemini-3-pro | Exploration, broad analysis, research |
| claude-opus-4-6 | twentyfirst | claude-opus-4-6 | Structural reasoning, architecture |
| claude-sonnet-4-6 | twentyfirst | claude-sonnet-4-6 | Code generation, production-ready assets |

## Setup

API keys are configured via environment variables:

```bash
# Set permanently (Windows PowerShell as Admin)
[System.Environment]::SetEnvironmentVariable("TWENTYFIRST_API_KEY", "your-key-here", "User")
[System.Environment]::SetEnvironmentVariable("GOOGLE_GENERATIVE_AI_API_KEY", "your-key-here", "User")
```

Run `opencode` after configuring. Use `/models` to verify models are available.
