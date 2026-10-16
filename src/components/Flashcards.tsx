import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { speak } from '../lib/speech'
import { prefersReducedMotion } from '../lib/motion'
import type { Unit } from '../types'
import { Icon, PageHead } from './ui'

/** 拖超過這麼多像素放開就換張，不然彈回原位 */
const SWIPE = 60
/** 移動小於這個就算點一下（翻面），不是拖 */
const TAP = 8

/**
 * 單元的字卡：正面是字，點一下翻到背面看讀音和意思。
 * 手機左右滑動換張，電腦用 ← → 換、空白鍵翻面。只是翻著看，不算進練習紀錄。
 */
export function Flashcards({ unit, onBack }: { unit: Unit; onBack: () => void }) {
  const [idx, setIdx] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [enter, setEnter] = useState<'next' | 'prev' | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; dx: number } | null>(null)

  const total = unit.items.length
  const item = unit.items[idx]

  function go(step: 1 | -1) {
    setIdx((i) => (i + step + total) % total)
    setFlipped(false)
    setEnter(step === 1 ? 'next' : 'prev')
  }

  // 鍵盤：← → 換張，空白鍵／Enter 翻面
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if ((e.key === ' ' || e.key === 'Enter') && e.target === cardRef.current) {
        e.preventDefault()
        setFlipped((f) => !f)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // 拖曳時直接改 transform，不經過 React，手機上才順
  function setOffset(dx: number) {
    const el = cardRef.current
    if (!el) return
    el.style.transition = dx === 0 ? 'transform 200ms cubic-bezier(0.3, 1.3, 0.55, 1)' : 'none'
    el.style.transform = dx === 0 ? '' : `translateX(${dx}px) rotate(${dx / 24}deg)`
  }

  function onDown(e: ReactPointerEvent<HTMLDivElement>) {
    drag.current = { id: e.pointerId, x: e.clientX, dx: 0 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    d.dx = e.clientX - d.x
    if (Math.abs(d.dx) > TAP && !prefersReducedMotion()) setOffset(d.dx)
  }
  function onUp(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    setOffset(0)
    if (Math.abs(d.dx) <= TAP) setFlipped((f) => !f)
    else if (d.dx <= -SWIPE) go(1)
    else if (d.dx >= SWIPE) go(-1)
  }

  const front = item.t === 'kana' ? item.ch : item.jp
  const say = item.t === 'kana' ? item.ch : item.kana

  return (
    <div className="fdeck">
      <button type="button" className="link" onClick={onBack} style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>
        ‹ 全部單元
      </button>
      <PageHead title={`字卡・${unit.name}`} />

      <div
        key={idx}
        ref={cardRef}
        className={`fcard${flipped ? ' flipped' : ''}${enter ? ` enter-${enter}` : ''}`}
        role="button"
        tabIndex={0}
        aria-label={flipped ? `${front} 的背面，點一下翻回正面` : `${front}，點一下翻面`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null
          setOffset(0)
        }}
        onAnimationEnd={() => setEnter(null)}
      >
        <div className="fcard-in">
          <div className="fcard-face front" aria-hidden={flipped}>
            <span
              className={`big${item.t === 'word' ? ' word' : [...front].length > 1 ? ' two' : ''}`}
              lang="ja"
            >
              {front}
            </span>
            <span className="hint">點一下翻面・左右滑動換張</span>
          </div>
          <div className="fcard-face back" aria-hidden={!flipped}>
            <span className="ro">{item.ro}</span>
            {item.t === 'word' ? (
              <>
                {item.kana !== item.jp ? (
                  <span className="kana" lang="ja">
                    {item.kana}
                  </span>
                ) : null}
                <span className="zh">{item.zh}</span>
              </>
            ) : null}
            <button
              type="button"
              className="btn btn-sm"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                speak(say, true)
              }}
            >
              <Icon name="speaker" size={16} />
              唸一次
            </button>
          </div>
        </div>
      </div>

      <div className="fnav">
        <button type="button" className="btn fnav-btn" onClick={() => go(-1)} aria-label="上一張">
          <Icon name="left" />
        </button>
        <span className="count" aria-live="polite">
          {idx + 1} / {total}
        </span>
        <button type="button" className="btn fnav-btn" onClick={() => go(1)} aria-label="下一張">
          <Icon name="right" />
        </button>
      </div>
    </div>
  )
}
