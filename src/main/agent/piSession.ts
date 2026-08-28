import type { AgentSessionEvent, ModelRuntime } from '@earendil-works/pi-coding-agent'

export interface RepoSession {
  prompt(text: string): Promise<void>
  subscribe(listener: (event: AgentSessionEvent) => void): () => void
  abort(): Promise<void>
}

export interface CreateRepoSessionOptions {
  cwd: string
  modelRuntime: ModelRuntime
  /**
   * Called before each tool executes; resolve true to let it run, false to
   * block it. The SDK's `tool_call` extension hook fires before execution
   * and can block -- this is what lets the app pause and ask the user.
   */
  requestApproval: (toolName: string, input: unknown) => Promise<boolean>
}

const AGENT_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const

export async function createRepoSession(
  options: CreateRepoSessionOptions
): Promise<{ repoSession: RepoSession; sessionId: string }> {
  const { createAgentSession, DefaultResourceLoader, getAgentDir } = await import(
    '@earendil-works/pi-coding-agent'
  )

  const resourceLoader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    extensionFactories: [
      (pi) => {
        pi.on('tool_call', async (event) => {
          const approved = await options.requestApproval(event.toolName, event.input)
          return approved ? { block: false } : { block: true, reason: 'Denied by user' }
        })
      }
    ]
  })

  const { session } = await createAgentSession({
    cwd: options.cwd,
    modelRuntime: options.modelRuntime,
    tools: [...AGENT_TOOLS],
    resourceLoader
  })

  return {
    sessionId: session.sessionId,
    repoSession: {
      prompt: (text: string) => session.prompt(text),
      subscribe: (listener) => session.subscribe(listener),
      abort: () => session.abort()
    }
  }
}
