# Pi Agent Desktop — Design

## Summary

A desktop coding agent application for SDLC tasks (coding, testing, review), organized around **projects** — named groups of local git repositories. Each repository gets its own agent session, powered by the [Pi SDK](https://pi.dev/docs/latest/sdk) (`@earendil-works/pi-coding-agent`) for AI interaction. Built with Electron, React, and TypeScript.

## Goals

- Manage multiple software projects, each spanning one or more local repos, from a single app.
- Chat with an AI coding agent scoped to a specific repo (file read/write/edit, shell commands).
- See git status (branch, changed files) for the repo the agent is working in.
- Support Anthropic and GitHub Copilot as model providers, with in-app sign-in.
- Stay lightweight and cross-platform (macOS + Windows), pure TypeScript/JavaScript — no Rust toolchain.

## Non-Goals (v1)

- Diff viewer (status list only, no per-file diff rendering).
- PR/CI integration (no GitHub PR creation, no CI trigger/status).
- Multiple sessions per repo (v1 assumes one active session per repo).
- Cross-repo shared context or orchestrated multi-repo workflows (each session is scoped to one repo).
- Model providers beyond Anthropic and GitHub Copilot.

## Architecture

```
┌─────────────────────────────────────────┐
│  Electron Main process (Node/TS)         │
│   - Pi SDK: createAgentSession per repo  │
│   - ModelRuntime: auth (Anthropic/Copilot)│
│   - SQLite (better-sqlite3): projects,   │
│     repos, sessions metadata             │
│   - simple-git for repo status           │
└───────────────────┬───────────────────────┘
                    │ IPC (contextBridge,
                    │ ipcMain.handle / ipcRenderer.invoke,
                    │ plus a subscribed event channel)
┌───────────────────▼───────────────────────┐
│  Renderer (React + TS)                    │
│   - project list / repo list              │
│   - chat view (streaming)                 │
│   - git status panel                      │
│   - settings (provider auth)              │
└─────────────────────────────────────────────┘
```

Electron was chosen over a Tauri (Rust) shell specifically to keep the stack pure TypeScript/JavaScript end to end, at the cost of a larger installed footprint (~150-200MB) than a Rust-based shell would have.

The Pi SDK runs directly in Electron's main process (which is a Node.js environment) — no sidecar process or additional IPC protocol is needed beyond Electron's own main/renderer bridge.

## Data Model

Persisted in a local SQLite database (`better-sqlite3`), stored in the app's user data directory.

- **`projects`**: `id`, `name`, `created_at`
- **`repos`**: `id`, `project_id` (FK), `path` (absolute filesystem path), `name`
- **`sessions`**: `id`, `repo_id` (FK), `pi_session_id` (reference into Pi's own session storage), `title`, `created_at`

Conversation history/messages are persisted through Pi SDK's own `SessionManager` (not hand-rolled) — the app stores only the pointer (`pi_session_id`) needed to resume a session.

A repo is validated as a git working directory (via `simple-git`) when added to a project.

## Core Flows

### Project & repo management
- Create a project (name only).
- Add one or more repos to a project by picking local folders; each is validated as a git repo.
- Projects and repos are listed in a sidebar; selecting a repo opens (or resumes) its session.

### Agent session
- Opening a repo creates/resumes a Pi agent session scoped to that repo:
  - `cwd` set to the repo's path.
  - `tools`: `read`, `bash` (or `powershell` on Windows), `edit`, `write`, `grep`, `find`, `ls`.
  - Model/provider comes from the current app-wide setting (see Settings below).
- Chat panel sends prompts via `session.prompt()` and renders streaming output from `session.subscribe()`:
  - `message_update` / `text_delta` events render assistant text incrementally.
  - `tool_execution_start` / `tool_execution_end` events render inline activity (e.g. "Running: bash `npm test`").
- One active session per repo in v1; reopening a repo resumes its existing session rather than starting a new one.

### Git status panel
- After each turn completes (`turn_end` event), the app re-reads git status for the active repo via `simple-git` and displays:
  - Current branch name.
  - List of changed / added / deleted files.
- No diff viewer in v1 — status list only.

### Settings & authentication
- A Settings screen lets the user choose the active provider: **Anthropic** or **GitHub Copilot**.
- **Anthropic**: user pastes an API key; stored via `ModelRuntime`'s runtime API key mechanism (`setRuntimeApiKey()`), matching Pi's own credential resolution.
- **GitHub Copilot**: user clicks "Sign in"; the app calls `ModelRuntime`'s `login()` for the Copilot provider and renders whatever device-code/verification-URL response it returns, polling until authentication resolves — mirroring the device-code flow Pi's own CLI `/login` uses today.
  - **Known risk**: the Pi SDK documentation confirms `login()` exists and persists credentials to `~/.pi/agent/auth.json`, but does not document its exact method signature or confirm it returns a device-code payload programmatically. This must be verified against the SDK's actual TypeScript types during implementation. If the device-code flow isn't exposed programmatically, the fallback is shelling out to the `pi` CLI's interactive `/login` for Copilot sign-in only, keeping the rest of the architecture unchanged.
- Once authenticated, credentials are resolved automatically by `ModelRuntime` for all subsequent sessions (no per-session re-auth).

## Error Handling

- Repo validation failures (folder isn't a git repo) block adding the repo, with an inline error in the add-repo UI.
- Agent/tool errors surface as an inline error message in the chat panel (not a crash), sourced from Pi SDK's own error events.
- Auth failures (invalid API key, failed Copilot login) surface as an inline error in Settings; the app remains usable for repos/providers that are already authenticated.

## Testing

- Unit tests for the SQLite data-access layer (projects/repos/sessions CRUD).
- Unit tests for git status parsing (`simple-git` wrapper).
- Integration test for the IPC contract between main and renderer (request/response shapes, event forwarding), using mocked Pi SDK session events.
- Manual verification for the two authentication flows (Anthropic API key, Copilot device-code login), since these depend on live external services.
