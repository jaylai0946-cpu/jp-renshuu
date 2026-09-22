/**
 * 日文練習本的同步後端。整個 API 只有三件事：讀、寫、刪。
 *
 * 跟課表 App 是兩個不同的 Worker、兩個不同的 KV namespace，資料不會互相蓋到。
 *
 * 沒有帳號也沒有密碼——網址裡那組 32 字元的密鑰就是憑證。
 * 密鑰由 App 產生（crypto.getRandomValues），猜中的機率可以忽略，
 * 但也因此：拿到密鑰的人就拿到資料，不要外流。
 *
 * 路由：
 *   GET    /s/<key>  -> 200 {version, updatedAt, state} 或 404
 *   PUT    /s/<key>  -> 200 {updatedAt}；要帶 If-Match: <上次看到的 updatedAt>
 *                       不符會回 409 加上雲端目前的內容，交給前端讓使用者選
 *   DELETE /s/<key>  -> 200
 *
 * 階段 4 會再加一個 POST /grade/<key>（造句批改），API key 放 wrangler secret。
 *
 * 部署：
 *   npx wrangler kv namespace create SYNC
 *   （把印出來的 id 填進 wrangler.toml）
 *   npx wrangler deploy
 */

const KEY_PATTERN = /^[a-z0-9]{32}$/
const MAX_BODY_BYTES = 1_000_000 // 1 MB，正常資料連 100 KB 都不到

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-Match',
  'Access-Control-Expose-Headers': 'ETag',
  'Access-Control-Max-Age': '86400',
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  })
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    const match = url.pathname.match(/^\/s\/([^/]+)\/?$/)
    if (!match) return json({ error: 'not found' }, 404)

    const key = match[1]
    if (!KEY_PATTERN.test(key)) {
      // 格式不對就直接擋，避免有人拿短字串來暴力試
      return json({ error: '密鑰格式不對，必須是 32 個小寫英數字' }, 400)
    }

    const kvKey = `state:${key}`

    if (request.method === 'GET') {
      const stored = await env.SYNC.get(kvKey, 'json')
      if (!stored) return json({ error: 'empty' }, 404)
      return json(stored, 200, { ETag: `"${stored.updatedAt}"` })
    }

    if (request.method === 'PUT') {
      const text = await request.text()
      if (text.length > MAX_BODY_BYTES) return json({ error: '資料太大' }, 413)

      let incoming
      try {
        incoming = JSON.parse(text)
      } catch {
        return json({ error: '不是合法的 JSON' }, 400)
      }
      if (typeof incoming?.state !== 'object' || incoming.state === null) {
        return json({ error: '缺少 state' }, 400)
      }

      const current = await env.SYNC.get(kvKey, 'json')
      const ifMatch = request.headers.get('If-Match')?.replace(/"/g, '') ?? null

      // 樂觀鎖：雲端已經被另一台改過就不要蓋，把現況回給前端讓使用者選
      if (current && ifMatch !== current.updatedAt) {
        return json({ error: 'conflict', remote: current }, 409)
      }

      const record = {
        version: incoming.version ?? 0,
        updatedAt: new Date().toISOString(),
        state: incoming.state,
      }
      await env.SYNC.put(kvKey, JSON.stringify(record))
      return json({ updatedAt: record.updatedAt }, 200, { ETag: `"${record.updatedAt}"` })
    }

    if (request.method === 'DELETE') {
      await env.SYNC.delete(kvKey)
      return json({ ok: true })
    }

    return json({ error: 'method not allowed' }, 405)
  },
}
