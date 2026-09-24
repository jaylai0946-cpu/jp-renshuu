const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * PBKDF2 的迭代次數。高一點讓「拿常見密碼去猜」變慢，
 * 但這是在手機上跑的，太高會讓登入卡住。20 萬在 iPhone 上大約 0.3 秒。
 */
const ITERATIONS = 200_000

export const MIN_NAME = 2
export const MIN_PASSWORD = 8

/**
 * 名字 + 密碼 → 同步密鑰。
 *
 * 這個 App 沒有伺服器端的帳號：Worker 只看得到一組 32 字元的密鑰，
 * 不知道誰是誰。登入頁只是把「產生／輸入密鑰」換成人記得住的東西——
 * 同一組名字和密碼在任何裝置都會算出同一組密鑰，所以不用再複製連結。
 *
 * 代價要講清楚：**密碼就是帳號**。猜中名字和密碼的人就拿得到那份進度，
 * 沒有伺服器端的次數限制擋著（同步端點沒有限流）。所以密碼要夠長，
 * 而且不要跟別的服務共用。
 */
export async function deriveKey(name: string, password: string): Promise<string> {
  const encoder = new TextEncoder()
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  // salt 綁名字，這樣不同人用同一個密碼也會得到不同的密鑰
  const salt = encoder.encode(`jp-renshuu|${normalizeName(name)}`)
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  )

  // 32 bytes -> 32 個小寫英數字。取模有一點點偏差，但熵來自密碼，這裡的偏差可以忽略
  return Array.from(new Uint8Array(bits), (b) => ALPHABET[b % ALPHABET.length]).join('')
}

/** 前後空白和大小寫不該讓人登不進去 */
export function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase()
}

export function validateName(name: string): string | null {
  const n = normalizeName(name)
  if (n.length < MIN_NAME) return `名字至少 ${MIN_NAME} 個字`
  if (n.length > 40) return '名字太長了'
  return null
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD) return `密碼至少 ${MIN_PASSWORD} 個字`
  if (password.length > 200) return '密碼太長了'
  return null
}
