/**
 * 判分的門檻，全部集中在這裡。
 *
 * 單位是 KanjiVG 的座標（整個字 109×109），所以 22 大約是字寬的 20%。
 * 刻意先給寬鬆的值——一開始就嚴格的話，寫對了卻一直被判錯，人會直接放棄。
 * 實際用過之後往下調。
 */
export interface Thresholds {
  /** 起筆點可以離範本多遠。用來抓「從另一端起筆」和筆順顛倒 */
  startMax: number
  /** 逐點平均距離的上限。超過就是形狀偏了 */
  shapeMax: number
  /** 平均距離在這之內算寫得好 */
  shapeGood: number
}

/** Apple Pencil：有筆尖精度，可以稍微嚴一點 */
export const PEN: Thresholds = {
  startMax: 22,
  shapeMax: 16,
  shapeGood: 9,
}

/** 手指或滑鼠：接觸面積大、控制差，門檻放寬 */
export const FINGER: Thresholds = {
  startMax: 30,
  shapeMax: 23,
  shapeGood: 14,
}

export function thresholdsFor(penOnly: boolean): Thresholds {
  return penOnly ? PEN : FINGER
}
