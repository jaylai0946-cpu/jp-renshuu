import type { AppState, DayHist, Progress } from '../types'
import { emptyHist } from './srs'

/**
 * 把兩台裝置的進度合起來。
 *
 * 原本兩邊都練過時是跳出來叫人二選一，留一邊丟一邊。那對這個 App 是錯的
 * 設計——間隔複習的進度本來就合得起來：同一個字取「學得比較前面」的那邊，
 * 沒有任何理由要丟掉另一台的練習。
 *
 * 合併規則刻意保守，寧可少算也不要多算：
 * - 每個字取盒子比較高的；同盒子取到期日比較晚的（代表比較晚答對）
 * - 每天的紀錄逐欄取大的，不是相加——兩台可能記到同一場練習，相加會灌水
 * - 設定用本機的：人現在在這台，剛改的設定不該被另一台蓋掉
 */
export function mergeStates(local: AppState, remote: AppState): AppState {
  return {
    version: Math.max(local.version, remote.version),
    items: mergeProgress(local.items, remote.items),
    write: mergeProgress(local.write, remote.write),
    hist: mergeHist(local.hist, remote.hist),
    settings: { ...local.settings },
    newDay: mergeNewDay(local.newDay, remote.newDay),
  }
}

function mergeProgress(
  a: Record<string, Progress>,
  b: Record<string, Progress>,
): Record<string, Progress> {
  const out: Record<string, Progress> = { ...a }
  for (const [id, theirs] of Object.entries(b)) {
    const mine = out[id]
    out[id] = mine ? furtherAlong(mine, theirs) : theirs
  }
  return out
}

/** 哪一邊學得比較前面 */
function furtherAlong(a: Progress, b: Progress): Progress {
  if (a.b !== b.b) return a.b > b.b ? a : b
  // 同一格時，到期日晚的那邊比較晚答對，是比較新的狀態
  if (a.due !== b.due) return a.due > b.due ? a : b
  // 完全同步的話，答題次數取多的那邊，統計才不會倒退
  return a.seen >= b.seen ? a : b
}

function mergeHist(
  a: Record<string, DayHist>,
  b: Record<string, DayHist>,
): Record<string, DayHist> {
  const out: Record<string, DayHist> = { ...a }
  for (const [day, theirs] of Object.entries(b)) {
    const mine = out[day]
    if (!mine) {
      out[day] = theirs
      continue
    }
    const merged = emptyHist()
    for (const key of Object.keys(merged) as (keyof DayHist)[]) {
      merged[key] = Math.max(mine[key], theirs[key])
    }
    out[day] = merged
  }
  return out
}

/** 今天學過幾個新字。同一天取多的，不同天取晚的 */
function mergeNewDay(a: AppState['newDay'], b: AppState['newDay']): AppState['newDay'] {
  if (a.d === b.d) return { d: a.d, n: Math.max(a.n, b.n) }
  return a.d > b.d ? a : b
}
