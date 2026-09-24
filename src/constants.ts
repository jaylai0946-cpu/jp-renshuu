export const STORAGE_KEY = 'jp-renshuu'
/** 改動 AppState 形狀時 +1，並在 storage.ts 加一段 migration */
export const SCHEMA_VERSION = 2

export const DEFAULT_SETTINGS = {
  newPerDay: 10,
  romaji: true,
  sound: true,
  /** iPad 有筆時預設只讓筆寫，免得手掌壓到就畫一條線 */
  penOnly: true,
  writePerDay: 5,
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

/**
 * 內建的同步伺服器網址。填了之後登入頁就不用再問一次。
 *
 * 這不是機密——機密是密鑰。可以直接寫死在這裡 commit 進 repo，
 * 或在建置時用 VITE_SYNC_ENDPOINT 蓋掉。留空的話登入頁會多一個欄位讓人自己填。
 */
export const DEFAULT_SYNC_ENDPOINT: string = (
  import.meta.env.VITE_SYNC_ENDPOINT ?? 'https://jp-renshuu-sync.jaylai0946.workers.dev'
).trim()
