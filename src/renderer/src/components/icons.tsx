interface IconProps {
  className?: string
}

export function LogoIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 512 512" fill="currentColor">
      <circle cx="228" cy="204" r="74" />
      <path d="M204 258 L296 258 L340 400 L232 400 Z" />
      <circle cx="228" cy="204" r="30" fill="var(--statusbar-bg, #fbfbf9)" />
    </svg>
  )
}

export function ChevronIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <path d="M5.5 3.5 10.5 8l-5 4.5v-9z" />
    </svg>
  )
}

export function FolderIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 3h4l1.5 1.5H14a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5H1.5a.5.5 0 0 1-.5-.5V3.5A.5.5 0 0 1 1.5 3z" />
    </svg>
  )
}

export function RepoIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="4.5" cy="3.5" r="1.4" />
      <circle cx="4.5" cy="12.5" r="1.4" />
      <circle cx="11.5" cy="8" r="1.4" />
      <path d="M4.5 4.9v6.2M4.5 8c3.5 0 3.5-2.8 6-2.8" strokeLinecap="round" />
    </svg>
  )
}

export function ExplorerIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <rect x="2.5" y="4.5" width="9" height="9" rx="1.2" opacity="0.55" />
      <rect x="4.5" y="2.5" width="9" height="9" rx="1.2" />
    </svg>
  )
}

export function GearIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm0 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z" />
      <path d="m6.6 1 .3 1.4c-.4.14-.77.33-1.12.56L4.6 2.2 2.2 4.6l.76 1.18c-.23.35-.42.72-.56 1.12L1 7.2v3.4l1.4.3c.14.4.33.77.56 1.12L2.2 13.4l2.4 2.4 1.18-.76c.35.23.72.42 1.12.56l.3 1.4h3.4l.3-1.4c.4-.14.77-.33 1.12-.56l1.18.76 2.4-2.4-.76-1.18c.23-.35.42-.72.56-1.12l1.4-.3V7.2l-1.4-.3a4.9 4.9 0 0 0-.56-1.12l.76-1.18-2.4-2.4-1.18.76a4.9 4.9 0 0 0-1.12-.56L9.8 1H6.6z" />
    </svg>
  )
}

export function SendIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.7 1.2 14.5 7.6a.5.5 0 0 1 0 .9L1.7 14.9a.5.5 0 0 1-.7-.6l2.3-6-2.3-6a.5.5 0 0 1 .7-.6zm1.6 2.1L4.8 8l-1.5 4.6L12.4 8 3.3 3.3z" />
    </svg>
  )
}

export function StopIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
    </svg>
  )
}

export function SpinnerIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="8" cy="8" r="6" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" strokeLinecap="round" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 8.5 6.5 12l6.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ErrorIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M7 1h2v6h6v2H9v6H7V9H1V7h6V1z" />
    </svg>
  )
}

export function SlashIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M9.5 5 6.5 11" strokeLinecap="round" />
    </svg>
  )
}

export function ChatIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
    >
      <path d="M2 3.5h12a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-.5.5H6.5L3.5 13V10.5H2a.5.5 0 0 1-.5-.5V4a.5.5 0 0 1 .5-.5z" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4.5 4.5 5 13.5a1 1 0 0 0 1 .9h4a1 1 0 0 0 1-.9l.5-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

