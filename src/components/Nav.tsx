import { useLayoutEffect, useRef, useState } from 'react'

export type TabId = 'home' | 'units' | 'write' | 'compose' | 'songs' | 'stats'

const TABS: { id: TabId; glyph: string; label: string }[] = [
  { id: 'home', glyph: '今', label: '今日' },
  { id: 'units', glyph: '単', label: '單元' },
  { id: 'write', glyph: '筆', label: '手寫' },
  { id: 'compose', glyph: '文', label: '造句' },
  { id: 'songs', glyph: '歌', label: '歌曲' },
  { id: 'stats', glyph: '録', label: '紀錄' },
]

interface Box {
  x: number
  y: number
  w: number
  h: number
  r: string
}

/**
 * 同一份導覽：手機是底部分頁列，電腦版由 CSS 排成側邊欄的直列。
 *
 * 選中的那格紅色方塊是一塊獨立的指示器，換分頁時從舊的位置滑到新的位置。
 * 位置量的是選中那格字塊（.g）的實際座標，所以手機橫排、電腦直排都通用；
 * 視窗大小一變就重量一次。沒有選中任何分頁（例如「關於」頁）就收起來。
 */
export function Nav({ view, onGo }: { view: string; onGo: (tab: TabId) => void }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<Box | null>(null)
  // 第一次出現直接放到位，不要從左上角滑過來
  const [instant, setInstant] = useState(true)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    function measure() {
      const g = wrap!.querySelector<HTMLElement>('button[aria-current="page"] .g')
      if (!g) {
        setBox(null)
        return
      }
      const a = wrap!.getBoundingClientRect()
      const b = g.getBoundingClientRect()
      // jsdom 或還沒排版時量到 0，就先不畫，保留原本的選中樣式
      if (!b.width) {
        setBox(null)
        return
      }
      setBox({ x: b.left - a.left, y: b.top - a.top, w: b.width, h: b.height, r: getComputedStyle(g).borderRadius })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [view])

  useLayoutEffect(() => {
    if (!box || !instant) return
    const id = requestAnimationFrame(() => setInstant(false))
    return () => cancelAnimationFrame(id)
  }, [box, instant])

  return (
    <nav className="nav" aria-label="主選單">
      <div className={`nav-in${box ? ' has-ind' : ''}`} ref={wrapRef}>
        {box ? (
          <span
            className={`nav-ind${instant ? ' instant' : ''}`}
            aria-hidden="true"
            style={{
              width: box.w,
              height: box.h,
              borderRadius: box.r,
              transform: `translate(${box.x}px, ${box.y}px)`,
            }}
          />
        ) : null}
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
