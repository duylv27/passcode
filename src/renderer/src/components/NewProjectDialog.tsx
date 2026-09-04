import { useState } from 'react'

interface Props {
  onClose: () => void
  onCreated: () => void
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function NewProjectDialog({ onClose, onCreated }: Props): JSX.Element {
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  async function handleChooseFolder(): Promise<void> {
    const picked = await window.api.files.pickFolder()
    if (!picked) return
    setFolderPath(picked)
    if (!nameEdited) setName(basename(picked))
  }

  async function handleCreate(): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed || !folderPath || creating) return
    setCreating(true)
    setError(null)
    let createdProjectId: string | null = null
    try {
      const project = await window.api.projects.create(trimmed)
      createdProjectId = project.id
      const result = await window.api.repos.add(project.id, folderPath)
      if (!result.ok) {
        await window.api.projects.delete(project.id)
        setError(result.error)
        setCreating(false)
        return
      }
      setCreating(false)
      onCreated()
    } catch (err) {
      if (createdProjectId) {
        await window.api.projects.delete(createdProjectId).catch(() => {})
      }
      setError(err instanceof Error ? err.message : String(err))
      setCreating(false)
    }
  }

  return (
    <div className="new-project-overlay" onClick={creating ? undefined : onClose}>
      <div className="new-project-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="new-project-title">New Project</div>
        <input
          className="field"
          autoFocus
          value={name}
          onChange={(e) => {
            setNameEdited(true)
            setName(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim() && folderPath && !creating) handleCreate()
          }}
          placeholder="Project name"
        />
        <div className="new-project-folder-row">
          <button className="btn" onClick={handleChooseFolder} disabled={creating}>
            Choose folder…
          </button>
          {folderPath && (
            <span className="new-project-folder-path" title={folderPath}>
              {folderPath}
            </span>
          )}
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="new-project-actions">
          <button className="btn" onClick={onClose} disabled={creating}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!name.trim() || !folderPath || creating}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  )
}
