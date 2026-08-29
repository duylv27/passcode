import { isValidElement, memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import { Mermaid } from './Mermaid'

function CodeBlock({
  className,
  children,
  streaming
}: {
  className?: string
  children?: ReactNode
  streaming?: boolean
}): JSX.Element {
  const raw = String(children ?? '').replace(/\n$/, '')
  const language = /language-(\w+)/.exec(className ?? '')?.[1]

  if (language === 'mermaid') return <Mermaid chart={raw} streaming={streaming} />

  let html: string
  try {
    html =
      language && hljs.getLanguage(language)
        ? hljs.highlight(raw, { language, ignoreIllegals: true }).value
        : hljs.highlightAuto(raw).value
  } catch {
    html = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  return (
    <pre className="md-pre">
      {/* eslint-disable-next-line react/no-danger */}
      <code className={`hljs${language ? ` language-${language}` : ''}`} dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  )
}

export const Markdown = memo(function Markdown({
  text,
  streaming
}: {
  text: string
  streaming?: boolean
}): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // A fenced code block always arrives here as <pre><code>, even with no language
        // (e.g. plain ``` ASCII art). Deciding block-vs-inline in `code` can't tell those
        // apart from real inline code, since neither has a `language-` className, so the
        // decision has to happen here where the wrapping `pre` is structurally guaranteed.
        pre: ({ children }) => {
          const codeEl = Array.isArray(children) ? children[0] : children
          if (isValidElement(codeEl)) {
            const codeProps = codeEl.props as { className?: string; children?: ReactNode }
            return (
              <CodeBlock className={codeProps.className} streaming={streaming}>
                {codeProps.children}
              </CodeBlock>
            )
          }
          return <>{children}</>
        },
        code: ({ children }) => <code className="md-inline-code">{children}</code>,
        a: ({ children, ...props }) => (
          <a {...props} target="_blank" rel="noreferrer">
            {children}
          </a>
        )
      }}
    >
      {text}
    </ReactMarkdown>
  )
})
