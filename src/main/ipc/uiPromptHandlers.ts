import { randomUUID } from 'node:crypto'
import type { UiPromptRequest } from '../../shared/types'

export interface CreateUiPromptHandlersDeps {
  onRequest: (request: UiPromptRequest) => void
  /** Told about a request that timed out or whose signal aborted, so it
   * can push the same `uiPrompt:cancel` event the renderer listens for
   * to drop that request from its queue without treating it as an
   * answer. */
  onCancel: (requestId: string) => void
}

export interface UiPromptHandlers {
  /** Resolves `undefined` immediately without ever emitting a request --
   * matches the SDK's own behavior for a degenerate call and avoids
   * showing a useless empty picker. */
  requestSelect(
    sessionId: string,
    title: string,
    options: string[],
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<string | undefined>
  requestConfirm(
    sessionId: string,
    title: string,
    message: string,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<boolean>
  requestInput(
    sessionId: string,
    title: string,
    placeholder: string | undefined,
    timeoutMs?: number,
    signal?: AbortSignal
  ): Promise<string | undefined>
  respond(requestId: string, value: string | boolean | undefined): void
}

export function createUiPromptHandlers(deps: CreateUiPromptHandlersDeps): UiPromptHandlers {
  const pending = new Map<string, { resolve: (value: unknown) => void; fallback: unknown }>()

  // One unified "this prompt is no longer relevant" path for both a
  // timeout and an aborted signal -- not two separate ones.
  function cancel(requestId: string): void {
    const entry = pending.get(requestId)
    if (!entry) return
    pending.delete(requestId)
    deps.onCancel(requestId)
    entry.resolve(entry.fallback)
  }

  function request<T>(
    emit: (requestId: string) => UiPromptRequest,
    fallback: T,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined
  ): Promise<T> {
    return new Promise((resolve) => {
      const requestId = randomUUID()
      let timer: ReturnType<typeof setTimeout> | undefined
      pending.set(requestId, {
        resolve: (value) => {
          if (timer) clearTimeout(timer)
          resolve(value as T)
        },
        fallback
      })
      // Main-side timer/listener is authoritative -- the renderer shows a
      // matching visual countdown for UX, but if its own dismiss event is
      // somehow lost, this still resolves correctly since main (not the
      // renderer) owns the actual timeout/abort.
      if (timeoutMs !== undefined) {
        timer = setTimeout(() => cancel(requestId), timeoutMs)
      }
      signal?.addEventListener('abort', () => cancel(requestId), { once: true })
      deps.onRequest(emit(requestId))
    })
  }

  return {
    requestSelect(sessionId, title, options, timeoutMs, signal) {
      if (options.length === 0) return Promise.resolve(undefined)
      return request<string | undefined>(
        (requestId) => ({ requestId, sessionId, kind: 'select', title, options }),
        undefined,
        timeoutMs,
        signal
      )
    },
    requestConfirm(sessionId, title, message, timeoutMs, signal) {
      return request<boolean>(
        (requestId) => ({ requestId, sessionId, kind: 'confirm', title, message }),
        false,
        timeoutMs,
        signal
      )
    },
    requestInput(sessionId, title, placeholder, timeoutMs, signal) {
      return request<string | undefined>(
        (requestId) => ({ requestId, sessionId, kind: 'input', title, placeholder }),
        undefined,
        timeoutMs,
        signal
      )
    },
    respond(requestId, value) {
      const entry = pending.get(requestId)
      if (!entry) return
      pending.delete(requestId)
      entry.resolve(value)
    }
  }
}
