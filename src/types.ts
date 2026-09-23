/** 假名題與單字題的欄位不同，用 t 分辨。 */
export interface KanaItem {
  /** 'h:あ'（平假名）或 'k:ア'（片假名）。這個格式跟 Artifact 版一樣，匯入舊進度才對得上 */
  id: string
  t: 'kana'
  ch: string
  ro: string
  /** 所屬單元 id */
  u: string
}

export interface WordItem {
  /** 'w:わたし'，用讀音當 key（Artifact 版就是這樣） */
  id: string
  t: 'word'
  /** 漢字寫法；沒有漢字的詞這裡就等於 kana */
  jp: string
  kana: string
  zh: string
  ro: string
  u: string
}

export type Item = KanaItem | WordItem

export interface Unit {
  id: string
  name: string
  kind: 'kana' | 'word'
  /** 假名單元才有：true 代表把平假名轉成片假名 */
  kata: boolean
  items: Item[]
}

/** 一個字的複習進度。辨識和手寫各存一份，會認不代表會寫。 */
export interface Progress {
  /** 盒子 0-6 */
  b: number
  /** 下次該複習的日子，YYYY-MM-DD */
  due: string
  seen: number
  wrong: number
}

export interface DayHist {
  /** 答了幾題 */
  n: number
  /** 第一次就答對幾題 */
  c: number
  xp: number
  /** 造句批改幾次 */
  w: number
  /** 手寫題幾題 */
  h: number
}

export interface Settings {
  newPerDay: number
  romaji: boolean
  sound: boolean
  /** 只讓 Apple Pencil 畫得出線，手指和手掌碰到不算 */
  penOnly: boolean
  /** 每天最多幾題默寫。0 就是關掉 */
  writePerDay: number
  /** 一次連續介紹幾個新字，介紹完才集中出這批的題目 */
  batchSize: number
}

export interface AppState {
  /** schema 版本，migration 用 */
  version: number
  /** 辨識熟練度，key 是 Item.id */
  items: Record<string, Progress>
  /** 手寫熟練度，key 同上。SPEC 要求跟辨識分開排複習 */
  write: Record<string, Progress>
  /** key 是 YYYY-MM-DD */
  hist: Record<string, DayHist>
  settings: Settings
  /** 今天已經學了幾個新字。換日就歸零 */
  newDay: { d: string; n: number }
}
