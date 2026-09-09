interface IconProps {
  className?: string
}

export function LogoIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
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

export function EditIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M10.5 2.5 13.5 5.5 5.5 13.5H2.5V10.5Z" strokeLinejoin="round" />
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

export function CloseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  )
}

export function ZoomInIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.3 10.3 14 14M7 4.8v4.4M4.8 7h4.4" strokeLinecap="round" />
    </svg>
  )
}

export function ZoomOutIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.3 10.3 14 14M4.8 7h4.4" strokeLinecap="round" />
    </svg>
  )
}

export function MenuIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" strokeLinecap="round" />
    </svg>
  )
}

export function MinimizeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M3 12h10" strokeLinecap="round" />
    </svg>
  )
}

export function MaximizeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="3.5" y="3.5" width="9" height="9" rx="0.5" />
    </svg>
  )
}

export function RestoreIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="5.5" y="2.5" width="7" height="7" rx="0.5" />
      <path d="M3.5 5.5v7a1 1 0 0 0 1 1h7" />
    </svg>
  )
}

export function RepoPlusIcon({ className }: IconProps): JSX.Element {
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
      <circle cx="3.5" cy="3.5" r="1.4" />
      <circle cx="3.5" cy="12.5" r="1.4" />
      <path d="M3.5 4.9v6.2" strokeLinecap="round" />
      <path d="M9.5 8h5M12 5.5v5" strokeLinecap="round" />
    </svg>
  )
}

export function PinIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="8" cy="6" r="3.2" />
      <path d="M8 9.2V14" strokeLinecap="round" />
    </svg>
  )
}

export function MoreIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="8" cy="3.2" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="8" cy="12.8" r="1.4" />
    </svg>
  )
}

export function InfoIcon({ className }: IconProps): JSX.Element {
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
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="5.2" r="0.9" fill="currentColor" stroke="none" />
      <path d="M8 7.5v4" strokeLinecap="round" />
    </svg>
  )
}

// Official provider marks (path data from simple-icons.org, MIT-licensed) --
// fill="currentColor" so each renders in whatever color the caller sets,
// rather than baking in a brand hex.
export function AnthropicIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z" />
    </svg>
  )
}

export function GitHubIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

export function GeminiIcon({ className }: IconProps): JSX.Element {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81" />
    </svg>
  )
}

/** filled=true renders a solid star (bookmarked); filled=false renders just
 * the outline (not bookmarked). */
export function StarIcon({ className, filled }: IconProps & { filled?: boolean }): JSX.Element {
  return (
    <svg
      className={className}
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    >
      <path d="M8 1.5l2.02 4.09 4.51.66-3.27 3.19.77 4.49L8 11.77l-4.03 2.16.77-4.49-3.27-3.19 4.51-.66Z" />
    </svg>
  )
}

