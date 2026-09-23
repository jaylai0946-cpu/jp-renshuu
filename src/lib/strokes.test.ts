import { describe, expect, it } from 'vitest'
import { handwritingChars } from '../data/units'
import { polylineLength } from './path'
import {
  KANJIVG_SIZE,
  SAMPLES_PER_STROKE,
  STROKE_PATHS,
  hasStrokes,
  outlineFor,
  pathsFor,
  strokeCount,
  templateFor,
  toKanjiVGSpace,
} from './strokes'

describe('筆順資料涵蓋範圍', () => {
  it('App 要用的 148 個假名一個都不缺', () => {
    const missing = handwritingChars().filter((ch) => !hasStrokes(ch))
    expect(missing).toEqual([])
  })

  it('沒有多餘的字（跑腳本時清單漂掉會被抓到）', () => {
    const wanted = new Set(handwritingChars())
    const extra = Object.keys(STROKE_PATHS).filter((ch) => !wanted.has(ch))
    expect(extra).toEqual([])
  })

  it('不含漢字，第一版不練漢字手寫', () => {
    for (const ch of Object.keys(STROKE_PATHS)) {
      expect([...ch]).toHaveLength(1)
      expect(ch.codePointAt(0)!).toBeGreaterThan(0x3040)
      expect(ch.codePointAt(0)!).toBeLessThan(0x3100)
    }
  })
})

describe('筆畫數', () => {
  it.each([
    ['あ', 3],
    ['い', 2],
    ['し', 1],
    ['ア', 2],
    ['ン', 2],
  ])('%s 是 %i 筆', (ch, n) => {
    expect(strokeCount(ch)).toBe(n)
  })

  it('濁音是清音加兩點', () => {
    expect(strokeCount('が')).toBe(strokeCount('か') + 2)
    expect(strokeCount('じ')).toBe(strokeCount('し') + 2)
    expect(strokeCount('ヅ')).toBe(strokeCount('ツ') + 2)
  })

  it('半濁音是清音加一個圈', () => {
    expect(strokeCount('ぱ')).toBe(strokeCount('は') + 1)
    expect(strokeCount('ぴ')).toBe(strokeCount('ひ') + 1)
    expect(strokeCount('プ')).toBe(strokeCount('フ') + 1)
  })

  it('每個字至少一筆、最多八筆', () => {
    for (const ch of Object.keys(STROKE_PATHS)) {
      expect(strokeCount(ch)).toBeGreaterThanOrEqual(1)
      expect(strokeCount(ch)).toBeLessThanOrEqual(8)
    }
  })

  it('不認得的字回 0，不要爆掉', () => {
    expect(strokeCount('漢')).toBe(0)
    expect(pathsFor('漢')).toEqual([])
    expect(templateFor('漢')).toEqual([])
    expect(hasStrokes('漢')).toBe(false)
  })
})

describe('templateFor', () => {
  it('每一筆都取樣成固定點數', () => {
    for (const stroke of templateFor('あ')) {
      expect(stroke).toHaveLength(SAMPLES_PER_STROKE)
    }
  })

  it('全部的字都解析得動，座標不會跑出格子外', () => {
    for (const ch of Object.keys(STROKE_PATHS)) {
      const strokes = templateFor(ch)
      expect(strokes).toHaveLength(strokeCount(ch))
      for (const stroke of strokes) {
        for (const p of stroke) {
          expect(Number.isFinite(p.x)).toBe(true)
          expect(Number.isFinite(p.y)).toBe(true)
          // 留一點邊，KanjiVG 有些筆畫會稍微壓到邊界
          expect(p.x).toBeGreaterThanOrEqual(-2)
          expect(p.x).toBeLessThanOrEqual(KANJIVG_SIZE + 2)
          expect(p.y).toBeGreaterThanOrEqual(-2)
          expect(p.y).toBeLessThanOrEqual(KANJIVG_SIZE + 2)
        }
      }
    }
  })

  it('每一筆都有長度，不會有原地不動的空筆畫', () => {
    for (const ch of Object.keys(STROKE_PATHS)) {
      for (const stroke of templateFor(ch)) {
        expect(polylineLength(stroke)).toBeGreaterThan(0.5)
      }
    }
  })

  it('快取回同一個物件，反覆判分不用重算', () => {
    expect(templateFor('か')).toBe(templateFor('か'))
  })

  it('筆順是有意義的：あ 第一筆是橫、第二筆是豎', () => {
    const [first, second] = templateFor('あ')
    const dx1 = Math.abs(first[31].x - first[0].x)
    const dy1 = Math.abs(first[31].y - first[0].y)
    expect(dx1).toBeGreaterThan(dy1) // 橫畫

    const dx2 = Math.abs(second[31].x - second[0].x)
    const dy2 = Math.abs(second[31].y - second[0].y)
    expect(dy2).toBeGreaterThan(dx2) // 豎畫
  })
})

describe('outlineFor', () => {
  it('畫動畫用的點比判分用的密', () => {
    const outline = outlineFor('あ')
    expect(outline).toHaveLength(3)
    for (const stroke of outline) {
      expect(stroke.length).toBeGreaterThan(SAMPLES_PER_STROKE / 2)
    }
  })
})

describe('toKanjiVGSpace', () => {
  it('畫布座標縮到 109 的格子裡', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 300, y: 150 },
    ]
    expect(toKanjiVGSpace(pts, 300)).toEqual([
      { x: 0, y: 0 },
      { x: 109, y: 54.5 },
    ])
  })

  it('比例一致，字不會被拉扁', () => {
    const [p] = toKanjiVGSpace([{ x: 50, y: 50 }], 200)
    expect(p.x).toBe(p.y)
  })
})
