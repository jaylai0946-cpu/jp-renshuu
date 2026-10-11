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
 *   POST   /grade/<key>  -> 200 批改結果；429（這組密鑰今天用完了）；
 *                           503（全站今天的額度用完了，見 GRADE_GLOBAL_DAILY）
 *   POST   /song/<key>   -> 200 歌詞逐句分析；429／503 同上
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

/**
 * 全部人加起來每天最多批改幾次。
 *
 * 只限每組密鑰不夠：任何人都能在登入頁開新帳號，每開一個就多 50 次。
 * 這個上限讓帳單有天花板——200 次 × 約 US$0.003 ≈ 一天 US$0.6。
 * 可以用 Worker 環境變數 GRADE_GLOBAL_DAILY 覆蓋，不用改程式。
 */
const GRADE_GLOBAL_DAILY = 200
const MAX_PROMPT_CHARS = 200

/** 每組密鑰每天最多分析幾首歌 */
const SONG_DAILY_LIMIT = 3
/**
 * 分析一首歌在全站額度裡算幾次批改。
 * 一首歌大約是一次批改的 15 倍 token（約 US$0.04），用同一個額度管就不用多一個上限
 */
const SONG_WEIGHT = 15
/** 不同的句子最多幾句。重複的副歌只算一次 */
const SONG_MAX_LINES = 60
const SONG_MAX_CHARS = 4000
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

/** 歌詞分析的回傳形狀 */
const SONG_SCHEMA = {
  type: 'object',
  properties: {
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: '對應輸入的行號' },
          kana: { type: 'string', description: '整句的讀音，平假名（外來語可用片假名）' },
          ro: { type: 'string', description: '整句的赫本式羅馬拼音' },
          zh: { type: 'string', description: '台灣繁體中文翻譯，自然的意譯' },
          words: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                s: { type: 'string', description: '在歌詞裡出現的樣子' },
                k: { type: 'string', description: '讀音，平假名' },
                b: { type: 'string', description: '辭書形；和 s 一樣就給空字串' },
                zh: { type: 'string', description: '在這句裡的意思，簡短的繁體中文' },
              },
              required: ['s', 'k', 'b', 'zh'],
              additionalProperties: false,
            },
          },
          note: { type: 'string', description: '值得一提的文法或歌詞用法，一兩句繁體中文；沒有就空字串' },
        },
        required: ['i', 'kana', 'ro', 'zh', 'words', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['lines'],
  additionalProperties: false,
}

function songPrompt(title, artist, lines) {
  return (
    '你是日語老師，學生是台灣的大一日文初學者。下面是學生自己貼上、用來個人學習的日文歌詞，' +
    '每行前面有編號。\n' +
    `歌名：${title}${artist ? `（${artist}）` : ''}\n\n` +
    lines.map((l, i) => `${i}: ${l}`).join('\n') +
    '\n\n逐行分析，每一個編號都要回一筆，i 填那一行的編號，不要漏、不要合併：\n' +
    '- kana：整句讀音。漢字標成平假名，助詞は／へ照實際讀音寫成 わ／え\n' +
    '- ro：整句的赫本式羅馬拼音\n' +
    '- zh：自然的台灣繁體中文翻譯\n' +
    '- words：這句裡值得學的詞（名詞、動詞、形容詞、副詞、常見句型），助詞和太簡單的詞不用列，' +
    '一句最多 6 個。s 要和歌詞裡的寫法一字不差\n' +
    '- note：這句有值得一提的文法、口語縮約或歌詞特有的寫法時，用一兩句說明；沒有就空字串'
  )
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

function globalDailyLimit(env) {
  const n = Number(env.GRADE_GLOBAL_DAILY)
  return Number.isFinite(n) && n >= 0 ? n : GRADE_GLOBAL_DAILY
}

/** YYYY-MM-DD（UTC）。用來當每日計數的 key */
function utcDay() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Claude API 回錯時，轉成給使用者看的話。
 *
 * 上游的訊息原文不吐回前端（可能有帳務或金鑰相關的內容），只說是哪一類問題，
 * 附上狀態碼方便管理員查。原文寫進 Worker 的 log，在 Cloudflare 後台看得到。
 */
async function upstreamError(upstream, what) {
  let type = ''
  let message = ''
  try {
    const body = await upstream.json()
    type = String(body?.error?.type ?? '')
    message = String(body?.error?.message ?? '')
  } catch {
    // 不是 JSON 就算了
  }
  console.log(`claude api ${upstream.status} ${type}: ${message.slice(0, 300)}`)

  const s = upstream.status
  const billing = s === 402 || type === 'billing_error' || /credit|billing/i.test(message)
  let error
  if (s === 429) error = `${what}服務忙碌中，等一分鐘再按`
  else if (billing) error = `${what}暫停：API 額度不足，請管理員到 Anthropic Console 確認額度`
  else if (s === 401 || s === 403) error = `${what}暫停：伺服器的 API key 不對，請管理員重新設定 ANTHROPIC_API_KEY`
  else if (s === 404) error = `${what}暫停：找不到模型，請管理員檢查 Worker 設定`
  else if (s >= 500) error = `${what}服務暫時有問題，等幾分鐘再試`
  else {
    // 其他 400 多半是請求格式的問題，原文對管理員最有用；帳務類上面已經分出去了
    const detail = message.replace(/sk-ant-[\w-]+/g, '***').slice(0, 160)
    error = `${what}沒有完成，再試一次` + (detail ? `。原因：${detail}` : '')
  }
  return json({ error: `${error}（代碼 ${s}）` }, s === 429 ? 429 : 502)
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

  const day = utcDay()
  const globalKey = `grade-all:${day}`
  const globalLimit = globalDailyLimit(env)
  const globalUsed = Number((await env.SYNC.get(globalKey)) ?? 0)
  if (globalUsed >= globalLimit) {
    return json({ error: '今天全站的批改額度用完了，明天再來' }, 503)
  }

  const counterKey = `grade:${key}:${day}`
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

  if (!upstream.ok) return upstreamError(upstream, '批改')

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
   * 真正的硬上限是 Anthropic Console 的每月花費上限（見 README）。
   */
  const ttl = { expirationTtl: 60 * 60 * 48 }
  await Promise.all([
    env.SYNC.put(counterKey, String(used + 1), ttl),
    env.SYNC.put(globalKey, String(globalUsed + 1), ttl),
  ])

  return json({ result, used: used + 1, limit: GRADE_DAILY_LIMIT })
}

/**
 * 歌詞逐句分析。
 *
 * 歌詞是使用者自己貼的，這裡不存——分析完回給 App，存在他自己的同步資料裡。
 * 重複的句子（副歌）只送一次給 Claude，回來再展開，省一半以上的 token。
 */
async function handleSong(request, env, key) {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: '這台 Worker 還沒設定 ANTHROPIC_API_KEY，歌詞分析沒開' }, 501)
  }

  // 跟批改一樣：要先同步過，才代表是這個 App 的使用者
  const hasState = await env.SYNC.get(`state:${key}`, { type: 'text', cacheTtl: 3600 })
  if (!hasState) {
    return json({ error: '這組密鑰還沒同步過進度。先在 App 裡啟用同步並練一回合' }, 403)
  }

  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: '不是合法的 JSON' }, 400)
  }
  const title = String(body?.title ?? '').trim().slice(0, 100)
  const artist = String(body?.artist ?? '').trim().slice(0, 100)
  const lyrics = String(body?.lyrics ?? '')
  if (!title || !lyrics.trim()) return json({ error: '歌名和歌詞都要有' }, 400)
  if (lyrics.length > SONG_MAX_CHARS) return json({ error: `歌詞太長了，最多 ${SONG_MAX_CHARS} 個字` }, 400)

  const all = lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(0, 200))
  const unique = [...new Set(all)]
  if (!unique.length) return json({ error: '歌名和歌詞都要有' }, 400)
  if (unique.length > SONG_MAX_LINES) {
    return json({ error: `歌詞太長了：不同的句子最多 ${SONG_MAX_LINES} 句，這首有 ${unique.length} 句` }, 400)
  }

  const day = utcDay()
  const globalKey = `grade-all:${day}`
  const globalUsed = Number((await env.SYNC.get(globalKey)) ?? 0)
  if (globalUsed + SONG_WEIGHT > globalDailyLimit(env)) {
    return json({ error: '今天全站的 AI 額度用完了，明天再來' }, 503)
  }
  const counterKey = `song:${key}:${day}`
  const used = Number((await env.SYNC.get(counterKey)) ?? 0)
  if (used >= SONG_DAILY_LIMIT) {
    return json({ error: `今天分析歌詞的次數用完了（每天 ${SONG_DAILY_LIMIT} 首），明天再來` }, 429)
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
        max_tokens: 16000,
        messages: [{ role: 'user', content: songPrompt(title, artist, unique) }],
        output_config: { format: { type: 'json_schema', schema: SONG_SCHEMA } },
      }),
    })
  } catch {
    return json({ error: '連不上分析服務，等一下再試' }, 502)
  }
  if (!upstream.ok) return upstreamError(upstream, '分析')

  const data = await upstream.json()
  if (data.stop_reason === 'refusal') return json({ error: '這首歌沒辦法分析，換一首試試' }, 422)
  if (data.stop_reason === 'max_tokens') return json({ error: '這首歌太長了，分析到一半就停了。刪掉一些句子再試' }, 422)
  const text = (data.content ?? []).find((b) => b.type === 'text')?.text
  let parsed
  try {
    parsed = JSON.parse(text ?? '')
  } catch {
    return json({ error: '分析結果讀不懂，再試一次' }, 502)
  }

  // 用行號對回去；模型漏掉的句子留原文，至少不會整首失敗
  const byIndex = new Map()
  for (const l of Array.isArray(parsed?.lines) ? parsed.lines : []) {
    if (Number.isInteger(l?.i) && l.i >= 0 && l.i < unique.length && !byIndex.has(l.i)) byIndex.set(l.i, l)
  }
  const analysed = unique.map((jp, i) => {
    const l = byIndex.get(i)
    return {
      jp,
      kana: String(l?.kana ?? ''),
      ro: String(l?.ro ?? ''),
      zh: String(l?.zh ?? ''),
      words: Array.isArray(l?.words) ? l.words.slice(0, 12) : [],
      note: String(l?.note ?? ''),
    }
  })
  const lineOf = new Map(unique.map((jp, i) => [jp, analysed[i]]))

  const ttl = { expirationTtl: 60 * 60 * 48 }
  await Promise.all([
    env.SYNC.put(counterKey, String(used + 1), ttl),
    env.SYNC.put(globalKey, String(globalUsed + SONG_WEIGHT), ttl),
  ])

  return json({
    song: { title, artist, lines: all.map((jp) => lineOf.get(jp)) },
    used: used + 1,
    limit: SONG_DAILY_LIMIT,
  })
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
    const match = url.pathname.match(/^\/(s|grade|song)\/([^/]+)\/?$/)
    if (!match) return json({ error: 'not found' }, 404)

    const [, route, key] = match
    if (!KEY_PATTERN.test(key)) {
      // 格式不對就直接擋，避免有人拿短字串來暴力試
      return json({ error: '密鑰格式不對，必須是 32 個小寫英數字' }, 400)
    }

    if (route === 'grade') return handleGrade(request, env, key)
    if (route === 'song') return handleSong(request, env, key)
    return handleSync(request, env, key)
  },
}
