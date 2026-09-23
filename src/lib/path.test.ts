import { describe, expect, it } from 'vitest'
import { distance, flattenPath, polylineLength, resample } from './path'

describe('flattenPath', () => {
  it('M 就是起點', () => {
    expect(flattenPath('M10,20')).toEqual([{ x: 10, y: 20 }])
  })

  it('c 是相對座標，終點要對', () => {
    // 從 (0,0) 出發，終點位移 (30,0)
    const pts = flattenPath('M0,0c10,0 20,0 30,0', 4)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[pts.length - 1].x).toBeCloseTo(30)
    expect(pts[pts.length - 1].y).toBeCloseTo(0)
    expect(pts).toHaveLength(5) // 起點 + 4 段
  })

  it('一個 c 後面接好幾組座標', () => {
    const pts = flattenPath('M0,0c10,0 20,0 30,0 10,0 20,0 30,0', 4)
    expect(pts).toHaveLength(9) // 起點 + 4 + 4
    expect(pts[pts.length - 1].x).toBeCloseTo(60)
  })

  it('直線的貝茲曲線取樣出來還是直線', () => {
    const pts = flattenPath('M0,0c25,25 50,50 100,100', 4)
    for (const p of pts) expect(p.y).toBeCloseTo(p.x)
  })

  it('perCurve 越大點越多', () => {
    const d = 'M0,0c10,0 20,0 30,0'
    expect(flattenPath(d, 4)).toHaveLength(5)
    expect(flattenPath(d, 16)).toHaveLength(17)
  })

  it('空字串回空陣列', () => {
    expect(flattenPath('')).toEqual([])
  })

  it('沒支援的指令要爆掉，不要默默畫錯', () => {
    expect(() => flattenPath('M0,0Q10,10 20,20')).toThrow('Q')
    expect(() => flattenPath('M0,0A10,10 0 0 1 20,20')).toThrow()
  })

  it('吃得下真的 KanjiVG 資料（あ 的第一筆）', () => {
    const d = 'M31.01,33c0.88,0.88,2.75,1.82,5.25,1.75c8.62-0.25,20-2.12,29.5-4.25c1.51-0.34,4.62-0.88,6.62-0.5'
    const pts = flattenPath(d)
    expect(pts[0]).toEqual({ x: 31.01, y: 33 })
    // 三段曲線，往右上走
    expect(pts[pts.length - 1].x).toBeGreaterThan(70)
    expect(pts[pts.length - 1].y).toBeLessThan(33)
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(109)
    }
  })
})

describe('resample', () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ]

  it('點數剛好', () => {
    expect(resample(line, 5)).toHaveLength(5)
    expect(resample(line, 32)).toHaveLength(32)
  })

  it('頭尾不動', () => {
    const pts = resample(line, 5)
    expect(pts[0]).toEqual({ x: 0, y: 0 })
    expect(pts[4]).toEqual({ x: 100, y: 0 })
  })

  it('直線上等距分佈', () => {
    const pts = resample(line, 5)
    expect(pts.map((p) => p.x)).toEqual([0, 25, 50, 75, 100])
  })

  it('折線也等距（轉角不會塞一堆點）', () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 30 },
    ]
    const pts = resample(corner, 7)
    const gaps = pts.slice(1).map((p, i) => distance(pts[i], p))
    for (const g of gaps) expect(g).toBeCloseTo(10, 5)
  })

  it('原地點一下（長度 0）不會除以零', () => {
    const dot = [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ]
    const pts = resample(dot, 8)
    expect(pts).toHaveLength(8)
    for (const p of pts) expect(p).toEqual({ x: 5, y: 5 })
  })

  it('只有一個點也撐得住', () => {
    expect(resample([{ x: 1, y: 2 }], 4)).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      { x: 1, y: 2 },
      { x: 1, y: 2 },
    ])
  })

  it('空陣列回空陣列', () => {
    expect(resample([], 8)).toEqual([])
  })

  it('取樣少於 2 點沒有意義，要擋', () => {
    expect(() => resample(line, 1)).toThrow()
  })

  it('重新取樣不會改變總長度太多', () => {
    const wiggly = Array.from({ length: 50 }, (_, i) => ({ x: i, y: Math.sin(i / 5) * 10 }))
    const before = polylineLength(wiggly)
    const after = polylineLength(resample(wiggly, 32))
    expect(after).toBeGreaterThan(before * 0.95)
    expect(after).toBeLessThanOrEqual(before * 1.001)
  })
})
