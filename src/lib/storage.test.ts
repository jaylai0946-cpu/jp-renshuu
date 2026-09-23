import { beforeEach, describe, expect, it } from 'vitest'
import { STORAGE_KEY } from '../constants'
import { CORRUPT_KEY, emptyState, exportJSON, importJSON, isPristine, loadState, saveState } from './storage'

describe('storage', () => {
  beforeEach(() => localStorage.clear())

  it('沒資料時回空白進度', () => {
    expect(loadState()).toEqual(emptyState())
  })

  it('存了再讀回來一樣', () => {
    const state = emptyState()
    state.items['h:あ'] = { b: 3, due: '2026-09-25', seen: 4, wrong: 1 }
    state.settings.newPerDay = 20
    saveState(state)
    expect(loadState()).toEqual(state)
  })

  it('壞掉的 JSON 先備份再從頭來，不讓 App 掛掉', () => {
    localStorage.setItem(STORAGE_KEY, '{壞掉的')
    expect(loadState()).toEqual(emptyState())
    expect(localStorage.getItem(CORRUPT_KEY)).toBe('{壞掉的')
  })

  it('isPristine 分得出全新安裝', () => {
    const state = emptyState()
    expect(isPristine(state)).toBe(true)
    state.hist['2026-09-22'] = { n: 1, c: 1, xp: 10, w: 0, h: 0 }
    expect(isPristine(state)).toBe(false)
  })

  it('改設定不算動過進度（新裝置啟用同步時不該跳衝突）', () => {
    const state = emptyState()
    state.settings.newPerDay = 20
    expect(isPristine(state)).toBe(true)
  })

  it('匯出再匯入是同一份', () => {
    const state = emptyState()
    state.items['h:あ'] = { b: 3, due: '2026-09-25', seen: 4, wrong: 1 }
    state.write['h:あ'] = { b: 1, due: '2026-09-23', seen: 1, wrong: 0 }
    const result = importJSON(exportJSON(state), '2026-09-22')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toEqual(state)
  })

  it('匯入不是 JSON 的東西會被擋', () => {
    const result = importJSON('nope')
    expect(result.ok).toBe(false)
  })
})

describe('migration v1 -> v2', () => {
  beforeEach(() => localStorage.clear())

  it('v1 的 writePerDay 0 是被鎖住的預設值，升級時打開默寫題', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, items: {}, write: {}, hist: {}, settings: { writePerDay: 0, newPerDay: 15 } }),
    )
    const state = loadState()
    expect(state.settings.writePerDay).toBe(5)
    // 其他設定不動
    expect(state.settings.newPerDay).toBe(15)
    expect(state.version).toBe(2)
  })

  it('v1 沒有 writePerDay 欄位也補上', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, items: {}, hist: {}, settings: { newPerDay: 5 } }),
    )
    expect(loadState().settings.writePerDay).toBe(5)
  })

  it('v2 使用者自己關掉的 0 不會被改回來', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 2, items: {}, write: {}, hist: {}, settings: { writePerDay: 0 } }),
    )
    expect(loadState().settings.writePerDay).toBe(0)
  })

  it('Artifact 版（用 v 當版本欄位）也吃得到 migration', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ v: 1, items: {}, hist: {}, settings: { newPerDay: 10 } }),
    )
    expect(loadState().settings.writePerDay).toBe(5)
  })

  it('進度本身不會被 migration 動到', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        items: { 'h:あ': { b: 4, due: '2030-01-01', seen: 6, wrong: 1 } },
        hist: { '2026-09-22': { n: 12, c: 10, xp: 110, w: 0, h: 0 } },
        settings: {},
      }),
    )
    const state = loadState()
    expect(state.items['h:あ']).toEqual({ b: 4, due: '2030-01-01', seen: 6, wrong: 1 })
    expect(state.hist['2026-09-22'].n).toBe(12)
  })
})
