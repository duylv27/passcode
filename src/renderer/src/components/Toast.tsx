import { useEffect } from 'react'

export interface ToastMessage {
  id: string
  text: string
  variant: 'success' | 'error'
}

/** One floating, auto-dismissing notification. Each instance owns its own
 * dismiss timer so a stack of several toasts clears independently rather
 * than all resetting whenever a new one arrives. */
function Toast({ message, onDismiss }: { message: ToastMessage; onDismiss: (id: string) => void }): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(message.id), 3000)
    return () => clearTimeout(timer)
  }, [message.id, onDismiss])

  return (
    <div className={`toast toast-${message.variant}`} role="status">
      {message.text}
    </div>
  )
}

/** Anchor point for a stack of toasts. The parent must have
 * `position: relative` (or be the viewport) for the stack's
 * `position: absolute` placement to anchor correctly. */
export function ToastStack({
  messages,
  onDismiss
}: {
  messages: ToastMessage[]
  onDismiss: (id: string) => void
}): JSX.Element {
  return (
    <div className="toast-stack">
      {messages.map((m) => (
        <Toast key={m.id} message={m} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
