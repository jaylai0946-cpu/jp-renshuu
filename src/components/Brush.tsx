import { useCallback, useEffect, useRef } from 'react'
import type { InkPoint, Point } from '../lib/path'
import { KANJIVG_SIZE } from '../lib/strokes'

export type Verdict = 'ok' | 'shape' | 'bad'

export interface BrushProps {
  /** 畫布邊長（CSS px）。田字格是正方形 */
  size: number
  /** 只讓 Apple Pencil 畫得出線。開著時手指和手掌碰到不會留下痕跡 */
  penOnly: boolean
  /** 已經寫完的筆畫，座標是畫布的 CSS px。由上層拿著，才好做復原和清除 */
  strokes: InkPoint[][]
  /** 寫完一筆 */
  onStroke: (points: InkPoint[]) => void
  /** 描寫模式的淡範本，座標在 KanjiVG 的 109×109 */
  ghost?: Point[][]
  /** 每一筆的判分結果，長度對齊 strokes。階段 3 會用到 */
  verdicts?: Verdict[]
  /** 使用者用手指碰但 penOnly 開著時呼叫，上層用來提示 */
  onPenOnlyBlocked?: () => void
}

const BASE_WIDTH = 7
const GHOST_WIDTH = 9
const GHOST_ALPHA = 0.22

const COLOR: Record<Verdict | 'ink', string> = {
  ok: '--ok',
  shape: '--stamp',
  bad: '--bad',
  ink: '--ink',
}

/**
 * 手寫畫布。
 *
 * iPad 上最容易出事的幾件事都在這裡處理：
 * - touch-action: none（CSS 裡），寫字時頁面不能跟著捲
 * - penOnly 時只收 pointerType === 'pen'，手掌壓上去不會畫出一條線
 * - getCoalescedEvents() 把兩次 move 之間被合併掉的點補回來，線條才平順
 * - pressure 改筆畫粗細；滑鼠和手指不回報壓力，給固定值免得變成 0 寬度
 * - devicePixelRatio 縮放，Retina 上才不糊
 * - pointercancel（被系統手勢打斷）要把這一筆收掉，不能卡住
 *
 * 書寫途中刻意不呼叫 setState：iPad 的筆一秒可以送上百個點，每個點都
 * 觸發一次 React render 會直接掉幀。移動時只把新的那一小段畫上去，
 * 整張重畫留給 props 變動（復原、清除、換字）時。
 */
export function Brush({
  size,
  penOnly,
  strokes,
  onStroke,
  ghost,
  verdicts,
  onPenOnlyBlocked,
}: BrushProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  /** 正在寫的那一筆。放 ref 不放 state，避免每個點都 render */
  const liveRef = useRef<InkPoint[] | null>(null)
  /** 正在寫的是哪一根筆／手指。同時只收一個，第二根不理 */
  const pointerRef = useRef<number | null>(null)

  const context = useCallback((): CanvasRenderingContext2D | null => {
    const ctx = canvasRef.current?.getContext('2d') ?? null
    if (!ctx) return null
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    return ctx
  }, [])

  const cssVar = useCallback((name: string): string => {
    const canvas = canvasRef.current
    if (!canvas) return '#000'
    return getComputedStyle(canvas).getPropertyValue(name).trim() || '#000'
  }, [])

  /** 整張重畫。只在 props 變動時做 */
  const redraw = useCallback(() => {
    const ctx = context()
    if (!ctx) return
    ctx.clearRect(0, 0, size, size)

    // 田字格的十字輔助線。外框由 CSS 的 border 負責
    ctx.save()
    ctx.strokeStyle = cssVar('--grid')
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, size / 2)
    ctx.lineTo(size, size / 2)
    ctx.moveTo(size / 2, 0)
    ctx.lineTo(size / 2, size)
    ctx.stroke()
    ctx.restore()

    if (ghost?.length) {
      ctx.save()
      ctx.globalAlpha = GHOST_ALPHA
      ctx.strokeStyle = cssVar(COLOR.ink)
      ctx.lineWidth = GHOST_WIDTH
      const k = size / KANJIVG_SIZE
      for (const stroke of ghost) {
        if (stroke.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(stroke[0].x * k, stroke[0].y * k)
        for (const p of stroke.slice(1)) ctx.lineTo(p.x * k, p.y * k)
        ctx.stroke()
      }
      ctx.restore()
    }

    strokes.forEach((stroke, i) => {
      const color = cssVar(COLOR[verdicts?.[i] ?? 'ink'])
      if (stroke.length === 1) {
        dot(ctx, stroke[0], color)
        return
      }
      for (let k = 1; k < stroke.length; k++) segment(ctx, stroke[k - 1], stroke[k], color)
    })

    const live = liveRef.current
    if (live) {
      const color = cssVar(COLOR.ink)
      if (live.length === 1) dot(ctx, live[0], color)
      for (let k = 1; k < live.length; k++) segment(ctx, live[k - 1], live[k], color)
    }
  }, [context, cssVar, ghost, size, strokes, verdicts])

  // 尺寸或 DPR 變了要重新配置 backing store，不然 Retina 上會糊
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    redraw()
  }, [redraw, size])

  useEffect(redraw, [redraw])

  function toPoint(e: { clientX: number; clientY: number; pointerType?: string; pressure?: number }, rect: DOMRect): InkPoint {
    const pressure = e.pointerType === 'pen' && (e.pressure ?? 0) > 0 ? e.pressure! : 0.5
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, pressure }
  }

  function handleDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (pointerRef.current !== null) return
    if (penOnly && e.pointerType !== 'pen') {
      onPenOnlyBlocked?.()
      return
    }
    e.preventDefault()

    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    pointerRef.current = e.pointerId

    const point = toPoint(e, canvas.getBoundingClientRect())
    liveRef.current = [point]

    const ctx = context()
    if (ctx) dot(ctx, point, cssVar(COLOR.ink))
  }

  function handleMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const live = liveRef.current
    if (e.pointerId !== pointerRef.current || !live) return
    e.preventDefault()

    const canvas = canvasRef.current
    const ctx = context()
    if (!canvas || !ctx) return
    const rect = canvas.getBoundingClientRect()
    const color = cssVar(COLOR.ink)

    // 兩次 move 之間瀏覽器可能合併掉好幾個取樣點，補回來線條才不會有折角
    const native = e.nativeEvent
    const coalesced =
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : []
    for (const raw of coalesced.length ? coalesced : [native]) {
      const point = toPoint(raw, rect)
      segment(ctx, live[live.length - 1], point, color)
      live.push(point)
    }
  }

  function finish(e: React.PointerEvent<HTMLCanvasElement>, keep: boolean) {
    if (e.pointerId !== pointerRef.current) return
    const points = liveRef.current
    liveRef.current = null
    pointerRef.current = null

    const canvas = canvasRef.current
    if (canvas?.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId)

    // 交給上層收進 strokes，props 一變 redraw 就會把它畫成正式的筆畫
    if (keep && points?.length) onStroke(points)
    else redraw()
  }

  return (
    <canvas
      ref={canvasRef}
      className="pad"
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={(e) => finish(e, true)}
      // 被系統手勢打斷（例如從邊緣滑出控制中心）就丟掉這一筆，不要卡住
      onPointerCancel={(e) => finish(e, false)}
      onContextMenu={(e) => e.preventDefault()}
      aria-label="手寫區"
    />
  )
}

/** 每一小段用自己的壓力決定粗細，筆鋒才有輕重 */
function segment(ctx: CanvasRenderingContext2D, a: InkPoint, b: InkPoint, color: string) {
  ctx.strokeStyle = color
  ctx.lineWidth = BASE_WIDTH * (0.55 + b.pressure * 0.9)
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
}

/** 點一下就放開也要留個點，不然使用者以為沒寫到 */
function dot(ctx: CanvasRenderingContext2D, p: InkPoint, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(p.x, p.y, (BASE_WIDTH * (0.55 + p.pressure * 0.9)) / 2, 0, Math.PI * 2)
  ctx.fill()
}
