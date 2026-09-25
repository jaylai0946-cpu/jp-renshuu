import { describe, expect, it } from 'vitest'
import { mergeStates } from './merge'
import { emptyState } from './storage'
import type { AppState, Progress } from '../types'

function withProgress(entries: Record<string, Partial<Progress>>): AppState {
  const s = emptyState()
  for (const [id, p] of Object.entries(entries)) {
    s.items[id] = { b: 0, due: '2026-09-25', seen: 0, wrong: 0, ...p }
  }
  return s
}

describe('mergeStates', () => {
  it('兩邊各自學的字都留著，不會丟掉任何一邊', () => {
    const ipad = withProgress({ 'h:あ': { b: 3 }, 'h:い': { b: 2 } })
    const phone = withProgress({ 'h:う': { b: 4 }, 'h:え': { b: 1 } })

    const merged = mergeStates(ipad, phone)
    expect(Object.keys(merged.items).sort()).toEqual(['h:あ', 'h:い', 'h:う', 'h:え'])
  })

  it('同一個字取盒子比較高的（學得比較前面的那邊）', () => {
    const ipad = withProgress({ 'h:あ': { b: 5, due: '2026-10-01' } })
    const phone = withProgress({ 'h:あ': { b: 2, due: '2026-12-01' } })

    expect(mergeStates(ipad, phone).items['h:あ'].b).toBe(5)
    expect(mergeStates(phone, ipad).items['h:あ'].b).toBe(5)
  })

  it('同盒子時取到期日比較晚的（比較晚答對的那邊）', () => {
    const ipad = withProgress({ 'h:あ': { b: 3, due: '2026-10-01' } })
    const phone = withProgress({ 'h:あ': { b: 3, due: '2026-10-05' } })

    expect(mergeStates(ipad, phone).items['h:あ'].due).toBe('2026-10-05')
  })

  it('完全一樣時取答題次數多的，統計不會倒退', () => {
    const ipad = withProgress({ 'h:あ': { b: 3, due: '2026-10-01', seen: 9 } })
    const phone = withProgress({ 'h:あ': { b: 3, due: '2026-10-01', seen: 4 } })

    expect(mergeStates(ipad, phone).items['h:あ'].seen).toBe(9)
    expect(mergeStates(phone, ipad).items['h:あ'].seen).toBe(9)
  })

  it('不管誰先誰後，結果都一樣', () => {
    const ipad = withProgress({ 'h:あ': { b: 5 }, 'h:い': { b: 1 } })
    const phone = withProgress({ 'h:あ': { b: 2 }, 'h:う': { b: 3 } })

    expect(mergeStates(ipad, phone).items).toEqual(mergeStates(phone, ipad).items)
  })

  it('手寫熟練度也合併，而且跟辨識分開', () => {
    const ipad = emptyState()
    ipad.write['h:あ'] = { b: 4, due: '2026-10-01', seen: 4, wrong: 0 }
    const phone = emptyState()
    phone.write['h:い'] = { b: 2, due: '2026-10-01', seen: 2, wrong: 0 }

    const merged = mergeStates(ipad, phone)
    expect(Object.keys(merged.write).sort()).toEqual(['h:あ', 'h:い'])
    expect(merged.items).toEqual({})
  })

  it('每天的紀錄逐欄取大的，不是相加（相加會把同一場練習算兩次）', () => {
    const ipad = emptyState()
    ipad.hist['2026-09-25'] = { n: 20, c: 18, xp: 200, w: 1, h: 3 }
    const phone = emptyState()
    phone.hist['2026-09-25'] = { n: 12, c: 11, xp: 120, w: 2, h: 0 }

    expect(mergeStates(ipad, phone).hist['2026-09-25']).toEqual({
      n: 20, c: 18, xp: 200, w: 2, h: 3,
    })
  })

  it('兩邊不同天的紀錄都留著，連續天數才算得對', () => {
    const ipad = emptyState()
    ipad.hist['2026-09-24'] = { n: 10, c: 9, xp: 95, w: 0, h: 0 }
    const phone = emptyState()
    phone.hist['2026-09-25'] = { n: 8, c: 8, xp: 80, w: 0, h: 0 }

    expect(Object.keys(mergeStates(ipad, phone).hist).sort()).toEqual(['2026-09-24', '2026-09-25'])
  })

  it('設定用本機的：人在這台，剛改的不該被另一台蓋掉', () => {
    const ipad = emptyState()
    ipad.settings.newPerDay = 20
    ipad.settings.penOnly = false
    const phone = emptyState()
    phone.settings.newPerDay = 5
    phone.settings.penOnly = true

    expect(mergeStates(ipad, phone).settings).toMatchObject({ newPerDay: 20, penOnly: false })
  })

  it('同一天的新字額度取多的，不會因為合併多送額度', () => {
    const ipad = emptyState()
    ipad.newDay = { d: '2026-09-25', n: 8 }
    const phone = emptyState()
    phone.newDay = { d: '2026-09-25', n: 3 }

    expect(mergeStates(ipad, phone).newDay).toEqual({ d: '2026-09-25', n: 8 })
  })

  it('不同天的新字額度取比較晚那天的', () => {
    const ipad = emptyState()
    ipad.newDay = { d: '2026-09-24', n: 10 }
    const phone = emptyState()
    phone.newDay = { d: '2026-09-25', n: 2 }

    expect(mergeStates(ipad, phone).newDay).toEqual({ d: '2026-09-25', n: 2 })
  })

  it('跟空白的合併等於原封不動', () => {
    const ipad = withProgress({ 'h:あ': { b: 3 } })
    ipad.hist['2026-09-25'] = { n: 5, c: 5, xp: 50, w: 0, h: 0 }

    expect(mergeStates(ipad, emptyState()).items).toEqual(ipad.items)
    expect(mergeStates(ipad, emptyState()).hist).toEqual(ipad.hist)
  })

  it('合併之後學過的字只會變多不會變少', () => {
    const ipad = withProgress({ 'h:あ': { b: 3 }, 'h:い': { b: 1 } })
    const phone = withProgress({ 'h:あ': { b: 1 }, 'h:う': { b: 2 } })

    const merged = mergeStates(ipad, phone)
    for (const state of [ipad, phone]) {
      for (const [id, p] of Object.entries(state.items)) {
        expect(merged.items[id]).toBeDefined()
        expect(merged.items[id].b).toBeGreaterThanOrEqual(p.b)
      }
    }
  })
})
