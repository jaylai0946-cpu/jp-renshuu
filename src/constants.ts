export const STORAGE_KEY = 'jp-renshuu'
/** 改動 AppState 形狀時 +1，並在 storage.ts 加一段 migration */
export const SCHEMA_VERSION = 1

export const DEFAULT_SETTINGS = {
  newPerDay: 10,
  romaji: true,
  sound: true,
  /** iPad 有筆時預設只讓筆寫，免得手掌壓到就畫一條線 */
  penOnly: true,
  /** 階段 3 才有手寫 UI，在那之前預設不出默寫題；升級時用 migration 改成 5 */
  writePerDay: 0,
  /**
   * 一次教幾個新字。
   *
   * 舊版是把新字打散在複習題裡一個一個冒出來，每冒一個就中斷一次節奏。
   * 改成先連續介紹一批，再集中考這批——記憶研究上這樣比一次一個有效，
   * 實際用起來也比較不會被打斷。
   */
  batchSize: 5,
} as const

export const NEW_PER_DAY_CHOICES = [5, 10, 15, 20]
export const WRITE_PER_DAY_CHOICES = [0, 3, 5, 10]
export const BATCH_SIZE_CHOICES = [3, 5, 8, 10]
