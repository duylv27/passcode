# Timeline Tool-Call Icons — Design Spec

**Goal:** Replace the plain colored status dot in front of each tool-call
row in the chat timeline with a small icon specific to that tool, so a
glance at the timeline shows what kind of action happened (read, edit,
search, shell command...) without reading the label text. The current
generic dot-on-a-line look is one of the things that reads as "looks like
Claude [Code]" per the user's own words — this fix is scoped to just that
marker, not a broader timeline redesign.

## Current state

`TimelineRow` (`src/renderer/src/components/ChatPanel.tsx:1245`) renders a
`<span className={`timeline-dot is-${item.status}`} />` for every tool-call
row. `.timeline-dot` (`src/renderer/src/theme.css:1193`) is an 8px circle,
absolutely positioned at the left edge of the row, whose `background`
color switches between `--accent` (running, pulsing), `--success` (done),
and `--danger` (error) via the `.is-running`/`.is-done`/`.is-error`
modifier classes. Thinking rows (`item.kind === 'thinking'`) render the
same dot but with a plain, unmodified/muted style (no status coloring) —
they are out of scope for this change and keep their current marker
untouched.

## Design

Replace the `<span className="timeline-dot ...">` for tool-call rows only
with a small (12×12) SVG icon chosen by `item.toolName`, styled the same
way every other icon in `icons.tsx` is: `viewBox="0 0 16 16"`,
`stroke="currentColor"`, `strokeWidth="1.4"`, `fill="none"`. Status is
still conveyed by color — the wrapping element keeps the
`is-running`/`is-done`/`is-error` class and sets `color` to
`--accent`/`--success`/`--danger` respectively (CSS `color`, which
`currentColor` picks up inside the SVG), including the existing
`status-pulse` opacity animation while running. The icon replaces the dot
in the exact same absolute position (`left: -18px; top: 6px`) so the
timeline's connector line and row layout are otherwise untouched.

**Icon → tool mapping** (new icons added to `src/renderer/src/components/icons.tsx`,
following the existing 12×12/viewBox-16×16/stroke-1.4 convention):

| Tool name(s) | Icon | Shape |
|---|---|---|
| `read` | `ReadIcon` (new) | a page/document outline with a couple of short horizontal lines (text) |
| `write` | `WriteIcon` (new) | a page/document outline with a small `+` in the corner |
| `edit` | *(reuse existing `EditIcon`)* | the pencil glyph already in `icons.tsx:174` |
| `grep` | `SearchIcon` (new) | a magnifying glass |
| `find` | `FolderIcon` (new) | a folder outline |
| `ls` | `ListIcon` (new) | three short horizontal lines (a simple list) |
| `bash`, `powershell` | `TerminalIcon` (new) | a rounded rectangle containing a `>` chevron |

Any tool name not in this table (a future/custom tool) falls back to
keeping the current plain dot — never render a missing icon as blank.

## Non-goals

- No change to thinking-row markers, row layout, summary/diffstat/metrics
  text, or the expand/collapse behavior — this is the marker glyph only.
- No change to the timeline connector line or row spacing.
- No new tool-call *behavior* — purely a visual swap of one element.
