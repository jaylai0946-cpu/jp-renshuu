import { urlFor, type SyncConfig } from './sync'

export type GradeVerdict = 'correct' | 'minor' | 'wrong'

export interface GradeResult {
  verdict: GradeVerdict
  corrected: string
  reading: string
  romaji: string
  explain: string
  tip: string
}

export type GradeResponse =
  | { status: 'ok'; result: GradeResult; used: number; limit: number }
  | { status: 'error'; message: string }

/** Worker 會回 { error } 或 { result }，兩種都可能。只信自己看得懂的欄位 */
function pickError(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
    return (body as { error: string }).error
  }
  return fallback
}

function isResult(v: unknown): v is GradeResult {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  return (
    (r.verdict === 'correct' || r.verdict === 'minor' || r.verdict === 'wrong') &&
    typeof r.corrected === 'string'
  )
}

/**
 * 送去 Worker 批改。
 *
 * API key 只在 Worker 的 secret 裡，前端從頭到尾拿不到、也不需要知道——
 * 這裡只認得同步用的那組密鑰。
 */
export async function grade(
  config: SyncConfig,
  prompt: string,
  answer: string,
): Promise<GradeResponse> {
  let res: Response
  try {
    res = await fetch(urlFor(config, 'grade'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, answer }),
    })
  } catch {
    return { status: 'error', message: '連不上批改服務，檢查一下網路' }
  }

  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    // 有些錯誤不會回 JSON，下面用狀態碼給訊息
  }

  if (!res.ok) {
    if (res.status === 501) {
      return {
        status: 'error',
        message: pickError(body, '這台 Worker 還沒設定 API key，批改功能沒開'),
      }
    }
    return { status: 'error', message: pickError(body, `批改失敗（${res.status}）`) }
  }

  const result = (body as { result?: unknown } | null)?.result
  if (!isResult(result)) return { status: 'error', message: '批改結果讀不懂，再按一次' }

  const meta = body as { used?: unknown; limit?: unknown }
  return {
    status: 'ok',
    result,
    used: typeof meta.used === 'number' ? meta.used : 0,
    limit: typeof meta.limit === 'number' ? meta.limit : 0,
  }
}

export const GRADE_LABEL: Record<GradeVerdict, { mark: string; text: string }> = {
  correct: { mark: '合格', text: '完全正確' },
  minor: { mark: '惜', text: '意思對了，小地方可以更好' },
  wrong: { mark: '直', text: '這句需要修改' },
}
