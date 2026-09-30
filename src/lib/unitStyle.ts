import type { Unit } from '../types'

/** 單元配色：平假名紅、片假名藍、招呼與自介紫、數字時間琥珀、點餐學校綠 */
const UNIT_COLOR: Record<string, string> = {
  h1: '#D93A2E',
  h2: '#D93A2E',
  h3: '#D93A2E',
  k1: '#2F6FE0',
  k2: '#2F6FE0',
  k3: '#2F6FE0',
  v1: '#7B4FD6',
  v2: '#7B4FD6',
  v3: '#B86E00',
  v4: '#B86E00',
  v5: '#188A48',
  v6: '#188A48',
}

export function unitColor(unit: Unit): string {
  return UNIT_COLOR[unit.id] ?? '#D93A2E'
}

/** 單元的代表字：假名單元用第一個假名（拗音是兩個字），單字單元用第一個字的第一個字元 */
export function unitGlyph(unit: Unit): string {
  const first = unit.items[0]
  if (!first) return ''
  return first.t === 'kana' ? first.ch : [...first.jp][0]
}
