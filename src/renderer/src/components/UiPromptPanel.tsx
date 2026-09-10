import { useEffect, useRef, useState } from 'react'
import type { UiPromptRequest } from '../../../shared/types'

/** Inline, non-blocking panel docked above the composer for extension-
 * raised select/confirm/input prompts (see piSession.ts's bindExtensions()
 * call) -- same "quiet card above the composer, not a full-screen modal"
 * pattern as ApprovalPanel, and reuses its Skip/Allow button styling for
 * visual consistency rather than inventing a parallel button language.
 *
 * Click-first by design: confirm is always two buttons (zero typing,
 * ever); select renders every option as its own clickable row plus one
 * "type your own answer" fallback row, revealed only if clicked; input is
 * the one primitive that's unavoidably typing-first, since it has no
 * options to click by definition. */
export function UiPromptPanel({
  requests,
  onRespond
}: {
  requests: UiPromptRequest[]
  onRespond: (requestId: string, value: string | boolean | undefined) => void
}): JSX.Element | null {
  const current = requests[0]
  const primaryRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [typingCustom, setTypingCustom] = useState(false)
  const [customText, setCustomText] = useState('')
  const [inputText, setInputText] = useState('')

  // Reset per-request UI state and focus the sensible default control
  // whenever a *different* request becomes current -- keyed on requestId,
  // not on `requests` itself, so it doesn't yank focus back mid-interaction
  // while the same request is still pending.
  useEffect(() => {
    setHighlightIndex(0)
    setTypingCustom(false)
    setCustomText('')
    setInputText('')
    if (!current) return
    if (current.kind === 'confirm') primaryRef.current?.focus()
    if (current.kind === 'input') inputRef.current?.focus()
  }, [current?.requestId])

  if (!current) return null

  // +1 for the trailing "type your own answer" row.
  const rowCount = current.kind === 'select' ? current.options.length + 1 : 0

  function selectOption(index: number): void {
    if (current.kind !== 'select') return
    if (index === current.options.length) {
      setTypingCustom(true)
      return
    }
    onRespond(current.requestId, current.options[index])
  }

  function submitCustom(): void {
    if (!customText.trim()) return
    onRespond(current.requestId, customText.trim())
  }

  function submitInput(): void {
    onRespond(current.requestId, inputText)
  }

  return (
    <div
      className="ui-prompt-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          // Typing a custom answer for a select prompt: back out to the
          // option list first, not straight past cancelling the whole
          // prompt -- one step of "undo" before the bigger one.
          if (current.kind === 'select' && typingCustom) {
            setTypingCustom(false)
            return
          }
          onRespond(current.requestId, current.kind === 'confirm' ? false : undefined)
          return
        }
        if (current.kind === 'select' && !typingCustom) {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setHighlightIndex((i) => (i + 1) % rowCount)
            return
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setHighlightIndex((i) => (i - 1 + rowCount) % rowCount)
            return
          }
          if (e.key === 'Enter') {
            e.preventDefault()
            selectOption(highlightIndex)
          }
        }
      }}
    >
      <div className="ui-prompt-title">{current.title}</div>

      {current.kind === 'confirm' && (
        <>
          <p className="ui-prompt-message">{current.message}</p>
          <div className="ui-prompt-actions">
            <button className="approval-skip" onClick={() => onRespond(current.requestId, false)}>
              No
            </button>
            <button ref={primaryRef} className="approval-allow" onClick={() => onRespond(current.requestId, true)}>
              Yes ↵
            </button>
          </div>
        </>
      )}

      {current.kind === 'select' && (
        <div className="ui-prompt-options" role="listbox">
          {current.options.map((option, index) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={index === highlightIndex}
              className={`ui-prompt-option${index === highlightIndex ? ' is-active' : ''}`}
              onMouseEnter={() => setHighlightIndex(index)}
              onClick={() => selectOption(index)}
            >
              {option}
            </button>
          ))}
          {!typingCustom ? (
            <button
              type="button"
              role="option"
              aria-selected={current.options.length === highlightIndex}
              className={`ui-prompt-option ui-prompt-option-custom${
                current.options.length === highlightIndex ? ' is-active' : ''
              }`}
              onMouseEnter={() => setHighlightIndex(current.options.length)}
              onClick={() => selectOption(current.options.length)}
            >
              Type your own answer…
            </button>
          ) : (
            <div className="ui-prompt-custom-row">
              <input
                autoFocus
                className="ui-prompt-custom-input"
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    submitCustom()
                  }
                }}
                placeholder="Type your answer…"
              />
              <button className="approval-allow" onClick={submitCustom} disabled={!customText.trim()}>
                Submit
              </button>
            </div>
          )}
        </div>
      )}

      {current.kind === 'input' && (
        <div className="ui-prompt-custom-row">
          <input
            ref={inputRef}
            className="ui-prompt-custom-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitInput()
              }
            }}
            placeholder={current.placeholder}
          />
          <button className="approval-allow" onClick={submitInput}>
            Submit ↵
          </button>
        </div>
      )}

      {requests.length > 1 && <div className="approval-panel-queue-hint">{requests.length - 1} more waiting</div>}
    </div>
  )
}
