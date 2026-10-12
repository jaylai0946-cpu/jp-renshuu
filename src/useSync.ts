import { useCallback, useEffect, useRef, useState } from 'react'
import {
  loadSyncConfig,
  pull,
  push,
  remove,
  saveSyncConfig,
  type SyncConfig,
} from './lib/sync'
import { mergeStates } from './lib/merge'
import { isPristine } from './lib/storage'
import type { AppState } from './types'

export type SyncStatus =
  | { kind: 'off' }
  | { kind: 'idle'; at: string | null }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  /** 剛把兩台的進度合起來 */
  | { kind: 'merged'; at: string }

/** 改完之後至少等這麼久再推，連續幾個改動併成一次 */
const PUSH_DEBOUNCE_MS = 1500

/**
 * 兩次推送至少隔這麼久。
 *
 * 原本是改完 1.5 秒就推，練習時幾乎每答一題就寫一次雲端。Cloudflare KV
 * 免費方案一天只能寫 1,000 次，十幾個人同一天練習就會撞到上限、同步失敗。
 * 改成最多 20 秒推一次；切到背景、關掉頁面、一回合結束時會立刻推（flush），
 * 所以換到另一台裝置時看到的還是最新的。
 */
const PUSH_INTERVAL_MS = 20_000

export function useSync(state: AppState, applyRemote: (next: AppState) => void) {
  const [config, setConfigState] = useState<SyncConfig | null>(loadSyncConfig)
  const [status, setStatus] = useState<SyncStatus>(() =>
    loadSyncConfig() ? { kind: 'idle', at: null } : { kind: 'off' },
  )

  /*
   * configRef 只由 commitConfig 寫（它是 setConfigState 的唯一呼叫處）。
   *
   * 刻意不在 render 期寫 configRef.current = config：那行會跟 commitConfig
   * 的即時寫入打架。登出時 commitConfig(null) 先把 ref 清成 null，但只要
   * 之後有任何一次 render 的 config state 還沒更新成 null（例如同時有
   * setStatus 進來、兩次更新沒有被批在同一個 render），那行就會把舊設定
   * 塞回 ref，接著 [state] 的 effect 讀到它、又 commitConfig 寫回
   * localStorage——登出之後同步設定復活。
   */
  const configRef = useRef(config)
  const stateRef = useRef(state)
  stateRef.current = state
  // 第一次進來還沒對過雲端，不要把本機當成「有改動」推上去
  const settledRef = useRef(false)
  // 剛從雲端套用進來的那份，不能又被當成本機改動推回去，否則兩台會互相彈球
  const appliedRef = useRef<AppState | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  /** 上一次開始推送的時間。用來算下一次最早什麼時候能推 */
  const lastPushRef = useRef(0)
  /**
   * 本機改動的流水號，每改一次加一。
   *
   * 拉／推都要等網路，等的途中使用者可能又改了東西（例如歌詞分析剛好回來、新增了一首歌）。
   * 網路回來時不能拿出發前的 dirty 判斷，不然會把雲端那份整份蓋到本機、
   * 或把還沒推的改動標成已推——剛新增的歌就這樣不見。用流水號比對出發前後有沒有新改動。
   */
  const revRef = useRef(0)
  /** 上一次看到的 state，第一次 render 不算改動 */
  const lastStateRef = useRef(state)

  /** 元件已經卸載就不要再寫。非同步的同步鏈可能在卸載之後才回來 */
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const commitConfig = useCallback((next: SyncConfig | null) => {
    if (!mountedRef.current) return
    saveSyncConfig(next)
    setConfigState(next)
    configRef.current = next
  }, [])

  /**
   * 網路來回期間使用者可能登出、或換了另一組設定。回來之後要確認手上這份
   * 還是當下那一份，不然會把已經清掉的設定寫回去——登出之後同步設定復活，
   * 下一個人在這台裝置就會被接到上一個人的帳號。
   */
  function stillCurrent(config: SyncConfig): boolean {
    return configRef.current === config
  }

  const doPush = useCallback(async (options: { keepalive?: boolean } = {}) => {
    window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    const current = configRef.current
    if (!current) return
    lastPushRef.current = Date.now()
    setStatus({ kind: 'busy' })
    const rev = revRef.current

    const result = await push(current, stateRef.current, options)
    if (!stillCurrent(current)) return

    if (result.status === 'ok') {
      // 推的途中又有改動的話還是 dirty，等下一次推（改動時已經排好了）
      commitConfig({ ...current, lastSeen: result.updatedAt, dirty: revRef.current !== rev })
      setStatus({ kind: 'idle', at: result.updatedAt })
    } else if (result.status === 'conflict') {
      // 推的途中另一台先推上去了。合併之後再推一次，一樣不叫人二選一
      const merged = mergeStates(stateRef.current, result.remote.state)
      appliedRef.current = merged
      applyRemote(merged)

      const retry = await push({ ...current, lastSeen: result.remote.updatedAt }, merged)
      if (!stillCurrent(current)) return

      if (retry.status === 'ok') {
        commitConfig({ ...current, lastSeen: retry.updatedAt, dirty: revRef.current !== rev })
        setStatus({ kind: 'merged', at: retry.updatedAt })
      } else {
        // 只重試一次。再撞就把合併結果留在本機，下次開 App 對一次就好
        commitConfig({ ...current, dirty: true })
        setStatus({ kind: 'idle', at: null })
      }
    } else {
      // 推不上去就把 dirty 留著，下次有機會再推，不要假裝成功
      commitConfig({ ...current, dirty: true })
      setStatus({ kind: 'error', message: result.message })
    }
  }, [applyRemote, commitConfig])

  /** 從雲端拉一次。本機有未推送的改動時不會直接覆蓋。 */
  const syncNow = useCallback(async () => {
    const current = configRef.current
    if (!current) return
    setStatus({ kind: 'busy' })
    const rev = revRef.current

    const result = await pull(current)
    if (!stillCurrent(current)) return
    // 拉的途中本機有新改動，也算 dirty：要合併，不能整份套用雲端
    const dirty = current.dirty || revRef.current !== rev

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

    if (dirty && remote.updatedAt !== current.lastSeen) {
      /*
       * 兩邊都練過。合併，不要叫人二選一。
       *
       * 間隔複習的進度本來就合得起來：同一個字取學得比較前面的那邊。
       * 逼人「留這台還是留雲端」等於逼人丟掉一半的練習，而且 iPad 和
       * iPhone 交替用的話幾乎每次切換都會撞到。
       */
      const merged = mergeStates(stateRef.current, remote.state)
      appliedRef.current = merged
      applyRemote(merged)
      settledRef.current = true

      // lastSeen 用剛拉到的那個版本，推上去才不會又被判成衝突
      const rev2 = revRef.current
      const result = await push({ ...current, lastSeen: remote.updatedAt }, merged)
      if (!stillCurrent(current)) return

      if (result.status === 'ok') {
        commitConfig({ ...current, lastSeen: result.updatedAt, dirty: revRef.current !== rev2 })
        setStatus({ kind: 'merged', at: result.updatedAt })
      } else if (result.status === 'conflict') {
        // 合併期間又被另一台改了。合併的結果先留在本機，下次再對一次
        commitConfig({ ...current, dirty: true })
        setStatus({ kind: 'idle', at: null })
      } else {
        commitConfig({ ...current, dirty: true })
        setStatus({ kind: 'error', message: result.message })
      }
      return
    }

    if (!dirty && remote.updatedAt !== current.lastSeen) {
      appliedRef.current = remote.state
      applyRemote(remote.state)
      commitConfig({ ...current, lastSeen: remote.updatedAt, dirty: false })
      setStatus({ kind: 'idle', at: remote.updatedAt })
      settledRef.current = true
      return
    }

    settledRef.current = true
    if (dirty) await doPush()
    else setStatus({ kind: 'idle', at: remote.updatedAt })
  }, [applyRemote, commitConfig, doPush])

  // 開啟 App 時對一次
  useEffect(() => {
    if (config) void syncNow()
    else settledRef.current = true
    // 只在設定變動時重跑
  }, [config?.endpoint, config?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // 本機改動 -> 標記 dirty -> 排一次推送（已經排了就不重排，推的時候會帶最新的 state）
  useEffect(() => {
    if (lastStateRef.current === state) return
    lastStateRef.current = state
    if (appliedRef.current === state) {
      appliedRef.current = null
      return
    }
    // 還沒對完雲端也要記：第一次拉的途中改的東西，拉回來時才知道要合併而不是整份套用
    revRef.current++

    const current = configRef.current
    if (!current || !settledRef.current) return
    commitConfig({ ...current, dirty: true })
    if (timerRef.current !== undefined) return
    const wait = Math.max(PUSH_DEBOUNCE_MS, lastPushRef.current + PUSH_INTERVAL_MS - Date.now())
    timerRef.current = window.setTimeout(() => void doPush(), wait)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // 卸載時把排好的推送取消，免得登出後還推上去
  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  /**
   * 有還沒推上去的改動就馬上推。
   * 一回合結束、切到背景、關掉頁面時呼叫——這些時候使用者可能正要換另一台裝置。
   */
  const flush = useCallback(
    (options: { keepalive?: boolean } = {}) => {
      const current = configRef.current
      if (!current || !settledRef.current) return
      if (timerRef.current === undefined && !current.dirty) return
      void doPush(options)
    },
    [doPush],
  )

  // 切到背景或關掉頁面：立刻推。keepalive 讓頁面消失後請求還能送完
  useEffect(() => {
    function onHide() {
      if (document.visibilityState === 'hidden') flush({ keepalive: true })
    }
    function onPageHide() {
      flush({ keepalive: true })
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [flush])

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

  return { config, status, enable, disable, syncNow, flush }
}
