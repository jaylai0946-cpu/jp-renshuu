import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { STORAGE_KEY } from '../constants'
import { ymd } from '../lib/dates'
import type { AppState } from '../types'

const ENDPOINT = 'https://sync.example.workers.dev'
const KEY = 's'.repeat(32)

const ANALYSED = {
  title: '空の歌',
  artist: '某歌手',
  lines: [
    {
      jp: '青い空を見上げて',
      kana: 'あおいそらをみあげて',
      ro: 'aoi sora wo miagete',
      zh: '抬頭望著藍天',
      note: '「見上げて」是て形，表示接著做下一個動作。',
      words: [
        { s: '青い', k: 'あおい', b: '', zh: '藍色的' },
        { s: '空', k: 'そら', b: '', zh: '天空' },
        { s: '見上げて', k: 'みあげて', b: '見上げる', zh: '抬頭看' },
      ],
    },
    {
      jp: '君と歩いた道',
      kana: 'きみとあるいたみち',
      ro: 'kimi to aruita michi',
      zh: '和你走過的路',
      note: '',
      words: [
        { s: '君', k: 'きみ', b: '', zh: '你' },
        { s: '歩いた', k: 'あるいた', b: '歩く', zh: '走過' },
        { s: '道', k: 'みち', b: '', zh: '路' },
      ],
    },
  ],
}

describe('歌曲', () => {
  let songCalls: unknown[]

  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem('jp-renshuu.sync', JSON.stringify({ endpoint: ENDPOINT, key: KEY, lastSeen: null, dirty: false }))
    window.location.hash = ''
    songCalls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        if (url.includes('/song/')) {
          songCalls.push(JSON.parse(String(init.body)))
          return new Response(JSON.stringify({ song: ANALYSED, used: 1, limit: 3 }), { status: 200 })
        }
        if ((init.method ?? 'GET') === 'GET') return new Response('{}', { status: 404 })
        return new Response(JSON.stringify({ updatedAt: 't1' }), { status: 200 })
      }),
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(Math, 'random').mockReturnValue(0.3)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function addSong() {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /歌曲/ }))
    fireEvent.click(screen.getByRole('button', { name: /新增第一首歌/ }))
    fireEvent.change(screen.getByLabelText('歌名'), { target: { value: '空の歌' } })
    fireEvent.change(screen.getByLabelText('歌手（選填）'), { target: { value: '某歌手' } })
    fireEvent.change(screen.getByLabelText(/YouTube 連結/), { target: { value: 'https://youtu.be/dQw4w9WgXcQ' } })
    fireEvent.change(screen.getByLabelText(/日文歌詞/), { target: { value: '青い空を見上げて\n君と歩いた道' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '分析歌詞' }))
    })
  }

  const firstLine = () => document.querySelector<HTMLButtonElement>('.lyric-text')!

  it('貼歌詞 → 分析 → 逐句顯示，存進進度', async () => {
    await addSong()

    expect(songCalls).toEqual([{ title: '空の歌', artist: '某歌手', lyrics: '青い空を見上げて\n君と歩いた道' }])
    expect(screen.getByRole('button', { name: '唸「青い空を見上げて」' })).toBeInTheDocument()
    expect(screen.getByText('抬頭望著藍天')).toBeInTheDocument()
    expect(screen.getByTitle('空の歌 的影片')).toHaveAttribute(
      'src',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    )

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.songs).toHaveLength(1)
    expect(saved.songs[0]).toMatchObject({ title: '空の歌', video: 'dQw4w9WgXcQ' })
  })

  it('點一句看單字和文法；點單字標成會了', async () => {
    await addSong()
    fireEvent.click(firstLine())
    expect(screen.getByText('「見上げて」是て形，表示接著做下一個動作。')).toBeInTheDocument()

    const word = screen.getByRole('button', { name: /^見上げて.*抬頭看/ })
    fireEvent.click(word)
    expect(word).toHaveAttribute('aria-pressed', 'true')
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.songs[0].known).toEqual(['見上げて|みあげて'])
  })

  it('單字對照：每個詞底下標中文，可以關掉', async () => {
    await addSong()
    const line = document.querySelector('.lyric .gloss')!
    const marked = [...line.querySelectorAll('.g.w')].map((el) => [
      el.querySelector('.gw')!.textContent,
      el.querySelector('.gz')!.textContent,
    ])
    expect(marked).toEqual([
      ['青い', '藍色的'],
      ['空', '天空'],
      ['見上げて', '抬頭看'],
    ])
    expect(line.textContent?.replace(/藍色的|天空|抬頭看/g, '')).toBe('青い空を見上げて')

    fireEvent.click(screen.getByRole('button', { name: '單字對照' }))
    expect(document.querySelector('.lyric .gloss')).toBeNull()
  })

  it('重新分析：同一份歌詞再送一次，影片和會了的詞留著', async () => {
    await addSong()
    fireEvent.click(firstLine())
    fireEvent.click(screen.getByRole('button', { name: /^見上げて.*抬頭看/ }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重新分析' }))
    })
    expect(songCalls).toHaveLength(2)
    // AI 翻的翻譯不送回去，讓它重翻
    expect(songCalls[1]).toEqual({ title: '空の歌', artist: '某歌手', lyrics: '青い空を見上げて\n君と歩いた道' })
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.songs.filter((x) => !x.deleted)).toHaveLength(1)
    expect(saved.songs[0]).toMatchObject({ video: 'dQw4w9WgXcQ', known: ['見上げて|みあげて'] })
  })

  it('日中交錯貼、另外貼中文：只送日文去分析，中文當翻譯參考；重新分析沿用自己的翻譯', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /歌曲/ }))
    fireEvent.click(screen.getByRole('button', { name: /新增第一首歌/ }))
    fireEvent.change(screen.getByLabelText('歌名'), { target: { value: '空の歌' } })
    fireEvent.change(screen.getByLabelText(/日文歌詞/), {
      target: { value: '青い空を見上げて\n抬頭望著藍天\n君と歩いた道' },
    })
    expect(screen.getByText(/裡面有 1 行中文/)).toBeInTheDocument()
    expect(screen.getByText(/2 \/ 60 句/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/中文歌詞/), { target: { value: '和你走過的路' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '分析歌詞' }))
    })
    expect(songCalls[0]).toEqual({
      title: '空の歌',
      artist: '',
      lyrics: '青い空を見上げて\n君と歩いた道',
      zh: '抬頭望著藍天\n和你走過的路',
    })
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.songs[0].ownZh).toBe(true)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '重新分析' }))
    })
    expect(songCalls[1]).toMatchObject({ zh: '抬頭望著藍天\n和你走過的路' })
  })

  it('把中文關掉可以先自己猜', async () => {
    await addSong()
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
    expect(screen.queryByText('抬頭望著藍天')).not.toBeInTheDocument()
  })

  it('練習：答完一題算進今天的答題數和點數', async () => {
    await addSong()
    fireEvent.click(screen.getByRole('button', { name: '練習這首歌' }))
    expect(screen.getByText(/空の歌・第 1 \/ 6 題/)).toBeInTheDocument()

    const choices = screen.getAllByRole('button').filter((b) => b.className.includes('choice'))
    expect(choices).toHaveLength(4)
    fireEvent.click(choices[0])
    expect(screen.getByRole('status')).toBeInTheDocument()

    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.hist[ymd()].n).toBe(1)
  })

  it('刪掉之後列表就沒有了', async () => {
    await addSong()
    fireEvent.click(screen.getByRole('button', { name: '刪掉這首歌' }))
    expect(screen.getByText('還沒有歌')).toBeInTheDocument()
    const saved: AppState = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.songs[0].deleted).toBe(true)
  })

  it('沒開同步就不能分析，說清楚要先開', () => {
    localStorage.removeItem('jp-renshuu.sync')
    localStorage.setItem('jp-renshuu.local-only', '1')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /歌曲/ }))
    fireEvent.click(screen.getByRole('button', { name: /新增第一首歌/ }))
    expect(screen.getByText('要先開同步')).toBeInTheDocument()
  })

  it('歌詞太長就擋，不送出去', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /歌曲/ }))
    fireEvent.click(screen.getByRole('button', { name: /新增第一首歌/ }))
    fireEvent.change(screen.getByLabelText('歌名'), { target: { value: 'x' } })
    fireEvent.change(screen.getByLabelText(/日文歌詞/), {
      target: { value: Array.from({ length: 61 }, (_, i) => `歌詞${i}`).join('\n') },
    })
    expect(screen.getByRole('button', { name: '分析歌詞' })).toBeDisabled()
    expect(within(document.querySelector('.songform')!).getByText(/61 \/ 60 句/)).toBeInTheDocument()
  })
})
