import rawStrokes from '../data/strokes.json'
import { flattenPath, resample, type Point } from './path'

/**
 * KanjiVG 的筆順資料。key 是單一假名，value 是照筆順排的 SVG path。
 * 由 scripts/build-kanjivg.mjs 產生，不要手改。
 *
 * 資料來源 KanjiVG（Ulrich Apel），CC BY-SA 3.0。「關於」頁有標示。
 */
export const STROKE_PATHS: Record<string, string[]> = rawStrokes

/** KanjiVG 的座標系。使用者寫的筆畫要先縮到這個尺度才比得了 */
export const KANJIVG_SIZE = 109

/** 每一筆重新取樣成幾個點。判分和畫動畫都用這個 */
export const SAMPLES_PER_STROKE = 32

export function hasStrokes(ch: string): boolean {
  return Array.isArray(STROKE_PATHS[ch]) && STROKE_PATHS[ch].length > 0
}

export function strokeCount(ch: string): number {
  return STROKE_PATHS[ch]?.length ?? 0
}

/** 一個字全部的筆順 path。拗音這種兩個字的詞要自己逐字拆。 */
export function pathsFor(ch: string): string[] {
  return STROKE_PATHS[ch] ?? []
}

// 同一個字會被反覆拿來判分和畫動畫，解析一次就好
const templateCache = new Map<string, Point[][]>()

/**
 * 範本筆畫，每筆取樣成 SAMPLES_PER_STROKE 個等距點，座標在 109×109 裡。
 * 沒有這個字就回空陣列。
 */
export function templateFor(ch: string): Point[][] {
  const cached = templateCache.get(ch)
  if (cached) return cached

  const points = pathsFor(ch).map((d) => resample(flattenPath(d), SAMPLES_PER_STROKE))
  templateCache.set(ch, points)
  return points
}

/** 畫動畫要用比較密的點，取樣點太少轉折處會看得出折角 */
export function outlineFor(ch: string, perCurve = 12): Point[][] {
  return pathsFor(ch).map((d) => flattenPath(d, perCurve))
}

/**
 * 把畫布上的座標縮到 KanjiVG 的 109×109。
 * 田字格是正方形，所以長寬同一個比例，不用管變形。
 */
export function toKanjiVGSpace(points: Point[], canvasSize: number): Point[] {
  const k = KANJIVG_SIZE / canvasSize
  return points.map((p) => ({ x: p.x * k, y: p.y * k }))
}
