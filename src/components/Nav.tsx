export type TabId = 'home' | 'units' | 'write' | 'compose' | 'stats'

const TABS: { id: TabId; glyph: string; label: string }[] = [
  { id: 'home', glyph: '今', label: '今日' },
  { id: 'units', glyph: '単', label: '單元' },
  { id: 'write', glyph: '筆', label: '手寫' },
  { id: 'compose', glyph: '文', label: '造句' },
  { id: 'stats', glyph: '録', label: '紀錄' },
]

export function Nav({ view, onGo }: { view: string; onGo: (tab: TabId) => void }) {
  return (
    <nav className="nav">
      <div className="in">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={view === t.id ? 'on' : ''}
            aria-current={view === t.id ? 'page' : undefined}
            onClick={() => onGo(t.id)}
          >
            <span className="g" lang="ja" aria-hidden="true">
              {t.glyph}
            </span>
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
