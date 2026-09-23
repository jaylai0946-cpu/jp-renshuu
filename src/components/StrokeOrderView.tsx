import { useEffect, useMemo, useRef, useState } from 'react'
import { polylineLength } from '../lib/path'
import { KANJIVG_SIZE, outlineFor, pathsFor } from '../lib/strokes'

interface Props {
  ch: string
  size: number
  /** 每一筆畫多久（毫秒） */
  strokeMs?: number
  /** 筆與筆之間停多久 */
  pauseMs?: number
  /** 標出筆順編號和起筆點 */
  showNumbers?: boolean
}

/**
 * 看筆順：依序把每一筆畫出來，並標出編號和起筆點。
 *
 * 用 SVG 而不是 canvas——stroke-dasharray 本來就是為了「畫到一半」設計的，
 * 自己在 canvas 上切折線反而容易在轉角出現破綻。
 *
 * 筆畫長度用自己取樣出來的折線算，不呼叫 getTotalLength()：那個要有真的
 * DOM 佈局，jsdom 裡是 undefined，測試會整片紅。
 */
export function StrokeOrderView({
  ch,
  size,
  strokeMs = 650,
  pauseMs = 220,
  showNumbers = true,
}: Props) {
  const paths = pathsFor(ch)

  // 每一筆的長度和起點，換字才重算
  const meta = useMemo(() => {
    return outlineFor(ch).map((points) => ({
      length: Math.max(polylineLength(points), 0.001),
      start: points[0] ?? { x: 0, y: 0 },
    }))
  }, [ch])

  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(true)
  const startedAt = useRef(0)

  const perStroke = strokeMs + pauseMs
  const total = paths.length * perStroke

  // 換字就從頭播。用 render 期調整而不是 effect——effect 會多跑一次 render，
  // 中間那一幀會閃到上一個字的動畫進度
  const [prevCh, setPrevCh] = useState(ch)
  if (ch !== prevCh) {
    setPrevCh(ch)
    setElapsed(0)
    setPlaying(true)
  }

  // ch 放進 deps：換字時就算 playing 本來就是 true 也要重新計時
  useEffect(() => {
    if (!playing || !paths.length) return
    let raf = 0
    startedAt.current = performance.now()

    const tick = (now: number) => {
      const t = now - startedAt.current
      if (t >= total) {
        setElapsed(total)
        setPlaying(false)
        return
      }
      setElapsed(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ch, playing, paths.length, total, strokeMs])

  /** 第 i 筆現在畫到幾成 */
  function progress(i: number): number {
    const t = elapsed - i * perStroke
    if (t <= 0) return 0
    return Math.min(1, t / strokeMs)
  }

  const current = Math.min(paths.length - 1, Math.floor(elapsed / perStroke))

  if (!paths.length) {
    return <p className="muted small center">這個字還沒有筆順資料</p>
  }

  return (
    <div className="center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${KANJIVG_SIZE} ${KANJIVG_SIZE}`}
        className="pad"
        role="img"
        aria-label={`${ch} 的筆順，共 ${paths.length} 筆`}
      >
        {/* 田字格 */}
        <g stroke="var(--grid)" strokeWidth="0.7">
          <line x1="0" y1={KANJIVG_SIZE / 2} x2={KANJIVG_SIZE} y2={KANJIVG_SIZE / 2} />
          <line x1={KANJIVG_SIZE / 2} y1="0" x2={KANJIVG_SIZE / 2} y2={KANJIVG_SIZE} />
        </g>

        {paths.map((d, i) => {
          const p = progress(i)
          const { length } = meta[i]
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={p >= 1 ? 'var(--ink)' : 'var(--stamp)'}
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={length}
              strokeDashoffset={length * (1 - p)}
              opacity={p > 0 ? 1 : 0}
            />
          )
        })}

        {showNumbers
          ? meta.map((m, i) => {
              const shown = progress(i) > 0
              return (
                <g key={i} opacity={shown ? 1 : 0.25}>
                  <circle
                    cx={m.start.x}
                    cy={m.start.y}
                    r={i === current && playing ? 4 : 2.6}
                    fill="var(--stamp)"
                  />
                  <text
                    x={m.start.x}
                    y={m.start.y - 5.5}
                    fontSize="8"
                    textAnchor="middle"
                    fill="var(--stamp)"
                    fontWeight="600"
                  >
                    {i + 1}
                  </text>
                </g>
              )
            })
          : null}
      </svg>

      <p className="muted small" style={{ margin: '8px 0 0' }}>
        共 {paths.length} 筆{playing ? `　第 ${current + 1} 筆` : ''}
      </p>
      <p style={{ margin: '10px 0 0' }}>
        <button
          type="button"
          className="speak"
          onClick={() => {
            setElapsed(0)
            setPlaying(true)
          }}
        >
          ▶︎ 再看一次
        </button>
      </p>
    </div>
  )
}
