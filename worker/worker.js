/**
 * 日文練習本的後端。兩件事：同步進度，和呼叫 Claude 批改造句。
 *
 * 跟課表 App 是兩個不同的 Worker、兩個不同的 KV namespace，資料不會互相蓋到。
 *
 * 沒有帳號也沒有密碼——網址裡那組 32 字元的密鑰就是憑證。
 * 密鑰由 App 產生（crypto.getRandomValues），猜中的機率可以忽略，
 * 但也因此：拿到密鑰的人就拿到資料，不要外流。
 *
 * 路由：
 *   GET    /s/<key>      -> 200 {version, updatedAt, state} 或 404
 *   PUT    /s/<key>      -> 200 {updatedAt}；要帶 If-Match: <上次看到的 updatedAt>
 *                           不符會回 409 加上雲端目前的內容，交給前端讓使用者選
 *   DELETE /s/<key>      -> 200
 *   POST   /grade/<key>  -> 200 批改結果，或 429（今天用完了）
 *
 * 部署：
 *   npx wrangler kv namespace create SYNC
 *   （把印出來的 id 填進 wrangler.toml）
 *   npx wrangler secret put ANTHROPIC_API_KEY
 *   npx wrangler deploy
 */

const KEY_PATTERN = /^[a-z0-9]{32}$/
const MAX_BODY_BYTES = 1_000_000 // 1 MB，正常資料連 100 KB 都不到

/** 每組密鑰每天最多批改幾次。API key 在這裡，沒有上限就是把錢包交出去 */
const GRADE_DAILY_LIMIT = 50
const MAX_PROMPT_CHARS = 200
const MAX_ANSWER_CHARS = 500

/** 便宜又快，批改一句日文綽綽有餘。約 US$0.0016 一次 */
const MODEL = 'claude-haiku-4-5'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
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

/** 批改結果的形狀。交給 structured outputs 保證，不靠 prompt 拜託模型 */
const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string',
      enum: ['correct', 'minor', 'wrong'],
      description: 'correct=完全正確，minor=意思對但小地方可以更好，wrong=需要修改',
    },
    corrected: { type: 'string', description: '自然的日文句子，漢字假名混寫' },
    reading: { type: 'string', description: '全平假名讀音' },
    romaji: { type: 'string', description: '羅馬拼音' },
    explain: { type: 'string', description: '繁體中文，60 字內，說明哪裡對、哪裡錯、為什麼' },
    tip: { type: 'string', description: '繁體中文，30 字內，一個和這句相關的小提醒' },
  },
  required: ['verdict', 'corrected', 'reading', 'romaji', 'explain', 'tip'],
  additionalProperties: false,
}

function gradePrompt(question, answer) {
  return (
    '你是溫和但精準的日語老師。學生是台灣的大一日文初學者（剛學完五十音、正在學基本句型）。\n' +
    `題目（中文）：${question}\n` +
    `學生寫的日文（可能用假名、漢字或羅馬拼音）：${answer}\n\n` +
    '請批改。用羅馬拼音作答時，只要拼寫能對應到正確日文就算對，不因為沒用假名扣分。\n' +
    '說明要具體指出是哪個詞或哪個助詞，不要只說「不太自然」。'
  )
}

/** YYYY-MM-DD（UTC）。用來當每日計數的 key */
function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

async function handleGrade(request, env, key) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: '這台 Worker 還沒設定 ANTHROPIC_API_KEY，批改功能沒開' }, 501)
  }

  /*
   * 要先同步過才能用批改。
   *
   * 這是防濫用的關鍵：密鑰格式對不夠，還要真的有一份進度存在這裡，
   * 才代表是這個 App 的使用者。光靠格式的話，隨機猜雖然猜不中，
   * 但也擋不住「拿自己編的密鑰來白嫖 API」。
   */
  const hasState = await env.SYNC.get(`state:${key}`, { type: 'text', cacheTtl: 3600 })
  if (!hasState) {
    return json({ error: '這組密鑰還沒同步過進度。先在 App 裡啟用同步並練一回合' }, 403)
  }

  const counterKey = `grade:${key}:${utcDay()}`
  const used = Number((await env.SYNC.get(counterKey)) ?? 0)
  if (used >= GRADE_DAILY_LIMIT) {
    return json({ error: `今天的批改次數用完了（上限 ${GRADE_DAILY_LIMIT} 次），明天再來` }, 429)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: '不是合法的 JSON' }, 400)
  }

  const question = String(body?.prompt ?? '').trim()
  const answer = String(body?.answer ?? '').trim()
  if (!question || !answer) return json({ error: '題目和答案都要有' }, 400)
  if (question.length > MAX_PROMPT_CHARS || answer.length > MAX_ANSWER_CHARS) {
    return json({ error: '題目或答案太長了' }, 400)
  }

  let upstream
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages: [{ role: 'user', content: gradePrompt(question, answer) }],
        // structured outputs：回傳保證符合 schema，不用在 prompt 裡拜託模型「只回 JSON」
        output_config: { format: { type: 'json_schema', schema: GRADE_SCHEMA } },
      }),
    })
  } catch {
    return json({ error: '連不上批改服務，等一下再試' }, 502)
  }

  if (!upstream.ok) {
    // 不要把上游的錯誤原封不動吐回前端，裡面可能有帳務或金鑰相關的訊息
    const status = upstream.status === 429 ? 429 : 502
    return json({ error: status === 429 ? '批改服務忙碌中，等一分鐘再按' : '批改沒有完成，再試一次' }, status)
  }

  const data = await upstream.json()
  if (data.stop_reason === 'refusal') {
    return json({ error: '這句話沒辦法批改，換一句試試' }, 422)
  }

  const text = (data.content ?? []).find((b) => b.type === 'text')?.text
  if (!text) return json({ error: '批改沒有完成，再試一次' }, 502)

  let result
  try {
    result = JSON.parse(text)
  } catch {
    return json({ error: '批改結果讀不懂，再試一次' }, 502)
  }

  /*
   * 計數用「讀了再寫」，KV 不是強一致，同時打很多次會少算。
   * 這只是防濫用不是計費，少算幾次可以接受；TTL 兩天讓舊的自己消失。
   */
  await env.SYNC.put(counterKey, String(used + 1), { expirationTtl: 60 * 60 * 48 })

  return json({ result, used: used + 1, limit: GRADE_DAILY_LIMIT })
}

async function handleSync(request, env, key) {
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
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)
    const match = url.pathname.match(/^\/(s|grade)\/([^/]+)\/?$/)
    if (!match) return json({ error: 'not found' }, 404)

    const [, route, key] = match
    if (!KEY_PATTERN.test(key)) {
      // 格式不對就直接擋，避免有人拿短字串來暴力試
      return json({ error: '密鑰格式不對，必須是 32 個小寫英數字' }, 400)
    }

    return route === 'grade' ? handleGrade(request, env, key) : handleSync(request, env, key)
  },
}
