import type { Item, KanaItem, Unit, WordItem } from '../types'

/** 'あ:a い:i' -> [['あ','a'],['い','i']]。羅馬拼音裡沒有空白，所以用第一個冒號切 */
function pairs(s: string): [string, string][] {
  return s
    .trim()
    .split(/\s+/)
    .map((t) => {
      const i = t.indexOf(':')
      return [t.slice(0, i), t.slice(i + 1)] as [string, string]
    })
}

export const SEION = pairs(
  'あ:a い:i う:u え:e お:o か:ka き:ki く:ku け:ke こ:ko さ:sa し:shi す:su せ:se そ:so ' +
    'た:ta ち:chi つ:tsu て:te と:to な:na に:ni ぬ:nu ね:ne の:no は:ha ひ:hi ふ:fu へ:he ほ:ho ' +
    'ま:ma み:mi む:mu め:me も:mo や:ya ゆ:yu よ:yo ら:ra り:ri る:ru れ:re ろ:ro わ:wa を:wo ん:n',
)

export const DAKU = pairs(
  'が:ga ぎ:gi ぐ:gu げ:ge ご:go ざ:za じ:ji ず:zu ぜ:ze ぞ:zo だ:da ぢ:ji づ:zu で:de ど:do ' +
    'ば:ba び:bi ぶ:bu べ:be ぼ:bo ぱ:pa ぴ:pi ぷ:pu ぺ:pe ぽ:po',
)

/**
 * 拗音是拼出來的：基底的子音 + ゃゅょ 的母音。
 * sh／ch／j 後面不加 y（しゃ 是 sha 不是 shya）。
 */
export const YOON: [string, string][] = pairs(
  'き:k し:sh ち:ch に:n ひ:h み:m り:r ぎ:g じ:j び:b ぴ:p',
).flatMap(([base, consonant]) =>
  (
    [
      ['ゃ', 'a'],
      ['ゅ', 'u'],
      ['ょ', 'o'],
    ] as const
  ).map(([small, vowel]): [string, string] => {
    const noY = consonant === 'sh' || consonant === 'ch' || consonant === 'j'
    return [base + small, noY ? consonant + vowel : consonant + 'y' + vowel]
  }),
)

/** 平假名 -> 片假名。小字 ゃゅょ 也在這個範圍裡，一起轉。 */
export function toKata(s: string): string {
  return s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
}

/** 漢字寫法|讀音|中文|羅馬拼音。沒有漢字時第一欄留空。 */
const WORDS: Record<string, string[]> = {
  v1: [
    '|おはようございます|早安|ohayou gozaimasu',
    '|こんにちは|你好（白天）|konnichiwa',
    '|こんばんは|晚上好|konbanwa',
    '|さようなら|再見|sayounara',
    '|ありがとうございます|謝謝|arigatou gozaimasu',
    '|すみません|不好意思／對不起|sumimasen',
    '|はじめまして|初次見面|hajimemashite',
    '|よろしくおねがいします|請多指教|yoroshiku onegaishimasu',
    '|いただきます|開動了|itadakimasu',
    'ご馳走様でした|ごちそうさまでした|謝謝招待（吃飽了）|gochisousama deshita',
    'お休みなさい|おやすみなさい|晚安（睡前）|oyasuminasai',
    '|いってきます|我出門了|ittekimasu',
  ],
  v2: [
    '私|わたし|我|watashi',
    '|あなた|你|anata',
    '学生|がくせい|學生|gakusei',
    '大学|だいがく|大學|daigaku',
    '先生|せんせい|老師|sensei',
    '会社員|かいしゃいん|公司職員|kaishain',
    '台湾|たいわん|台灣|taiwan',
    '台湾人|たいわんじん|台灣人|taiwanjin',
    '日本|にほん|日本|nihon',
    '日本語|にほんご|日語|nihongo',
    '英語|えいご|英語|eigo',
    '名前|なまえ|名字|namae',
    '友達|ともだち|朋友|tomodachi',
  ],
  v3: [
    '一|いち|一|ichi',
    '二|に|二|ni',
    '三|さん|三|san',
    '四|よん|四|yon',
    '五|ご|五|go',
    '六|ろく|六|roku',
    '七|なな|七|nana',
    '八|はち|八|hachi',
    '九|きゅう|九|kyuu',
    '十|じゅう|十|juu',
    '百|ひゃく|一百|hyaku',
    '千|せん|一千|sen',
    '一万|いちまん|一萬|ichiman',
    '円|えん|日圓（元）|en',
  ],
  v4: [
    '今|いま|現在|ima',
    '今日|きょう|今天|kyou',
    '明日|あした|明天|ashita',
    '昨日|きのう|昨天|kinou',
    '朝|あさ|早上|asa',
    '昼|ひる|中午|hiru',
    '夜|よる|晚上|yoru',
    '何時|なんじ|幾點|nanji',
    '月曜日|げつようび|星期一|getsuyoubi',
    '金曜日|きんようび|星期五|kin’youbi',
    '週末|しゅうまつ|週末|shuumatsu',
  ],
  v5: [
    '|ピザ|披薩|piza',
    '|パスタ|義大利麵|pasuta',
    '水|みず|水|mizu',
    '|コーヒー|咖啡|koohii',
    '|おいしい|好吃|oishii',
    '|メニュー|菜單|menyuu',
    '|いらっしゃいませ|歡迎光臨|irasshaimase',
    'ご注文は|ごちゅうもんは|請問要點什麼？|gochuumon wa',
    'お会計|おかいけい|結帳|okaikei',
    '|テイクアウト|外帶|teikuauto',
    '店員|てんいん|店員|ten’in',
    '|レストラン|餐廳|resutoran',
  ],
  v6: [
    '学校|がっこう|學校|gakkou',
    '教室|きょうしつ|教室|kyoushitsu',
    '図書館|としょかん|圖書館|toshokan',
    '|トイレ|廁所|toire',
    '駅|えき|車站|eki',
    '家|うち|家|uchi',
    '|ここ|這裡|koko',
    '|そこ|那裡|soko',
    '|あそこ|那邊（遠處）|asoko',
    '|どこ|哪裡|doko',
    '本|ほん|書|hon',
    '|かばん|包包|kaban',
    '電話|でんわ|電話|denwa',
  ],
}

interface UnitSpec {
  id: string
  name: string
  kind: 'kana' | 'word'
  src?: [string, string][]
  kata?: boolean
}

/** 順序就是學習順序：先平假名，再夾單字單元，片假名穿插進來。 */
const SPECS: UnitSpec[] = [
  { id: 'h1', name: '平假名・清音', kind: 'kana', src: SEION, kata: false },
  { id: 'h2', name: '平假名・濁音與半濁音', kind: 'kana', src: DAKU, kata: false },
  { id: 'h3', name: '平假名・拗音', kind: 'kana', src: YOON, kata: false },
  { id: 'v1', name: '招呼語', kind: 'word' },
  { id: 'k1', name: '片假名・清音', kind: 'kana', src: SEION, kata: true },
  { id: 'v2', name: '自我介紹', kind: 'word' },
  { id: 'k2', name: '片假名・濁音與半濁音', kind: 'kana', src: DAKU, kata: true },
  { id: 'v3', name: '數字', kind: 'word' },
  { id: 'k3', name: '片假名・拗音', kind: 'kana', src: YOON, kata: true },
  { id: 'v4', name: '時間與星期', kind: 'word' },
  { id: 'v5', name: '吃飯與點餐', kind: 'word' },
  { id: 'v6', name: '學校與地點', kind: 'word' },
]

function buildKana(spec: UnitSpec): KanaItem[] {
  const kata = spec.kata === true
  return (spec.src ?? []).map(([hira, ro]) => {
    const ch = kata ? toKata(hira) : hira
    return { id: (kata ? 'k:' : 'h:') + ch, t: 'kana', ch, ro, u: spec.id }
  })
}

function buildWords(spec: UnitSpec): WordItem[] {
  return (WORDS[spec.id] ?? []).map((line) => {
    const [kanji, kana, zh, ro] = line.split('|')
    return { id: 'w:' + kana, t: 'word', jp: kanji || kana, kana, zh, ro, u: spec.id }
  })
}

export const UNITS: Unit[] = SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  kind: spec.kind,
  kata: spec.kata === true,
  items: spec.kind === 'kana' ? buildKana(spec) : buildWords(spec),
}))

export const UNIT_BY_ID: Record<string, Unit> = Object.fromEntries(UNITS.map((u) => [u.id, u]))

export const ITEMS: Record<string, Item> = Object.fromEntries(
  UNITS.flatMap((u) => u.items).map((it) => [it.id, it]),
)

/** 造句練習的題目，照 Artifact 版。 */
export const PROMPTS = [
  '你好，初次見面。',
  '我是 Jay，請多指教。',
  '我是台灣人。',
  '我是大學生。',
  '這是披薩。',
  '廁所在哪裡？',
  '明天是星期五。',
  '謝謝，很好吃。',
  '早安，老師。',
  '現在幾點？',
]

/**
 * 手寫要用到的假名字元（拆開拗音的兩個字）。
 * 第一版不練漢字，所以單字的手寫只練讀音；這份清單就是 KanjiVG 要打包的範圍。
 */
export function handwritingChars(): string[] {
  const set = new Set<string>()
  for (const unit of UNITS) {
    if (unit.kind !== 'kana') continue
    for (const it of unit.items) {
      if (it.t !== 'kana') continue
      for (const ch of it.ch) set.add(ch)
    }
  }
  return [...set]
}

export function isKanaItem(it: Item): it is KanaItem {
  return it.t === 'kana'
}
