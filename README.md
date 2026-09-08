# PassCode

A project-oriented desktop app for working with an AI coding agent, built on
the [Pi SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
(Electron + React + TypeScript).

PassCode organizes work into **projects → repos → sessions**: each session
is a chat with the agent scoped to a specific repo, with full tool
visibility (file edits, shell commands, greps) and per-tool approval
control.

## Features

- **Chat with an agent** that can read, edit, and run commands in your repo,
  with collapsible tool-call detail and diff previews for edits.
- **Model picker** across configured providers (Anthropic, GitHub Copilot,
  and others exposed by the Pi SDK), with per-provider auth in Settings.
- **Context window control** — a live usage badge in the composer shows
  tokens used vs. the model's context window, with manual "Compact now",
  an auto-compaction toggle, and a per-session override for testing.
- **Tool approval policies** — auto-approve per tool, or approve each call
  as it happens.
- **GitHub Copilot quota display** and **usage telemetry export** (OTel-
  compatible JSONL) for tracking model usage over time.
- **Paste-image support** in the composer for screenshots and mockups.

## Requirements

- Node.js ≥ 22.19.0
- Windows (current build target; see `package.json`'s `build.win` config)

## Getting started

```bash
npm install
npm run dev
```

This starts the Vite dev server for the renderer and launches the Electron
app pointed at it, with hot reload.

## Building a release

```bash
npm run dist:win     # build the NSIS installer locally, unpublished
npm run release:win  # build and publish to GitHub Releases (needs GH_TOKEN)
```

Pushing a tag matching `v*.*.*` runs [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds, tests, and publishes the Windows installer to a GitHub
Release automatically.

## Testing

```bash
npm test
```

## Project structure

```
src/
  main/       Electron main process — IPC handlers, agent session
              management, SQLite-backed repositories
  preload/    Context-bridge API exposed to the renderer
  renderer/   React UI (chat panel, settings, project/session sidebar)
  shared/     Types shared between main and renderer
```

## License

Private — all rights reserved.
