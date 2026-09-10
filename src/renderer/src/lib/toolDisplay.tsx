import {
  EditIcon,
  FolderIcon,
  ListIcon,
  ReadIcon,
  SearchIcon,
  TerminalIcon,
  WriteIcon
} from '../components/icons'

/** Per-tool-type icon, shared between the transcript timeline and the
 * approval panel so a "bash" call always reads as the same terminal glyph
 * wherever it shows up. A tool name with no entry here has no icon (falls
 * back to a plain marker at the call site). */
export const TOOL_ICONS: Record<string, (props: { className?: string }) => JSX.Element> = {
  read: ReadIcon,
  write: WriteIcon,
  edit: EditIcon,
  grep: SearchIcon,
  find: FolderIcon,
  ls: ListIcon,
  bash: TerminalIcon,
  powershell: TerminalIcon
}

const TOOL_ACTION_LABELS: Record<string, string> = {
  read: 'Read file',
  edit: 'Edit file',
  write: 'Create file',
  grep: 'Search text',
  find: 'Find files',
  ls: 'List directory',
  bash: 'Run command',
  powershell: 'Run command'
}

/** A plain-English name for the action, shown in place of the raw tool
 * identifier so the card reads as "what happened" at a glance. */
export function toolActionLabel(toolName: string): string {
  return TOOL_ACTION_LABELS[toolName] ?? toolName
}

/** A short, human-readable description of what the call is doing --
 * the file path, search pattern, or shell command, not the raw JSON args. */
export function summarizeToolCall(toolName: string, args: unknown): string | null {
  const a = args as Record<string, unknown> | undefined
  if (!a) return null
  switch (toolName) {
    case 'bash':
    case 'powershell':
      return typeof a.command === 'string' ? a.command : null
    case 'read':
    case 'edit':
    case 'write':
    case 'ls':
      return typeof a.path === 'string' ? a.path : null
    case 'grep':
    case 'find':
      return typeof a.pattern === 'string' ? a.pattern : null
    default:
      return null
  }
}

/** A full sentence describing the action, for contexts (like the approval
 * panel) that need a complete thought rather than just a label + summary. */
export function describeToolAction(toolName: string, args: unknown): string {
  const summary = summarizeToolCall(toolName, args)
  if (toolName === 'read') return summary ? `Read the file ${summary}` : 'Read a file'
  if (toolName === 'edit') return summary ? `Update ${summary}` : 'Update a file'
  if (toolName === 'write') return summary ? `Create ${summary}` : 'Create a file'
  if (toolName === 'grep') return summary ? `Search the codebase for ${summary}` : 'Search the codebase'
  if (toolName === 'find') return summary ? `Find files matching ${summary}` : 'Find files'
  if (toolName === 'ls') return summary ? `List the directory ${summary}` : 'List a directory'
  if (toolName === 'bash' || toolName === 'powershell') return summary ? `Run the command ${summary}` : 'Run a command'
  return `Run the ${toolName} action`
}

/** Tools whose failure mode is destructive/hard-to-undo rather than merely
 * "wrong" -- used to give the approval panel a sharper visual/verbal nudge
 * than a routine read or search would need, per-tool, not per-call (we
 * don't parse shell commands to guess intent; a bash call is flagged
 * regardless of what the command actually does). */
export const HIGH_IMPACT_TOOLS = new Set(['bash', 'powershell', 'write', 'edit'])
