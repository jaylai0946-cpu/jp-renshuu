import { useMemo, useState } from 'react'
import type { InkPoint } from '../lib/path'
import {
  VERDICT_LABEL,
  combineVerdicts,
  scoreCharacter,
  scoreSingleStroke,
  type Score,
  type Verdict,
} from '../lib/score'
import { outlineFor, strokeCount } from '../lib/strokes'
import { thresholdsFor } from '../lib/thresholds'
import { Brush } from './Brush'

export interface WritingPadProps {
  /** 要寫的字。拗音是兩個字元，一格一個 */
  text: string
  /** trace 會顯示淡範本並逐筆即時判分；blind 要按「判分」才評 */
  mode: 'trace' | 'blind'
  penOnly: boolean
  cellSize?: number
  /** 每一格都寫滿筆數之後回報總評。同一個 text 只會回報一次 */
  onJudged?: (verdict: Verdict) => void
  onPenOnlyBlocked?: () => void
}

interface CellState {
  strokes: InkPoint[][]
  score: Score | null
}

const emptyCell = (): CellState => ({ strokes: [], score: null })

/** 同一顆按鈕在兩種模式的意思相反，文字要跟著換 */
function ghostLabel(mode: WritingPadProps['mode'], showing: boolean): string {
  if (mode === 'trace') return showing ? '蓋住範本' : '顯示範本'
  return showing ? '收起答案' : '看答案'
}

/**
 * 多格原稿紙。一格一個字元——SPEC 要求拗音的小字（ゃゅょ）獨立佔一格。
 *
 * 描寫模式每寫完一筆就當場判那一筆並上色；默寫模式要等整格寫完才評，
 * 不然邊寫邊變紅等於在偷偷給答案。
 */
export function WritingPad({
  text,
  mode,
  penOnly,
  cellSize = 260,
  onJudged,
  onPenOnlyBlocked,
}: WritingPadProps) {
  const chars = useMemo(() => [...text], [text])
  const [cells, setCells] = useState<CellState[]>(() => chars.map(emptyCell))
  /**
   * 範本要不要顯示。描寫模式預設開著，默寫模式預設關著。
   *
   * 所以同一顆按鈕在兩種模式的意思是相反的：默寫是「看答案」，
   * 描寫是「蓋住範本」——描寫時範本本來就在，給一顆「看答案」等於死按鈕。
   */
  const [showGhost, setShowGhost] = useState(mode === 'trace')
  const [reported, setReported] = useState(false)

  // 換字或換模式就整組重來
  const resetKey = `${text}|${mode}`
  const [prevKey, setPrevKey] = useState(resetKey)
  if (resetKey !== prevKey) {
    setPrevKey(resetKey)
    setCells(chars.map(emptyCell))
    setShowGhost(mode === 'trace')
    setReported(false)
  }

  const thresholds = thresholdsFor(penOnly)
  const size = chars.length > 1 ? Math.round(cellSize * 0.82) : cellSize

  /**
   * 收下一筆。評分和 onJudged 都在 handler 裡算完才 setCells——
   * 寫進 updater 的話 StrictMode 會跑兩次，熟練度會被記兩次。
   */
  function addStroke(cellIndex: number, points: InkPoint[]) {
    const next = cells.map((c, i) =>
      i === cellIndex ? { ...c, strokes: [...c.strokes, points] } : c,
    )

    // 每一格都寫滿該有的筆數才評總分
    if (!next.every((c, i) => c.strokes.length >= strokeCount(chars[i]))) {
      setCells(next)
      return
    }

    const scored = next.map((c, i) => ({
      ...c,
      score: scoreCharacter(chars[i], c.strokes, size, thresholds),
    }))
    setCells(scored)

    if (!reported) {
      setReported(true)
      onJudged?.(combineVerdicts(scored.map((c) => c.score.verdict)))
    }
  }

  function reset() {
    setCells(chars.map(emptyCell))
    setReported(false)
  }

  function undo() {
    setCells((prev) => {
      // 從最後一格有東西的那格拿掉一筆
      const last = [...prev].reverse().findIndex((c) => c.strokes.length > 0)
      if (last < 0) return prev
      const target = prev.length - 1 - last
      return prev.map((c, i) => (i === target ? { strokes: c.strokes.slice(0, -1), score: null } : c))
    })
    setReported(false)
  }

  /** 描寫模式即時上色；默寫模式只有評完才上色 */
  function verdictsFor(cell: CellState, ch: string): Verdict[] | undefined {
    if (cell.score) return cell.score.strokes.map((s) => s.verdict)
    if (mode !== 'trace') return undefined
    return cell.strokes.map((stroke, i) => scoreSingleStroke(ch, stroke, i, size, thresholds))
  }

  const written = cells.reduce((n, c) => n + c.strokes.length, 0)
  const expected = chars.reduce((n, ch) => n + strokeCount(ch), 0)
  const scores = cells.map((c) => c.score).filter((s): s is Score => s !== null)
  const overall = scores.length === chars.length ? combineVerdicts(scores.map((s) => s.verdict)) : null

  return (
    <>
      <div className="padwrap">
        {chars.map((ch, i) => (
          <Brush
            key={`${text}-${i}`}
            size={size}
            penOnly={penOnly}
            strokes={cells[i].strokes}
            ghost={showGhost ? outlineFor(ch) : undefined}
            verdicts={verdictsFor(cells[i], ch)}
            onStroke={(points) => addStroke(i, points)}
            onPenOnlyBlocked={onPenOnlyBlocked}
          />
        ))}
      </div>

      <p className="center muted small">
        已寫 {written} / {expected} 筆
      </p>

      {overall ? (
        <div className={`panel result ${overall === 'bad' ? 'bad' : overall === 'ok' ? 'good' : ''}`}>
          <div className="rhead">
            <div className="hanko">
              <b>{VERDICT_LABEL[overall].mark}</b>
            </div>
            <div>
              <b>{VERDICT_LABEL[overall].text}</b>
              {scores.map((s, i) => (
                <div className="muted small" key={i}>
                  {chars.length > 1 ? `${chars[i]}：` : ''}
                  {s.message}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="ghost" onClick={undo} disabled={!written}>
          上一筆復原
        </button>
        <button type="button" className="ghost" onClick={reset} disabled={!written}>
          清除
        </button>
        <button type="button" className="ghost" onClick={() => setShowGhost((v) => !v)}>
          {ghostLabel(mode, showGhost)}
        </button>
      </div>
    </>
  )
}
