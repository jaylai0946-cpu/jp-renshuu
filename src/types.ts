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

/** 外觀。auto 跟著系統的深色模式 */
export type Theme = 'auto' | 'light' | 'dark'

/** 動畫效果。classic 是原本的樣子；game 加上滾動數字、彈跳回饋、分頁滑動 */
export type MotionStyle = 'classic' | 'game'

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
  /** 答對時小震一下。iPad 沒有馬達，開了也不會震 */
  haptics: boolean
  theme: Theme
  motion: MotionStyle
}

/** 歌詞裡一個值得學的詞 */
export interface SongWord {
  /** 歌詞裡出現的樣子 */
  s: string
  /** 讀音（平假名） */
  k: string
  /** 辭書形。跟 s 一樣就是空字串 */
  b: string
  /** 在這句裡的意思 */
  zh: string
}

/** 歌詞的一句，連同 AI 分析的結果 */
export interface SongLine {
  jp: string
  kana: string
  ro: string
  zh: string
  words: SongWord[]
  /** 文法或歌詞特有用法的說明，沒有就是空字串 */
  note: string
}

/**
 * 使用者自己貼進來的一首歌。
 *
 * 歌詞有版權，App 不內建任何歌；這裡只存使用者自己貼的、給自己學的內容，
 * 跟著他的帳號同步，不會分享給別人。
 */
export interface Song {
  id: string
  title: string
  artist: string
  /** YouTube 影片 id，沒有就是空字串 */
  video: string
  lines: SongLine[]
  /** 標成「會了」的詞，key 是 `${s}|${k}` */
  known: string[]
  /** 最後修改時間（ISO），兩台都改過同一首時取新的 */
  updated: string
  /** 中文翻譯是使用者自己貼的（重新分析時要沿用，不能讓 AI 蓋掉） */
  ownZh?: true
  /** 刪掉的歌留個墓碑，不然同步時另一台會把它加回來 */
  deleted?: true
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
  /** 從日文歌學的歌，使用者自己貼的歌詞 */
  songs: Song[]
}
