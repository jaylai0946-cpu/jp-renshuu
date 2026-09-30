export type TabId = 'home' | 'units' | 'write' | 'compose' | 'stats'

const TABS: { id: TabId; glyph: string; label: string }[] = [
  { id: 'home', glyph: '今', label: '今日' },
  { id: 'units', glyph: '単', label: '單元' },
  { id: 'write', glyph: '筆', label: '手寫' },
  { id: 'compose', glyph: '文', label: '造句' },
  { id: 'stats', glyph: '録', label: '紀錄' },
]

/** 同一份導覽：手機是底部分頁列，電腦版由 CSS 排成側邊欄的直列 */
export function Nav({ view, onGo }: { view: string; onGo: (tab: TabId) => void }) {
  return (
    <nav className="nav" aria-label="主選單">
      <div className="nav-in">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
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
