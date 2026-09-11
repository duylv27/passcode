# Changelog

All notable user-facing changes to PassCode are documented here, one section
per stable release. Snapshot/pre-release builds don't get an entry.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/),
adapted with [Spring Framework](https://github.com/spring-projects/spring-framework/releases)'s
emoji-categorized style:

- **⚠️ Breaking Changes** — only when a release actually has one
- **⭐ New Features**
- **🐞 Bug Fixes**
- **🔨 Improvements**

Each entry should be short, plain-language, and describe user-visible
behavior — not a raw commit message or implementation detail.

<!--
## [X.Y.Z] - YYYY-MM-DD
### ⭐ New Features
- ...
### 🐞 Bug Fixes
- ...
### 🔨 Improvements
- ...
-->

## [0.5.0] - 2026-09-11

### ⭐ New Features
- Passport switching is now available directly from the composer, alongside the model picker, instead of only in Settings.
- Added a Read-only mode alongside Auto and Manual — tool calls that only look around (read, search, list) run without a prompt, but anything that writes or executes still asks first.
- Composer supports attaching multiple files at once, and `@`-mentioning a file now offers fuzzy search with file-type icons.
- Hovering a model in the picker shows its pricing, context window, and reasoning support.
- Real per-account usage quota (e.g. GitHub Copilot) is now shown in its own Provider Stats popover, separate from Session Stats.

### 🐞 Bug Fixes
- Fixed picking a Passport for a different provider not updating the session's current model when that provider only had one Passport.
- Fixed the context-window override slider's maximum being wrong for large-context models.
- Removed dollar-cost figures on Passport usage and Session Stats that weren't actually reported by the provider.
- Fixed the model dropdown not reliably scrolling to the current model, and fighting manual scrolling once it did.
- Fixed the model-config tooltip running off the bottom of the window for models near the end of a long list.
- Fixed a confusing duplicate instructions message shown during OpenAI Codex sign-in.
- Fixed the `@`-mention file search surfacing files from `node_modules` and build output directories.

### 🔨 Improvements
- Switching Passports now only re-checks the provider actually involved instead of every configured provider, removing a noticeable delay.
- The model list and Copilot quota are now cached briefly so multiple open sessions don't repeat the same lookup.
- Session Stats now shows a token breakdown chart instead of raw numbers.
- Redesigned the composer toolbar: the reasoning-effort control is now a dropdown matching the model picker, and the tool-call duration/token chip uses color-coded, fixed-size badges instead of one long text string.
