# Project Creation, Repo Picking, Info Badge, Rename/Delete — Design

## Problem

Project and repo management is currently the weakest part of the new always-visible sidebar:
creating a project is a bare inline text input for a name only, adding a repo means typing an
absolute filesystem path by hand (`/path/to/repo`) with no validation feedback until submit,
there's no way to see a project's repos/git status without expanding its box and reading each
repo's row individually, and there is no way to rename or delete a project at all from the UI
(`projects.delete` exists as a working IPC method but nothing ever calls it).

## Goals

- **Native folder picker.** A new `files.pickFolder()` IPC method (Electron's
  `dialog.showOpenDialog` with `properties: ['openDirectory']`) lets the user browse to a
  repo folder instead of typing its path. Used in two places: the new project-creation modal
  and the existing "Add repo" row on an already-created project's box.
- **Project creation as a modal.** "+ New project" opens a modal dialog (matching the existing
  `AboutDialog`/`SettingsPanel` overlay pattern) with a name field and a "Choose folder"
  button. Picking a folder auto-fills the name field with the folder's basename (still
  editable). Submitting creates the project and adds the picked folder as its repo in one
  action — matching the 1:1 project-repo model the app already migrated to.
- **Per-project info badge.** A small info icon on each project box's header opens a popup
  listing every repo in that project: name, absolute path, current git branch, and
  dirty/clean status (reusing the already-shipped `window.api.repos.gitStatus`).
- **Rename and delete a project.** Two icon buttons appear on a project box's header on hover
  (next to the existing "+" button), matching the hover-reveal pattern session rows already
  use for their own edit/delete icons. Rename edits the project's name inline. Delete prompts
  a native `confirm()` (no existing custom-confirm-dialog pattern exists in this codebase to
  match instead) before calling the already-wired `projects.delete`.

## Non-goals

- No change to the existing "Add repo" flow's *validation* behavior (still checks the folder
  is a git repo via `isGitRepo`, still shows an inline error on failure) — only its *input
  method* changes from a text field to a folder-picker button.
- No bulk operations (rename/delete multiple projects at once).
- No undo for project deletion — `confirm()` is the only safety net, matching the severity a
  native browser confirm conveys (deleting a project cascades to its repo(s) and every
  session in them).
- No change to session-level rename/delete, which already exist and are unaffected.
- The info badge popup is read-only (lists repos + git status) — it does not also host the
  rename/delete actions; those stay as separate header icons per the approved design.

## Approach

### Folder picker (main process)

`src/main/ipc/filesHandlers.ts`'s `FilesHandlersDeps` gains a second dialog function
alongside the existing `showOpenDialog`:

```typescript
export interface FilesHandlersDeps {
  showOpenDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
  showOpenFolderDialog: () => Promise<{ canceled: boolean; filePaths: string[] }>
}

export interface FilesHandlers {
  pickFile(): Promise<string | null>
  pickFolder(): Promise<string | null>
}
```

`pickFolder()` mirrors `pickFile()`'s existing shape exactly (canceled/empty → `null`,
otherwise the first path). In `src/main/index.ts`, the new dependency is wired as
`dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })`, alongside the
existing `openFile` one. New IPC channel `files:pickFolder`, exposed as
`window.api.files.pickFolder()` in preload, following the exact existing `files:pickFile`
pattern.

### Project rename (backend)

`ProjectsRepository` (`src/main/db/projectsRepository.ts`) gains `rename(id: string, name:
string): void`, implemented identically to `SessionsRepository.rename`'s existing
`UPDATE ... SET title = ? WHERE id = ?` shape (here: `UPDATE projects SET name = ? WHERE id =
?`). `ProjectsHandlers` gains `renameProject(id: string, name: string): void`, applying the
same non-empty-name guard `createProject` already uses. New IPC channel `projects:rename`,
exposed as `window.api.projects.rename(id, name)` in preload.

### Project creation modal

A new `NewProjectDialog.tsx` component (rendered by `ProjectExplorer.tsx` in place of its
current inline `.picker-inline-form`/"+ New project" row toggle) uses the existing
overlay/dialog CSS pattern (`.about-overlay`/`.about-dialog`-style: fixed inset, dark
backdrop, centered card, click-outside-to-close via `stopPropagation` on the inner card).
Contents: a name `<input>` (auto-filled from the picked folder's basename via `split(/[/\\]/)`,
matching how `RepoList.tsx`'s existing attachment-filename display already extracts a
basename elsewhere in this codebase), a "Choose folder" button calling the new
`window.api.files.pickFolder()`, the picked path shown as read-only text once chosen, and
Create/Cancel buttons. Create is disabled until both a name and a folder are present. On
submit: `window.api.projects.create(name)` then `window.api.repos.add(projectId, path)` —
if the repo-add step fails validation (not a git repo), the error surfaces inline in the
modal (matching the existing inline-error pattern in `ProjectBox`'s "Add repo" form) and the
modal stays open rather than leaving an empty, repo-less project behind silently.

### "Add repo" folder picker (existing flow, new input method)

`ProjectBox.tsx`'s existing "Add repo" inline form replaces its `<input placeholder="/path/to/repo">`
text field with a "Choose folder" button calling `window.api.files.pickFolder()`; the picked
path is stored and shown (read-only text, matching the new-project modal's same treatment)
before the existing `handleAddRepo`/`repos.add` call proceeds exactly as it does today.

### Info badge popup

A new `ProjectInfoDialog.tsx` component, opened via a new small info-icon button on
`ProjectBox`'s header (a new icon in `icons.tsx`, e.g. a circled "i"). Uses the same
overlay/dialog pattern as the new-project modal. On open, fetches `window.api.repos.list(project.id)`
and, for each repo, `window.api.repos.gitStatus(repo.id)` (parallel `Promise.all`, matching
`SessionList.tsx`'s existing per-repo gitStatus-fetch pattern) and renders one row per repo:
name, absolute path, branch, and a clean/dirty dot (reusing the existing `.repo-status-dot`
styling). A Close button; no other actions live in this popup per the Non-goals.

### Rename/delete on the project box header

`ProjectBox.tsx`'s header gains two new icon buttons, hover-revealed via the same CSS
technique `.session-row-edit`/`.session-row-delete` already use (`visibility:
hidden`/`visible` toggled by a `:hover` rule on the row, chosen there specifically to avoid a
layout-shift bug fixed earlier — the same technique applies here). Rename switches the header
into inline-edit mode (a text input replacing the label, matching `SessionList.tsx`'s
existing per-session rename UX) and calls the new `window.api.projects.rename`. Delete calls
`window.confirm('Delete "<project name>"? This also removes its repo(s) and every session in
them.')`; on confirm, calls the already-wired `window.api.projects.delete(project.id)` and
notifies `ProjectExplorer` to refetch (a callback prop, matching how session
delete/rename already notify their own parent).

## Testing

- Manual: click "+ New project", pick a folder via the native dialog, confirm the name field
  auto-fills with the folder's basename; edit the name; submit; confirm the project appears
  in the sidebar already containing that one repo.
- Manual: attempt to pick a folder that isn't a git repo when creating a project; confirm the
  inline error shows and the modal stays open.
- Manual: on an existing project's "Add repo" row, confirm it now opens a native folder
  picker instead of a text field, and the picked repo is added correctly.
- Manual: click a project's info badge; confirm it lists every repo in that project with
  correct path, branch, and dirty/clean status matching what's already shown elsewhere in
  the sidebar.
- Manual: hover a project box's header; confirm rename/delete icons appear next to "+";
  rename a project and confirm the new name persists and shows correctly; delete a project
  (with test data, not real data) and confirm the `confirm()` prompt appears, and only
  proceeds on acceptance.
- `ProjectsRepository.rename()` gets a real vitest test in
  `tests/main/db/projectsRepository.test.ts`, matching that file's existing coverage
  pattern for `create`/`delete`.
- No automated tests for the new renderer components/dialogs — consistent with this repo's
  established pattern (no jsdom; renderer changes verified by typecheck + manual interaction).
