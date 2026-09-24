import { useEffect, useMemo, useState } from 'react'
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

/**
 * 格子以外的東西（分頁、chips、字頭、按鈕、底部導覽）大概佔掉的高度。
 *
 * 640 是量出來的：iPad 橫向（1112×834、1024×768）在這個值下，
 * 「寫好了，下一個」不用捲動就按得到，而且格子還能留到 194px。
 * 再往上加只會把格子壓到下限 150，按鈕的位置不會更好。
 */
const CHROME_HEIGHT = 640
const MIN_PAD = 150
const MAX_PAD = 290

function padSizeFor(width: number, height: number): number {
  return Math.max(MIN_PAD, Math.min(MAX_PAD, height - CHROME_HEIGHT, width - 60))
}

/**
 * 畫布大小跟著視窗走。
 *
 * iPad 橫向只有 834 高，固定 290 的格子會把下面的按鈕推到底部導覽底下，
 * 看起來就像按鈕被擋住。轉向時也要重算。
 */
function usePadSize(): number {
  const [size, setSize] = useState(() => padSizeFor(window.innerWidth, window.innerHeight))
  useEffect(() => {
    const update = () => setSize(padSizeFor(window.innerWidth, window.innerHeight))
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])
  return size
}

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
  const padSize = usePadSize()

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
          {/* 發音放在字的旁邊，想聽的時候手就在那裡 */}
          <button
            type="button"
            className="speak"
            style={{ marginTop: 6 }}
            onClick={() => speak(current.ch, true)}
          >
            🔊 唸一次
          </button>
        </div>
        <button type="button" className="ghost" onClick={() => go(1)} aria-label="下一個字">
          ›
        </button>
      </div>

      {mode === 'order' ? (
        <div className="padwrap">
          {chars.map((ch, i) => (
            <StrokeOrderView
              key={`${current.id}-${i}`}
              ch={ch}
              size={chars.length > 1 ? Math.round(padSize * 0.82) : padSize}
            />
          ))}
        </div>
      ) : (
        <>
          {/*
            提示蓋在畫布上，不佔版面高度。
            放在流程裡（不管畫布上面或下面）都會把「寫好了，下一個」往下推
            123px——iPad 橫向只有 834 高，那顆按鈕就被推到底部導覽底下。
          */}
          <div className="padstack">
            {blocked && state.settings.penOnly ? (
              <div className="padhint" role="alert">
                <p className="small">現在只收 Apple Pencil。用手指或滑鼠寫的話要關掉這個設定。</p>
                <div className="row">
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

            <WritingPad
              key={`${current.id}-${mode}`}
              text={current.ch}
              mode={mode}
              penOnly={state.settings.penOnly}
              cellSize={padSize}
              onJudged={(verdict) => onWrite(current.id, verdict)}
              onPenOnlyBlocked={() => setBlocked(true)}
            />
          </div>

        </>
      )}

      {/* 寫完之後手在畫布下方，上一個／下一個放這裡才好按 */}
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="ghost" onClick={() => go(-1)}>
          上一個
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
