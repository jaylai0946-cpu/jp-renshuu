import { useState } from 'react'
import { DEFAULT_SYNC_ENDPOINT } from '../constants'
import { deriveKey, validateName, validatePassword } from '../lib/account'
import { pull, validateEndpoint, type SyncConfig } from '../lib/sync'
import { Hanko } from './Hanko'

interface Props {
  /** 登入成功：上層拿去 enable 同步 */
  onLogin: (endpoint: string, key: string) => void
  /** 不用同步，只存這台 */
  onSkip: () => void
}

/**
 * 登入頁。
 *
 * 這個 App 沒有伺服器端的帳號——Worker 只看得到一組 32 字元的密鑰。
 * 這裡做的是：名字 + 密碼在這台裝置上算出密鑰（PBKDF2），同一組在任何
 * 裝置都會算出同一組密鑰。所以「登入」等於「換算出自己的那份進度」，
 * 不同的人算出不同的密鑰，資料天生就是分開的。
 *
 * 因為沒有伺服器在核對，打錯密碼不會報錯，只會算出另一組密鑰、連到一份
 * 空的進度。所以登入時會先去雲端探一下：沒有東西就明講「要建立新的嗎」，
 * 打錯字的人才有機會回頭。
 */
export function Login({ onLogin, onSkip }: Props) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [endpoint, setEndpoint] = useState(DEFAULT_SYNC_ENDPOINT)
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const needsEndpoint = !DEFAULT_SYNC_ENDPOINT

  async function submit() {
    if (busy) return
    const target = endpoint.trim().replace(/\/+$/, '')
    const problem = validateEndpoint(target) || validateName(name) || validatePassword(password)
    if (problem) return setError(problem)

    setError('')
    setBusy(true)
    try {
      const key = await deriveKey(name, password)
      const config: SyncConfig = { endpoint: target, key, lastSeen: null, dirty: false }

      // 先探一下雲端有沒有這份進度，才分得出「新帳號」和「密碼打錯」
      const probe = await pull(config)
      if (probe.status === 'error') {
        setError(probe.message)
        return
      }
      if (probe.status === 'empty') {
        const ok = window.confirm(
          `「${name.trim()}」目前沒有進度。\n\n` +
            '如果你是第一次用，按確定會建立一份新的。\n' +
            '如果你以前用過，那就是名字或密碼打錯了——按取消再檢查一次。',
        )
        if (!ok) return
      }
      onLogin(target, key)
    } catch {
      setError('這台裝置算不出密鑰，換個瀏覽器試試')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <div className="center" style={{ marginBottom: 26 }}>
        <Hanko glyph="日" caption="練習本" big />
        <h1 className="title" style={{ marginTop: 18 }}>
          日文練習本
        </h1>
        <p className="muted small">輸入名字和密碼，就能在所有裝置上用同一份進度。</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {needsEndpoint ? (
          <>
            <label className="small muted" htmlFor="login-endpoint">
              同步伺服器網址
            </label>
            <input
              id="login-endpoint"
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://jp-renshuu-sync.xxx.workers.dev"
              autoComplete="off"
              spellCheck={false}
            />
          </>
        ) : null}

        <label className="small muted" htmlFor="login-name">
          名字
        </label>
        <input
          id="login-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如 jay"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
        />

        <label className="small muted" htmlFor="login-password">
          密碼
        </label>
        <input
          id="login-password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="至少 8 個字"
          autoComplete="current-password"
        />

        <div className="row" style={{ marginBottom: 14 }}>
          <button type="button" className="ghost" onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? '隱藏密碼' : '顯示密碼'}
          </button>
        </div>

        <button type="submit" className="primary" disabled={busy}>
          {busy ? '登入中…' : '登入 / 建立'}
        </button>
      </form>

      {error ? <p className="err">{error}</p> : null}

      <div className="panel sec">
        <p className="small" style={{ margin: 0 }}>
          <strong>沒有伺服器在核對密碼。</strong>
          名字和密碼是在你的裝置上算成一組密鑰，伺服器只看得到那組密鑰、不知道你是誰。
        </p>
        <p className="small" style={{ color: 'var(--bad)' }}>
          所以密碼就是帳號：猜中的人就拿得到你的進度。用長一點的，也不要跟別的服務共用。
        </p>
        <p className="muted small" style={{ marginBottom: 0 }}>
          忘記密碼沒辦法救——沒有人有那份資料可以幫你重設。
        </p>
      </div>

      <div className="sec">
        <button type="button" className="ghost" onClick={onSkip} style={{ width: '100%' }}>
          先不同步，只存在這台裝置
        </button>
      </div>
    </div>
  )
}
