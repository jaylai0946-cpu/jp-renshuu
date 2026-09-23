import { describe, expect, it } from 'vitest'
import type { InkPoint, Point } from './path'
import { scoreCharacter } from './score'
import { KANJIVG_SIZE, STROKE_PATHS, templateFor } from './strokes'
import { FINGER, PEN } from './thresholds'

const SIZE = 300
const K = SIZE / KANJIVG_SIZE

/** 把範本當成「寫得完美」的輸入：換算回畫布座標 */
function trace(ch: string, warp: (p: Point, i: number, stroke: number) => Point = (p) => p): InkPoint[][] {
  return templateFor(ch).map((stroke, s) =>
    stroke.map((p, i) => {
      const q = warp(p, i, s)
      return { x: q.x * K, y: q.y * K, pressure: 0.5 }
    }),
  )
}

function seeded(seed: number) {
  let v = seed
  return () => {
    v = (v * 1664525 + 1013904223) % 4294967296
    return v / 4294967296 - 0.5
  }
}

describe('照著範本寫', () => {
  it('完美描出來的あ判成 ◎', () => {
    const score = scoreCharacter('あ', trace('あ'), SIZE, PEN)
    expect(score.verdict).toBe('ok')
    expect(score.message).toContain('都對')
    expect(score.problemStrokes).toEqual([])
  })

  it('148 個假名完美描出來全部都是 ◎', () => {
    const bad = Object.keys(STROKE_PATHS).filter(
      (ch) => scoreCharacter(ch, trace(ch), SIZE, PEN).verdict !== 'ok',
    )
    expect(bad).toEqual([])
  })

  it('手抖一點還是 ◎（寬鬆門檻要真的寬鬆）', () => {
    const jitter = seeded(42)
    const score = scoreCharacter(
      'あ',
      trace('あ', (p) => ({ x: p.x + jitter() * 8, y: p.y + jitter() * 8 })),
      SIZE,
      PEN,
    )
    expect(score.verdict).toBe('ok')
  })
})

describe('驗收標準：あ', () => {
  it('寫成 2 筆判成 ✕', () => {
    const two = trace('あ').slice(0, 2)
    const score = scoreCharacter('あ', two, SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.message).toContain('筆畫數不對')
    expect(score.expected).toBe(3)
    expect(score.actual).toBe(2)
  })

  it('寫成 4 筆也判成 ✕', () => {
    const strokes = trace('あ')
    const score = scoreCharacter('あ', [...strokes, strokes[0]], SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.message).toContain('筆畫數不對')
  })

  it('筆順顛倒判成 ✕', () => {
    const score = scoreCharacter('あ', [...trace('あ')].reverse(), SIZE, PEN)
    expect(score.verdict).toBe('bad')
  })

  it('筆順顛倒不會被誤報成「方向反了」', () => {
    const score = scoreCharacter('あ', [...trace('あ')].reverse(), SIZE, PEN)
    expect(score.message).toContain('筆順')
    expect(score.strokes[0].reversed).toBe(false)
  })

  it('照正確筆順寫判成 ◎', () => {
    expect(scoreCharacter('あ', trace('あ'), SIZE, PEN).verdict).toBe('ok')
  })
})

describe('方向寫反', () => {
  it('整筆從另一端起筆會被抓出來', () => {
    const strokes = trace('あ')
    strokes[0] = [...strokes[0]].reverse()
    const score = scoreCharacter('あ', strokes, SIZE, PEN)

    expect(score.verdict).toBe('bad')
    expect(score.strokes[0].reversed).toBe(true)
    expect(score.message).toContain('第 1 筆')
    expect(score.message).toContain('方向')
  })

  it('指出是第幾筆', () => {
    const strokes = trace('あ')
    strokes[1] = [...strokes[1]].reverse()
    expect(scoreCharacter('あ', strokes, SIZE, PEN).message).toContain('第 2 筆')
  })

  it('每一筆都寫反也抓得到', () => {
    const strokes = trace('い').map((s) => [...s].reverse())
    expect(scoreCharacter('い', strokes, SIZE, PEN).verdict).toBe('bad')
  })
})

describe('形狀偏掉', () => {
  it('整個字平移一點點判成 △，不是 ✕', () => {
    const score = scoreCharacter(
      'あ',
      trace('あ', (p) => ({ x: p.x + 19, y: p.y })),
      SIZE,
      PEN,
    )
    expect(score.verdict).toBe('shape')
    expect(score.message).toContain('筆順對了')
  })

  it('△ 會標出是哪幾筆', () => {
    const strokes = trace('あ', (p, _i, s) => (s === 1 ? { x: p.x + 19, y: p.y } : p))
    const score = scoreCharacter('あ', strokes, SIZE, PEN)
    expect(score.verdict).toBe('shape')
    expect(score.problemStrokes).toEqual([2])
    expect(score.strokes[0].verdict).toBe('ok')
    expect(score.strokes[1].verdict).toBe('shape')
  })

  it('偏太多就變 ✕', () => {
    const score = scoreCharacter(
      'あ',
      trace('あ', (p) => ({ x: p.x + 40, y: p.y + 40 })),
      SIZE,
      PEN,
    )
    expect(score.verdict).toBe('bad')
  })
})

describe('門檻', () => {
  it('手指的門檻比筆寬鬆：同一份輸入筆判 △、手指判 ◎', () => {
    const strokes = trace('あ', (p) => ({ x: p.x + 19, y: p.y }))
    expect(scoreCharacter('あ', strokes, SIZE, PEN).verdict).toBe('shape')
    expect(scoreCharacter('あ', strokes, SIZE, FINGER).verdict).toBe('ok')
  })

  it('畫布大小不影響結果（先換算到 109 再比）', () => {
    for (const size of [200, 300, 600]) {
      const k = size / KANJIVG_SIZE
      const strokes = templateFor('か').map((s) =>
        s.map((p) => ({ x: p.x * k, y: p.y * k, pressure: 0.5 })),
      )
      expect(scoreCharacter('か', strokes, size, PEN).verdict).toBe('ok')
    }
  })
})

describe('邊界情況', () => {
  it('一筆都沒寫', () => {
    const score = scoreCharacter('あ', [], SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.actual).toBe(0)
    expect(score.strokes).toEqual([])
  })

  it('只點了三個點（沒有真的畫）判成 ✕，不會爆掉', () => {
    const dots: InkPoint[][] = [1, 2, 3].map(() => [{ x: 150, y: 150, pressure: 0.5 }])
    const score = scoreCharacter('あ', dots, SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(Number.isFinite(score.strokes[0].shapeDistance)).toBe(true)
  })

  it('沒有筆順資料的字不會爆掉', () => {
    const score = scoreCharacter('漢', trace('あ'), SIZE, PEN)
    expect(score.verdict).toBe('bad')
    expect(score.message).toContain('沒有筆順資料')
  })

  it('每一筆的分數都對齊使用者實際寫的筆數', () => {
    const score = scoreCharacter('あ', trace('あ'), SIZE, PEN)
    expect(score.strokes).toHaveLength(3)
  })
})
