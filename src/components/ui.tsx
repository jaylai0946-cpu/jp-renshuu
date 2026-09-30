import type { ReactNode } from 'react'

/*
 * A 版設計的共用小元件：線條圖示、膠囊、單元色塊。
 * 圖示都是 inline SVG，顏色吃 var(--icon)，深色模式自動反白。
 */

type IconName =
  | 'flame'
  | 'coin'
  | 'plus'
  | 'shuffle'
  | 'speaker'
  | 'check'
  | 'close'
  | 'left'
  | 'right'
  | 'play'

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true as const }
  const stroke = { style: { stroke: 'var(--icon)' }, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'flame':
      return (
        <svg {...p}>
          <path
            d="M12 2c.8 3.6 5.5 5.6 5.5 11.2A5.5 5.5 0 0 1 6.5 13.4c0-2.6 1.5-4.2 2.4-6.2 1.3 1.1 2 2.4 2.3 3.9C12.4 8.9 12.6 5.6 12 2z"
            fill="#FF7A1A"
            style={{ stroke: 'var(--icon)' }}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'coin':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" fill="#FFC531" style={{ stroke: 'var(--icon)' }} strokeWidth="1.8" />
          <path
            d="M12 7.5l1.4 2.9 3.1.4-2.3 2.1.6 3.1-2.8-1.6-2.8 1.6.6-3.1-2.3-2.1 3.1-.4z"
            fill="#ffffff"
            style={{ stroke: 'var(--icon)' }}
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'plus':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
      )
    case 'shuffle':
      return (
        <svg {...p}>
          <path
            d="M4 7h3.5c2 0 3 1 4.5 3.5l1 1.5c1.5 2.5 2.5 3.5 4.5 3.5H20M4 17h3.5c1.3 0 2.2-.5 3-1.5M13.5 8.5c.8-1 1.7-1.5 3-1.5H20M17.5 4.5 20 7l-2.5 2.5M17.5 14.5 20 17l-2.5 2.5"
            {...stroke}
            strokeWidth="2.2"
          />
        </svg>
      )
    case 'speaker':
      return (
        <svg {...p}>
          <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
          <path
            d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      )
    case 'check':
      return (
        <svg {...p}>
          <path
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )
    case 'close':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6 6 18" {...stroke} strokeWidth="3" />
        </svg>
      )
    case 'left':
      return (
        <svg {...p}>
          <path d="M15 5l-7 7 7 7" {...stroke} strokeWidth="2.8" />
        </svg>
      )
    case 'right':
      return (
        <svg {...p}>
          <path d="M9 5l7 7-7 7" {...stroke} strokeWidth="2.8" />
        </svg>
      )
    case 'play':
      return (
        <svg {...p}>
          <path d="M7 4.5v15L19 12z" style={{ fill: 'var(--icon)' }} />
        </svg>
      )
  }
}

export function StreakPill({ days, suffix }: { days: number; suffix?: string }) {
  return (
    <span className="pill pill-orange" aria-label={`連續 ${days} 天`}>
      <Icon name="flame" />
      {days}
      {suffix}
    </span>
  )
}

export function XpPill({ xp }: { xp: number }) {
  return (
    <span className="pill pill-yellow" aria-label={`總點數 ${xp}`}>
      <Icon name="coin" />
      {xp}
    </span>
  )
}

export function SyncDot({ text, ok }: { text: string; ok: boolean }) {
  return (
    <span className={`syncdot${ok ? ' ok' : ''}`}>
      <i aria-hidden="true" />
      {text}
    </span>
  )
}

export function Tile({
  glyph,
  color,
  size = 'md',
}: {
  glyph: string
  color: string
  size?: 'sm' | 'md' | 'lg'
}) {
  return (
    <span
      className={`tile tile-${size}${[...glyph].length > 1 ? ' two' : ''}`}
      style={{ background: color }}
      lang="ja"
      aria-hidden="true"
    >
      {glyph}
    </span>
  )
}

/** 帶墨框的進度條 */
export function Bar({ parts, label, thin }: { parts: { pct: number; color: string }[]; label?: string; thin?: boolean }) {
  return (
    <div className={`bar${thin ? ' thin' : ''}`} role={label ? 'img' : undefined} aria-label={label}>
      {parts.map((p, i) => (
        <i key={i} style={{ width: `${Math.max(0, Math.min(100, p.pct))}%`, background: p.color }} />
      ))}
    </div>
  )
}

/** 頁首：電腦版有日期之類的小字加大標題，手機版只有標題 */
export function PageHead({
  title,
  kicker,
  right,
}: {
  title: ReactNode
  kicker?: ReactNode
  right?: ReactNode
}) {
  return (
    <header className="phead">
      <div className="phead-l">
        {kicker ? <span className="kicker">{kicker}</span> : null}
        <h1>{title}</h1>
      </div>
      {right ? <div className="phead-r">{right}</div> : null}
    </header>
  )
}
