import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyState } from './lib/storage'
import type { AppState } from './types'
import { useSync } from './useSync'

const ENDPOINT = 'https://sync.example.workers.dev'
const KEY = 'k'.repeat(32)

/** 第 n 個版本的進度：每答一題 state 都會換一個新物件 */
function version(n: number): AppState {
  const s = emptyState()
  s.newDay = { d: '2026-10-02', n }
  return s
}

interface Call {
  method: string
  keepalive: boolean
  body: unknown
}

describe('同步的推送頻率', () => {
  let calls: Call[]

  beforeEach(() => {
    vi.useFakeTimers()
    localStorage.clear()
    localStorage.setItem(
      'jp-renshuu.sync',
      JSON.stringify({ endpoint: ENDPOINT, key: KEY, lastSeen: null, dirty: false }),
    )
    calls = []
    let stamp = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit = {}) => {
        const method = init.method ?? 'GET'
        calls.push({
          method,
          keepalive: init.keepalive === true,
          body: init.body ? JSON.parse(String(init.body)) : null,
        })
        // 雲端一開始是空的；之後每次 PUT 都成功
        if (method === 'GET') return new Response('{}', { status: 404 })
        stamp++
        return new Response(JSON.stringify({ updatedAt: `t${stamp}` }), { status: 200 })
      }),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const puts = () => calls.filter((c) => c.method === 'PUT')

  async function mount() {
    const hook = renderHook(({ state }) => useSync(state, () => {}), {
      initialProps: { state: version(0) },
    })
    // 開 App 時對一次雲端：空的就先推一份上去
    await act(() => vi.advanceTimersByTimeAsync(0))
    return hook
  }

  it('一回合 20 題（約一分鐘）只寫雲端幾次，不是每題一次', async () => {
    const { rerender } = await mount()
    const before = puts().length

    for (let n = 1; n <= 20; n++) {
      rerender({ state: version(n) })
      await act(() => vi.advanceTimersByTimeAsync(3_000))
    }
    await act(() => vi.advanceTimersByTimeAsync(25_000))

    const during = puts().length - before
    expect(during).toBeGreaterThan(0)
    expect(during).toBeLessThanOrEqual(4)
    // 最後推上去的是最新的那一份
    expect((puts().at(-1)!.body as { state: AppState }).state.newDay.n).toBe(20)
  })

  it('切到背景會立刻推，並用 keepalive', async () => {
    const { rerender } = await mount()
    const before = puts().length

    rerender({ state: version(1) })
    await act(() => vi.advanceTimersByTimeAsync(1_600))
    rerender({ state: version(2) })
    await act(() => vi.advanceTimersByTimeAsync(100))
    const waiting = puts().length

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await vi.advanceTimersByTimeAsync(0)
    })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })

    expect(puts().length).toBe(waiting + 1)
    expect(puts().at(-1)!.keepalive).toBe(true)
    expect((puts().at(-1)!.body as { state: AppState }).state.newDay.n).toBe(2)
    // 剛開 App 才推過一次，這兩個改動本來要等到 20 秒間隔才推——切到背景時沒有等
    expect(waiting).toBe(before)
  })

  it('flush 會馬上推還沒推的改動；沒有改動就不推', async () => {
    const { result, rerender } = await mount()

    const idle = puts().length
    await act(async () => {
      result.current.flush()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(puts().length).toBe(idle)

    rerender({ state: version(1) })
    await act(() => vi.advanceTimersByTimeAsync(1_600))
    rerender({ state: version(2) })
    const before = puts().length
    await act(async () => {
      result.current.flush()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(puts().length).toBe(before + 1)
    expect((puts().at(-1)!.body as { state: AppState }).state.newDay.n).toBe(2)
  })

  it('閒置一段時間後的第一個改動，1.5 秒內就推', async () => {
    const { rerender } = await mount()
    await act(() => vi.advanceTimersByTimeAsync(60_000))
    const before = puts().length

    rerender({ state: version(1) })
    await act(() => vi.advanceTimersByTimeAsync(1_600))
    expect(puts().length).toBe(before + 1)
  })
})

describe('拉雲端的途中新增東西不會不見', () => {
  function song(id: string): AppState['songs'][number] {
    return {
      id,
      title: id,
      artist: '',
      video: '',
      known: [],
      updated: '2026-10-12T00:00:00.000Z',
      lines: [{ jp: '青い空', kana: '', ro: '', zh: '', note: '', words: [] }],
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('另一台改過雲端、這台拉的途中剛好新增一首歌：合併，不整份套用雲端', async () => {
    const remoteOld = { ...emptyState(), songs: [song('song-old000')] }
    const remoteNew = { ...emptyState(), songs: [song('song-old000'), song('song-phone0')] }
    localStorage.clear()
    localStorage.setItem(
      'jp-renshuu.sync',
      JSON.stringify({ endpoint: ENDPOINT, key: KEY, lastSeen: 'r1', dirty: false }),
    )

    let release: () => void = () => {}
    let gets = 0
    const pushed: AppState[] = []
    // 雲端：另一台在這台第二次拉之前已經推了 r2
    let remote = { updatedAt: 'r2', state: remoteNew }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit = {}) => {
        if ((init.method ?? 'GET') === 'GET') {
          gets++
          if (gets === 1) return new Response(JSON.stringify({ updatedAt: 'r1', state: remoteOld }), { status: 200 })
          // 第二次拉（切回分頁）卡住，等測試放行；這段時間另一台已經推了 r2
          await new Promise<void>((r) => (release = r))
          return new Response(JSON.stringify({ updatedAt: 'r2', state: remoteNew }), { status: 200 })
        }
        const ifMatch = new Headers(init.headers).get('If-Match')?.replace(/"/g, '')
        if (ifMatch !== remote.updatedAt) {
          return new Response(JSON.stringify({ error: 'conflict', remote }), { status: 409 })
        }
        const state = (JSON.parse(String(init.body)) as { state: AppState }).state
        pushed.push(state)
        remote = { updatedAt: `p${pushed.length}`, state }
        return new Response(JSON.stringify({ updatedAt: remote.updatedAt }), { status: 200 })
      }),
    )

    const { result } = renderHook(() => {
      const [state, setState] = useState<AppState>(remoteOld)
      useSync(state, setState)
      return { state, setState }
    })
    await act(async () => {})
    expect(gets).toBe(1)

    // 切回分頁 → 開始拉；拉到一半，歌詞分析回來、新增了一首歌
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => result.current.setState((s) => ({ ...s, songs: [song('song-new000'), ...s.songs] })))
    await act(async () => {
      release()
      await new Promise((r) => setTimeout(r, 0))
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700))
    })

    expect(gets).toBe(2)
    const ids = (s: AppState) => s.songs.map((x) => x.id).sort()
    expect(ids(result.current.state)).toEqual(['song-new000', 'song-old000', 'song-phone0'])
    expect(ids(pushed.at(-1)!)).toEqual(['song-new000', 'song-old000', 'song-phone0'])
  })

  it('開 App 第一次拉雲端還沒回來時新增的東西，拉回來也不會被蓋掉', async () => {
    const remoteNew = { ...emptyState(), songs: [song('song-phone0')] }
    localStorage.clear()
    localStorage.setItem(
      'jp-renshuu.sync',
      JSON.stringify({ endpoint: ENDPOINT, key: KEY, lastSeen: 'r1', dirty: false }),
    )
    let release: () => void = () => {}
    let remote = { updatedAt: 'r2', state: remoteNew }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit = {}) => {
        if ((init.method ?? 'GET') === 'GET') {
          await new Promise<void>((r) => (release = r))
          return new Response(JSON.stringify(remote), { status: 200 })
        }
        const ifMatch = new Headers(init.headers).get('If-Match')?.replace(/"/g, '')
        if (ifMatch !== remote.updatedAt) {
          return new Response(JSON.stringify({ error: 'conflict', remote }), { status: 409 })
        }
        remote = { updatedAt: 'p', state: (JSON.parse(String(init.body)) as { state: AppState }).state }
        return new Response(JSON.stringify({ updatedAt: 'p' }), { status: 200 })
      }),
    )

    const { result } = renderHook(() => {
      const [state, setState] = useState<AppState>(emptyState())
      useSync(state, setState)
      return { state, setState }
    })
    act(() => result.current.setState((s) => ({ ...s, songs: [song('song-new000')] })))
    await act(async () => {
      release()
      await new Promise((r) => setTimeout(r, 50))
    })

    const ids = (s: AppState) => s.songs.map((x) => x.id).sort()
    expect(ids(result.current.state)).toEqual(['song-new000', 'song-phone0'])
    expect(ids(remote.state)).toEqual(['song-new000', 'song-phone0'])
  })
})
