import { useState } from 'react'
import {
  buildInviteLink,
  buildSetupLink,
  describeState,
  generateKey,
  validateEndpoint,
  validateKey,
} from '../lib/sync'
import { syncStatusText } from '../lib/syncStatus'
import type { AppState } from '../types'
import type { useSync } from '../useSync'

interface Props {
  sync: ReturnType<typeof useSync>
  state: AppState
}

export function SyncPanel({ sync, state }: Props) {
  const { config, status } = sync
  const [endpoint, setEndpoint] = useState('')
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function copy(text: string, note: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(note)
    } catch {
      // Safari 在非使用者手勢或權限被擋時會失敗，那就叫出密鑰讓人自己選
      setShowKey(true)
      setCopied('複製不了，請自己長按選取下面的密鑰')
    }
  }

  function enable() {
    const endpointError = validateEndpoint(endpoint.trim())
    if (endpointError) return setError(endpointError)
    const keyError = validateKey(key.trim())
    if (keyError) return setError(keyError)
    setError(null)
    sync.enable(endpoint.trim().replace(/\/+$/, ''), key.trim())
  }

  if (status.kind === 'conflict') {
    return (
      <div className="panel">
        <b>兩邊都有改動</b>
        <p className="muted small">
          這台和雲端在上次同步之後都練過，要留哪一份？留下來的會蓋掉另一份。
        </p>
        <p className="small">
          <b>這台：</b>
          {describeState(state)}
          <br />
          <b>雲端：</b>
          {describeState(status.remote.state)}
        </p>
        <div className="row">
          <button type="button" className="ghost" onClick={() => void sync.resolveWithLocal()}>
            用這台的
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => sync.resolveWithRemote(status.remote)}
          >
            用雲端的
          </button>
        </div>
      </div>
    )
  }

  if (!config) {
    return (
      <div className="panel">
        <p className="muted small">
          要先自己架一台同步伺服器（<code>worker/</code> 裡有現成的 Cloudflare Worker，README 有步驟）。
          兩台裝置填<strong>同一組密鑰</strong>就會互相同步。
        </p>
        <p className="small" style={{ color: 'var(--bad)' }}>
          密鑰就是憑證，沒有帳號密碼。拿到密鑰的人就拿得到你的進度，不要貼到公開的地方。
        </p>
        <label className="small muted" htmlFor="sync-endpoint">
          同步伺服器網址
        </label>
        <input
          id="sync-endpoint"
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://jp-renshuu-sync.你的帳號.workers.dev"
          autoComplete="off"
          spellCheck={false}
        />
        <label className="small muted" htmlFor="sync-key">
          密鑰（32 個小寫英數字）
        </label>
        <input
          id="sync-key"
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="第一台按「產生新密鑰」，第二台貼同一組"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="row">
          <button type="button" className="ghost" onClick={enable}>
            啟用同步
          </button>
          <button type="button" className="ghost" onClick={() => setKey(generateKey())}>
            產生新密鑰
          </button>
        </div>
        {error ? <p className="err small">{error}</p> : null}
      </div>
    )
  }

  return (
    <div className="panel">
      <div className="set">
        <span className="small">狀態</span>
        <span className="muted small">{syncStatusText(status)}</span>
      </div>
      <div className="set">
        <span className="small">伺服器</span>
        <span className="muted small" style={{ wordBreak: 'break-all' }}>
          {config.endpoint}
        </span>
      </div>
      <div className="set">
        <span className="small">密鑰</span>
        <span className="muted small" style={{ wordBreak: 'break-all' }}>
          {showKey ? config.key : '••••••••••••••••••••••••••••••••'}
        </span>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="ghost" onClick={() => void sync.syncNow()}>
          立即同步
        </button>
        <button type="button" className="ghost" onClick={() => setShowKey((v) => !v)}>
          {showKey ? '隱藏密鑰' : '顯示密鑰'}
        </button>
      </div>

      <div className="sec">
        <h3>我的另一台裝置</h3>
        <p className="muted small">
          複製設定連結，用 AirDrop 或訊息傳到自己的另一台，在那台打開就會問要不要連上
          同一份進度。比手打 32 個字元快得多。
        </p>
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => void copy(buildSetupLink(config), '設定連結已複製')}
          >
            複製設定連結
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() => void copy(config.key, '密鑰已複製')}
          >
            只複製密鑰
          </button>
        </div>
        <p className="small" style={{ color: 'var(--bad)' }}>
          這個連結裡含密鑰，等於憑證。只傳給自己，不要傳給別人。
        </p>
      </div>

      <div className="sec">
        <h3>分享給別人</h3>
        <p className="muted small">
          這個 App 沒有帳號系統——<strong>密鑰就是帳號</strong>。別人打開邀請連結會產生
          自己的一組密鑰，進度跟你完全分開，互不影響。
        </p>
        <div className="row">
          <button
            type="button"
            className="ghost"
            onClick={() => void copy(buildInviteLink(config.endpoint), '邀請連結已複製')}
          >
            複製邀請連結（不含密鑰）
          </button>
        </div>
        <p className="muted small">
          對方會用你這台同步伺服器。造句批改也算在你的 API key 上，一人一天最多 50 次。
        </p>
      </div>

      {copied ? <p className="muted small">{copied}</p> : null}

      <div className="row" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            if (window.confirm('關掉同步？這台的進度會留著，雲端那份也會留著。')) {
              void sync.disable(false)
            }
          }}
        >
          關掉同步
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            if (window.confirm('關掉同步並刪掉雲端那份？其他裝置下次開啟就同步不到了。')) {
              void sync.disable(true)
            }
          }}
        >
          關掉並刪除雲端
        </button>
      </div>
    </div>
  )
}
