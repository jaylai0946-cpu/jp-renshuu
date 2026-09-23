import { useMemo, useState } from 'react'
import { UNITS } from '../data/units'
import type { Verdict } from '../lib/score'
import { speak } from '../lib/speech'
import { hasStrokes, strokeCount } from '../lib/strokes'
import type { AppState, KanaItem } from '../types'
import { StrokeOrderView } from './StrokeOrderView'
import { WritingPad } from './WritingPad'

export type WriteMode = 'order' | 'trace' | 'blind'

const MODES: { id: WriteMode; label: string; hint: string }[] = [
  { id: 'order', label: '看筆順', hint: '動畫依序畫出每一筆，標出順序和起筆點' },
  { id: 'trace', label: '描寫', hint: '格子裡有淡淡的範本，照著描。寫錯一筆會當場變紅' },
  { id: 'blind', label: '默寫', hint: '只給羅馬拼音，從記憶寫出來。寫完才判分' },
]

/** 只有假名單元能練手寫。第一版不練漢字 */
const KANA_UNITS = UNITS.filter((u) => u.kind === 'kana')

interface Props {
  state: AppState
  onSetting: <K extends keyof AppState['settings']>(k: K, v: AppState['settings'][K]) => void
  /** 在這裡練也算數，會記進手寫熟練度 */
  onWrite: (id: string, verdict: Verdict) => void
}

export function Handwriting({ state, onSetting, onWrite }: Props) {
  const [mode, setMode] = useState<WriteMode>('order')
  const [unitId, setUnitId] = useState(KANA_UNITS[0].id)
  const [index, setIndex] = useState(0)
  const [blocked, setBlocked] = useState(false)

  /**
   * 以「題目」為單位而不是單一字元：拗音的 きゃ 是一題兩格，
   * 這樣跟每日練習的默寫題、以及 state.write 的 key 才對得起來。
   */
  const items = useMemo(() => {
    const unit = KANA_UNITS.find((u) => u.id === unitId) ?? KANA_UNITS[0]
    return (unit.items as KanaItem[]).filter((it) => [...it.ch].every(hasStrokes))
  }, [unitId])

  const current = items[Math.min(index, items.length - 1)]
  if (!current) return <p className="muted">這個單元沒有可以練的字。</p>

  const chars = [...current.ch]
  const expected = chars.reduce((n, ch) => n + strokeCount(ch), 0)
  const progress = state.write[current.id]

  function go(step: number) {
    setIndex((i) => (i + step + items.length) % items.length)
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
          <b style={{ fontSize: '1.2rem' }} lang={mode === 'blind' ? undefined : 'ja'}>
            {mode === 'blind' ? current.ro : current.ch}
          </b>
          <div className="muted small">
            第 {index + 1} / {items.length} 個　這個字 {expected} 筆
            {progress ? `　手寫盒子 ${progress.b}` : ''}
          </div>
        </div>
        <button type="button" className="ghost" onClick={() => go(1)} aria-label="下一個字">
          ›
        </button>
      </div>

      {mode === 'order' ? (
        <div className="padwrap">
          {chars.map((ch, i) => (
            <StrokeOrderView key={`${current.id}-${i}`} ch={ch} size={chars.length > 1 ? 230 : 290} />
          ))}
        </div>
      ) : (
        <>
          <WritingPad
            key={`${current.id}-${mode}`}
            text={current.ch}
            mode={mode}
            penOnly={state.settings.penOnly}
            onJudged={(verdict) => onWrite(current.id, verdict)}
            onPenOnlyBlocked={() => setBlocked(true)}
          />

          {blocked && state.settings.penOnly ? (
            <div className="panel" style={{ marginTop: 12 }}>
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
        手寫有自己的熟練度，跟辨識分開排複習。會認不代表會寫。
      </p>
    </>
  )
}
