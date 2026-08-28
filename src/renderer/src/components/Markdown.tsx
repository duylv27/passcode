import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import hljs from 'highlight.js'
import { Mermaid } from './Mermaid'

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }): JSX.Element {
  const raw = String(children ?? '').replace(/\n$/, '')
  const language = /language-(\w+)/.exec(className ?? '')?.[1]

  if (language === 'mermaid') return <Mermaid chart={raw} />

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

export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          if (className?.includes('language-')) {
            return <CodeBlock className={className}>{children}</CodeBlock>
          }
          return <code className="md-inline-code">{children}</code>
        },
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
}
