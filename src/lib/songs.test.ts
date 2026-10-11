import { describe, expect, it } from 'vitest'
import { mergeStates } from './merge'
import { buildSongQuiz, parseYouTubeId, songWords, uniqueLineCount, wordKey } from './songs'
import { emptyState } from './storage'
import { validSong, validateAppState } from './validate'
import type { Song, SongLine } from '../types'

function line(jp: string, words: [string, string, string][]): SongLine {
  return { jp, kana: '', ro: '', zh: '', note: '', words: words.map(([s, k, zh]) => ({ s, k, b: '', zh })) }
}

const SONG: Song = {
  id: 'song-abc123',
  title: '測試',
  artist: '',
  video: '',
  known: [],
  updated: '2026-10-11T00:00:00.000Z',
  lines: [
    line('青い空を見上げて', [['青い', 'あおい', '藍色的'], ['空', 'そら', '天空'], ['見上げて', 'みあげて', '抬頭看']]),
    line('君と歩いた道', [['君', 'きみ', '你'], ['歩いた', 'あるいた', '走過'], ['道', 'みち', '路']]),
    line('夢を見ていた', [['夢', 'ゆめ', '夢']]),
  ],
}

function seeded(seed: number) {
  let v = seed
  return () => {
    v = (v * 1664525 + 1013904223) % 4294967296
    return v / 4294967296
  }
}

describe('parseYouTubeId', () => {
  it('認得各種 YouTube 網址和直接貼的 id', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'dQw4w9WgXcQ',
    ]) {
      expect(parseYouTubeId(url), url).toBe('dQw4w9WgXcQ')
    }
  })

  it('不是 YouTube 的、亂打的都回空字串', () => {
    for (const url of ['', 'hello', 'https://example.com/watch?v=dQw4w9WgXcQ', 'https://youtu.be/short']) {
      expect(parseYouTubeId(url), url).toBe('')
    }
  })
})

describe('uniqueLineCount', () => {
  it('空行不算、重複的副歌只算一次', () => {
    expect(uniqueLineCount('a\n\n b \na\nc\n')).toBe(3)
  })
})

describe('buildSongQuiz', () => {
  it('每題的答案都在四個選項裡，選項不重複', () => {
    const qs = buildSongQuiz(SONG, seeded(1))
    expect(qs.length).toBe(7)
    for (const q of qs) {
      expect(q.choices).toHaveLength(4)
      expect(new Set(q.choices).size).toBe(4)
      expect(q.choices).toContain(q.answer)
    }
  })

  it('兩種題目都會出；填空題把那個詞挖掉', () => {
    const qs = buildSongQuiz(SONG, seeded(2))
    const blank = qs.find((q) => q.kind === 'blank')
    expect(qs.some((q) => q.kind === 'meaning')).toBe(true)
    expect(blank).toBeDefined()
    if (blank?.kind === 'blank') {
      expect(blank.before + blank.answer + blank.after).toBe(blank.line)
    }
  })

  it('還沒標成會了的詞先出', () => {
    const known = songWords(SONG)
      .slice(0, 5)
      .map((w) => wordKey(w.word))
    const qs = buildSongQuiz({ ...SONG, known }, seeded(3), 2)
    for (const q of qs) expect(known).not.toContain(wordKey(q.word))
  })

  it('詞太少就不出題', () => {
    expect(buildSongQuiz({ ...SONG, lines: [SONG.lines[2]] })).toEqual([])
  })
})

describe('驗證和同步', () => {
  it('壞掉的欄位補預設、太長的截掉；沒有歌名或歌詞的整首丟掉', () => {
    const ok = validSong({ ...SONG, video: 'javascript:alert(1)', title: 'x'.repeat(500) })
    expect(ok?.video).toBe('')
    expect(ok?.title).toHaveLength(100)
    expect(validSong({ ...SONG, title: '' })).toBeNull()
    expect(validSong({ ...SONG, lines: [] })).toBeNull()
    expect(validSong({ ...SONG, id: '../../etc' })).toBeNull()
  })

  it('舊資料沒有 songs 欄位就是空的', () => {
    const r = validateAppState({ items: {}, hist: {} }, '2026-10-11')
    expect(r.ok && r.state.songs).toEqual([])
  })

  it('兩台各加一首：合併後兩首都在', () => {
    const a = { ...emptyState(), songs: [SONG] }
    const b = { ...emptyState(), songs: [{ ...SONG, id: 'song-other1' }] }
    expect(mergeStates(a, b).songs.map((s) => s.id).sort()).toEqual(['song-abc123', 'song-other1'])
  })

  it('一台刪了、另一台還在：刪掉的贏，不會又跑回來', () => {
    const grave: Song = { ...SONG, lines: [], title: '', known: [], deleted: true, updated: '2026-10-11T01:00:00.000Z' }
    const a = { ...emptyState(), songs: [grave] }
    const b = { ...emptyState(), songs: [SONG] }
    expect(mergeStates(a, b).songs[0].deleted).toBe(true)
    expect(mergeStates(b, a).songs[0].deleted).toBe(true)
  })

  it('兩台都標了會了的詞：合起來', () => {
    const a = { ...emptyState(), songs: [{ ...SONG, known: ['空|そら'] }] }
    const b = { ...emptyState(), songs: [{ ...SONG, known: ['夢|ゆめ'], updated: '2026-10-12T00:00:00.000Z' }] }
    expect(mergeStates(a, b).songs[0].known.sort()).toEqual(['夢|ゆめ', '空|そら'])
  })
})
