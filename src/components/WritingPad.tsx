import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  /** 插在工具列裡的額外按鈕（手寫分頁的「唸一次」） */
  actions?: ReactNode
  /**
   * 有給的話，寫完判分後工具列換成結果列：寫對出現「下一個」、寫錯出現「重來」，
   * 形狀偏了兩顆都給。手寫分頁用；每日練習的默寫題由回合自己的「繼續」接手，不給
   */
  onNext?: () => void
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
  actions,
  onNext,
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
  /**
   * 這個字有沒有哪一筆不是用 Apple Pencil 寫的。
   * penOnly 開著但人在筆電上用滑鼠寫，照筆的標準判會幾乎全錯，所以改用寬鬆的門檻
   */
  const [loose, setLoose] = useState(false)

  // 換字或換模式就整組重來
  const resetKey = `${text}|${mode}`
  const [prevKey, setPrevKey] = useState(resetKey)
  if (resetKey !== prevKey) {
    setPrevKey(resetKey)
    setCells(chars.map(emptyCell))
    setShowGhost(mode === 'trace')
    setReported(false)
    setLoose(false)
  }

  const thresholds = thresholdsFor(penOnly && !loose)
  const size = chars.length > 1 ? Math.round(cellSize * 0.82) : cellSize

  /**
   * 收下一筆。評分和 onJudged 都在 handler 裡算完才 setCells——
   * 寫進 updater 的話 StrictMode 會跑兩次，熟練度會被記兩次。
   */
  function addStroke(cellIndex: number, points: InkPoint[], byPen: boolean) {
    // 這一輪 render 的 thresholds 還是舊的，評分要用這一筆算進去之後的門檻
    const nowLoose = loose || !byPen
    if (nowLoose !== loose) setLoose(nowLoose)
    const th = thresholdsFor(penOnly && !nowLoose)

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
      score: scoreCharacter(chars[i], c.strokes, size, th),
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
    setLoose(false)
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

  // 結果列是寫完才長出來的。版面再怎麼估也可能差一點（字型、網址列），
  // 萬一它落在畫面外，捲過去讓「下一個／重來」看得到
  const resultRef = useRef<HTMLDivElement>(null)
  const judged = overall !== null
  useEffect(() => {
    const el = resultRef.current
    if (!judged || !onNext || !el?.scrollIntoView) return
    // 'nearest' 碰上 scroll-margin 時 Chrome 不會捲，自己判斷要不要捲再用 'end'
    const margin = parseFloat(getComputedStyle(el).scrollMarginBottom) || 0
    if (el.getBoundingClientRect().bottom + margin > window.innerHeight) {
      el.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }
  }, [judged, onNext])

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
            onStroke={(points, byPen) => addStroke(i, points, byPen)}
            onPenOnlyBlocked={onPenOnlyBlocked}
          />
        ))}
      </div>

      {/* 寫完之後結果列會說明一切，這行收起來讓出高度 */}
      {overall && onNext ? null : (
        <p className="pad-foot">
          已寫 {written} / {expected} 筆
        </p>
      )}

      {overall ? (
        <div
          ref={resultRef}
          className={`wresult ${overall === 'bad' ? 'bad' : overall === 'ok' ? 'good' : ''}`}
          role="status"
        >
          <span className="mark" aria-hidden="true">
            {VERDICT_LABEL[overall].mark}
          </span>
          <div className="wresult-text">
            <b>{VERDICT_LABEL[overall].text}</b>
            {scores.map((s, i) => (
              <div className="small" key={i}>
                {chars.length > 1 ? `${chars[i]}：` : ''}
                {s.message}
              </div>
            ))}
          </div>
          {onNext ? (
            <div className="wresult-actions">
              {/* 默寫寫錯時想先看正確寫法再重來 */}
              {mode === 'blind' && overall !== 'ok' ? (
                <button type="button" className="btn btn-sm" onClick={() => setShowGhost((v) => !v)}>
                  {ghostLabel(mode, showGhost)}
                </button>
              ) : null}
              {overall !== 'ok' ? (
                <button type="button" className={`btn ${overall === 'bad' ? 'btn-red' : ''}`} onClick={reset}>
                  重來
                </button>
              ) : null}
              {overall !== 'bad' ? (
                <button type="button" className="btn btn-green" onClick={onNext}>
                  下一個
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 結果列自己有重來／下一個，寫完就把工具列收起來，免得版面變高 */}
      {overall && onNext ? null : (
        <div className="tools">
          <button type="button" className="btn btn-sm" onClick={() => setShowGhost((v) => !v)}>
            {ghostLabel(mode, showGhost)}
          </button>
          {actions}
          <button type="button" className="btn btn-sm" onClick={undo} disabled={!written}>
            上一筆復原
          </button>
          <button type="button" className="btn btn-sm" onClick={reset} disabled={!written}>
            清除
          </button>
        </div>
      )}
    </>
  )
}
