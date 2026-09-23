import { useMemo, useState } from 'react'
import { UNITS } from '../data/units'
import type { InkPoint } from '../lib/path'
import { speak } from '../lib/speech'
import { hasStrokes, outlineFor, strokeCount } from '../lib/strokes'
import type { AppState, KanaItem } from '../types'
import { Brush } from './Brush'
import { StrokeOrderView } from './StrokeOrderView'

export type WriteMode = 'order' | 'trace' | 'blind'

const MODES: { id: WriteMode; label: string; hint: string }[] = [
  { id: 'order', label: '看筆順', hint: '動畫依序畫出每一筆，標出順序和起筆點' },
  { id: 'trace', label: '描寫', hint: '格子裡有淡淡的範本，照著描' },
  { id: 'blind', label: '默寫', hint: '只給羅馬拼音，從記憶寫出來' },
]

/** 只有假名單元能練手寫。第一版不練漢字 */
const KANA_UNITS = UNITS.filter((u) => u.kind === 'kana')

interface Props {
  state: AppState
  onSetting: <K extends keyof AppState['settings']>(k: K, v: AppState['settings'][K]) => void
}

export function Handwriting({ state, onSetting }: Props) {
  const [mode, setMode] = useState<WriteMode>('order')
  const [unitId, setUnitId] = useState(KANA_UNITS[0].id)
  const [index, setIndex] = useState(0)
  const [strokes, setStrokes] = useState<InkPoint[][]>([])
  const [revealed, setRevealed] = useState(false)
  const [blocked, setBlocked] = useState(false)

  // 拗音是兩個字，手寫一次練一個字元，所以攤平成單字元清單
  const chars = useMemo(() => {
    const unit = KANA_UNITS.find((u) => u.id === unitId) ?? KANA_UNITS[0]
    const seen = new Set<string>()
    const out: { ch: string; ro: string }[] = []
    for (const item of unit.items as KanaItem[]) {
      for (const ch of item.ch) {
        if (seen.has(ch) || !hasStrokes(ch)) continue
        seen.add(ch)
        out.push({ ch, ro: item.ro })
      }
    }
    return out
  }, [unitId])

  const current = chars[Math.min(index, chars.length - 1)]

  // 換字或換模式就把寫過的清掉，不然會疊在新的字上。
  // 用 render 期調整而不是 effect：effect 會讓舊筆畫先畫在新字上一幀才消失
  const resetKey = `${current?.ch ?? ''}|${mode}`
  const [prevKey, setPrevKey] = useState(resetKey)
  if (resetKey !== prevKey) {
    setPrevKey(resetKey)
    setStrokes([])
    setRevealed(false)
  }

  if (!current) return <p className="muted">這個單元沒有可以練的字。</p>

  const expected = strokeCount(current.ch)
  // 範本用密取樣，判分用的 32 點在轉角會看得出折線
  const ghost = mode === 'trace' || revealed ? outlineFor(current.ch) : undefined

  function go(step: number) {
    setIndex((i) => (i + step + chars.length) % chars.length)
  }

  return (
    <>
      <div className="chips">
        {MODES.map((m) => (
          <button
            type="button"
            key={m.id}
            className={`chip${mode === m.id ? ' on' : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="chips">
        {KANA_UNITS.map((u) => (
          <button
            type="button"
            key={u.id}
            className={`chip${unitId === u.id ? ' on' : ''}`}
            onClick={() => {
              setUnitId(u.id)
              setIndex(0)
            }}
          >
            {u.name.replace('・', ' ')}
          </button>
        ))}
      </div>

      <p className="muted small">{MODES.find((m) => m.id === mode)?.hint}</p>

      <div className="rtop" style={{ marginBottom: 12 }}>
        <button type="button" className="ghost" onClick={() => go(-1)} aria-label="上一個字">
          ‹
        </button>
        <div className="center" style={{ flex: 1 }}>
          <b style={{ fontSize: '1.2rem' }}>
            {mode === 'blind' ? current.ro : current.ch}
          </b>
          <div className="muted small">
            第 {index + 1} / {chars.length} 個　這個字 {expected} 筆
          </div>
        </div>
        <button type="button" className="ghost" onClick={() => go(1)} aria-label="下一個字">
          ›
        </button>
      </div>

      {mode === 'order' ? (
        <StrokeOrderView ch={current.ch} size={300} />
      ) : (
        <>
          <div className="padwrap">
            <Brush
              size={300}
              penOnly={state.settings.penOnly}
              strokes={strokes}
              ghost={ghost}
              onStroke={(points) => setStrokes((s) => [...s, points])}
              onPenOnlyBlocked={() => setBlocked(true)}
            />
          </div>

          <p className="center muted small">
            已寫 {strokes.length} / {expected} 筆
          </p>

          {blocked && state.settings.penOnly ? (
            <div className="panel" style={{ marginBottom: 12 }}>
              <p className="small" style={{ margin: 0 }}>
                現在只收 Apple Pencil。用手指或滑鼠寫的話要關掉這個設定。
              </p>
              <div className="row" style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    onSetting('penOnly', false)
                    setBlocked(false)
                  }}
                >
                  改用手指寫
                </button>
                <button type="button" className="ghost" onClick={() => setBlocked(false)}>
                  知道了
                </button>
              </div>
            </div>
          ) : null}

          <div className="row">
            <button
              type="button"
              className="ghost"
              onClick={() => setStrokes((s) => s.slice(0, -1))}
              disabled={!strokes.length}
            >
              上一筆復原
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => setStrokes([])}
              disabled={!strokes.length}
            >
              清除
            </button>
            <button type="button" className="ghost" onClick={() => setRevealed((v) => !v)}>
              {revealed ? '收起答案' : '看答案'}
            </button>
          </div>
        </>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="ghost" onClick={() => speak(current.ch, true)}>
          🔊 唸一次
        </button>
        <button type="button" className="ghost" onClick={() => go(1)}>
          寫好了，下一個
        </button>
      </div>

      <p className="muted small sec">
        判分還沒做（階段 3）。現在寫完只會留在畫面上，不會記進熟練度。
      </p>
    </>
  )
}
