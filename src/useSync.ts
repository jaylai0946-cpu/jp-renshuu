import { useCallback, useEffect, useRef, useState } from 'react'
import {
  forcePush,
  loadSyncConfig,
  pull,
  push,
  remove,
  saveSyncConfig,
  type RemoteRecord,
  type SyncConfig,
} from './lib/sync'
import { isPristine } from './lib/storage'
import type { AppState } from './types'

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'idle'; at: string | null }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; remote: RemoteRecord }

/** 改完之後等一下再推，免得每打一個字就打一次伺服器。 */
const PUSH_DEBOUNCE_MS = 1500

export function useSync(state: AppState, applyRemote: (next: AppState) => void) {
  const [config, setConfigState] = useState<SyncConfig | null>(loadSyncConfig)
  const [status, setStatus] = useState<SyncStatus>(() =>
    loadSyncConfig() ? { kind: 'idle', at: null } : { kind: 'off' },
  )

  const configRef = useRef(config)
  configRef.current = config
  const stateRef = useRef(state)
  stateRef.current = state
  // 第一次進來還沒對過雲端，不要把本機當成「有改動」推上去
  const settledRef = useRef(false)
  // 剛從雲端套用進來的那份，不能又被當成本機改動推回去，否則兩台會互相彈球
  const appliedRef = useRef<AppState | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  const commitConfig = useCallback((next: SyncConfig | null) => {
    saveSyncConfig(next)
    setConfigState(next)
    configRef.current = next
  }, [])

  const doPush = useCallback(async () => {
    const current = configRef.current
    if (!current) return
    setStatus({ kind: 'busy' })

    const result = await push(current, stateRef.current)
    if (result.status === 'ok') {
      commitConfig({ ...current, lastSeen: result.updatedAt, dirty: false })
      setStatus({ kind: 'idle', at: result.updatedAt })
    } else if (result.status === 'conflict') {
      setStatus({ kind: 'conflict', remote: result.remote })
    } else {
      // 推不上去就把 dirty 留著，下次有機會再推，不要假裝成功
      commitConfig({ ...current, dirty: true })
      setStatus({ kind: 'error', message: result.message })
    }
  }, [commitConfig])

  /** 從雲端拉一次。本機有未推送的改動時不會直接覆蓋。 */
  const syncNow = useCallback(async () => {
    const current = configRef.current
    if (!current) return
    setStatus({ kind: 'busy' })

    const result = await pull(current)

    if (result.status === 'error') {
      setStatus({ kind: 'error', message: result.message })
      return
    }

    if (result.status === 'empty') {
      settledRef.current = true
      await doPush()
      return
    }

    const remote = result.record

    if (current.dirty && remote.updatedAt !== current.lastSeen) {
      // 兩邊都改過，交給使用者決定，不要自己選
      setStatus({ kind: 'conflict', remote })
      return
    }

    if (!current.dirty && remote.updatedAt !== current.lastSeen) {
      appliedRef.current = remote.state
      applyRemote(remote.state)
      commitConfig({ ...current, lastSeen: remote.updatedAt, dirty: false })
      setStatus({ kind: 'idle', at: remote.updatedAt })
      settledRef.current = true
      return
    }

    settledRef.current = true
    if (current.dirty) await doPush()
    else setStatus({ kind: 'idle', at: remote.updatedAt })
  }, [applyRemote, commitConfig, doPush])

  // 開啟 App 時對一次
  useEffect(() => {
    if (config) void syncNow()
    else settledRef.current = true
    // 只在設定變動時重跑
  }, [config?.endpoint, config?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // 本機改動 -> 標記 dirty -> 延遲推送
  useEffect(() => {
    const current = configRef.current
    if (!current || !settledRef.current) return
    if (status.kind === 'conflict') return
    if (appliedRef.current === state) {
      appliedRef.current = null
      return
    }

    commitConfig({ ...current, dirty: true })
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => void doPush(), PUSH_DEBOUNCE_MS)

    return () => window.clearTimeout(timerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // 切回這個分頁時再對一次，這樣另一台的改動才看得到
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible' && configRef.current) void syncNow()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [syncNow])

  const enable = useCallback(
    (endpoint: string, key: string) => {
      settledRef.current = false
      // 還沒動過的新裝置不算「有本機改動」，這樣才不會一啟用就跳衝突
      const dirty = !isPristine(stateRef.current)
      commitConfig({ endpoint, key, lastSeen: null, dirty })
    },
    [commitConfig],
  )

  const disable = useCallback(
    async (alsoDeleteRemote: boolean) => {
      const current = configRef.current
      if (current && alsoDeleteRemote) await remove(current)
      commitConfig(null)
      setStatus({ kind: 'off' })
    },
    [commitConfig],
  )

  const resolveWithLocal = useCallback(async () => {
    const current = configRef.current
    if (!current) return
    setStatus({ kind: 'busy' })
    const result = await forcePush(current, stateRef.current)
    if (result.status === 'ok') {
      commitConfig({ ...current, lastSeen: result.updatedAt, dirty: false })
      setStatus({ kind: 'idle', at: result.updatedAt })
    } else {
      setStatus({
        kind: 'error',
        message: result.status === 'error' ? result.message : '又被改掉了，再試一次',
      })
    }
  }, [commitConfig])

  const resolveWithRemote = useCallback(
    (remote: RemoteRecord) => {
      const current = configRef.current
      if (!current) return
      appliedRef.current = remote.state
      applyRemote(remote.state)
      commitConfig({ ...current, lastSeen: remote.updatedAt, dirty: false })
      setStatus({ kind: 'idle', at: remote.updatedAt })
      settledRef.current = true
    },
    [applyRemote, commitConfig],
  )

  return { config, status, enable, disable, syncNow, resolveWithLocal, resolveWithRemote }
}
