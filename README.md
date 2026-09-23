# 日文練習本 📖

銘傳國企一甲「日文一（上）」的練習 App。假名、單字用間隔複習排程，之後會加上
Apple Pencil 手寫練習和造句批改。

前身是 claude.ai 上的一個 Artifact，現在搬成自架 PWA，可以加到 iPad 和 iPhone
主畫面、離線使用，並在裝置之間同步進度。做法跟
[mcu-schedule](https://github.com/jaylai0946-cpu/mcu-schedule)（課表 App）一樣，
兩個專案好一起維護。

## 目前做到哪 🚧

分四個階段做，每個階段做完在 iPad 上實測再繼續。

| 階段 | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 搬成 React PWA：單元、題型、間隔複習、同步、匯入匯出 | ✅ 完成 |
| 2 | 手寫畫布：Apple Pencil、防手掌誤觸、看筆順動畫、描寫模式 | ⬜ 未開始 |
| 3 | 自動判分（本機運算）、默寫題加進每日練習 | ⬜ 未開始 |
| 4 | 造句批改：Worker 的 `/grade` 端點呼叫 Claude API | ⬜ 未開始 |

手寫還沒做，所以設定裡看不到「每天幾題默寫」，每日練習也不會出默寫題。

## 開發

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # vitest
pnpm typecheck
pnpm lint
pnpm build
```

圖示是用 `node scripts/make-icons.mjs` 產生的（這台機器沒有 ImageMagick，
所以腳本裡自己寫了一個最小的 PNG 編碼器）。改圖案就改那個腳本再跑一次。

## 部署到 GitHub Pages 🚀

推到 `main` 就會自動建置並上線，設定在 `.github/workflows/deploy.yml`。
第一次要到 repo 的 **Settings → Pages → Source** 選 **GitHub Actions**。

網址是 `https://jaylai0946-cpu.github.io/jp-renshuu/`。
**repo 改名的話要同時改 `vite.config.ts` 裡的 `BASE`**，否則上線會是白畫面。

## 裝到 iPad 和 iPhone 📱

1. 用 Safari 打開上面的網址
2. 分享 → 加入主畫面
3. 之後從主畫面開啟就是全螢幕，離線也能練

## 手機與電腦同步 🔄

### 為什麼要自己架

進度預設只存在當下那台裝置的瀏覽器裡。要讓 iPad 練完、iPhone 打開是同一份，
就得有個地方放共同的那份資料。`worker/` 裡有一個現成的 Cloudflare Worker，
免費額度綽綽有餘。

**跟課表 App 用不同的 Worker 和不同的 KV namespace**，兩邊的資料不會互相蓋到。

### 架設步驟

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create SYNC   # 把印出來的 id 填進 wrangler.toml
npx wrangler deploy
```

部署完會給你一個 `https://jp-renshuu-sync.<你的帳號>.workers.dev` 的網址。

### 兩台裝置設定

**第一台**：紀錄 → 手機與電腦同步 → 填 Worker 網址 → 按「產生新密鑰」→ 啟用同步。

**第二台**（兩種方法，挑一個）：

- **傳設定連結**（推薦）：第一台按「複製設定連結」，用 AirDrop 或訊息傳到第二台，
  在第二台打開那個連結，它會問要不要連上同步。不用手打 32 個字元。
- **手動填**：第二台填同一個網址和同一組密鑰，啟用。

設定連結長這樣，密鑰放在 `#` 後面，所以不會被送到 GitHub Pages 的伺服器、
也不會留在任何 access log 裡：

```
https://jaylai0946-cpu.github.io/jp-renshuu/#sync=https%3A%2F%2F...workers.dev|<32 字元密鑰>
```

> ⚠️ 連結裡含密鑰，等同於憑證。只傳給自己，不要貼到群組或公開的地方。

> ⚠️ 密鑰就是憑證，沒有帳號密碼。拿到密鑰的人就拿得到你的進度，不要貼到公開的地方。
> Worker 只擋密鑰格式，猜不中是因為 32 個英數字的組合夠多，不是因為有人在驗證身分。

### 衝突怎麼處理

推上去時會帶 `If-Match`，也就是「我上次看到的版本」。如果雲端已經被另一台改過，
Worker 會回 409 並附上雲端現況，App 會問你要留哪一份，不會自己選。

一邊沒改、另一邊改過的情況（最常見）不會跳衝突，直接同步。

## 從 claude.ai 的舊版搬進度

舊版的進度在那個 HTML 檔的 `<script id="state">` 裡。請 claude.ai 上的 Claude
把那段 JSON 給你，然後在 **紀錄 → 搬進度** 貼上，按「匯入舊版進度」。

item 的 id 格式（`h:あ`、`k:ア`、`w:わたし`）新版原封不動沿用，所以熟練度、
連續天數、今天的新字額度都會跟著過來。對不上目前題庫的字會被跳過，並回報跳了幾個。

同一個地方也可以「匯出進度」做備份，和「匯入備份」還原。

## 資料存在哪 💾

| 東西 | 位置 | 會不會同步 |
| --- | --- | --- |
| 練習進度、設定 | `localStorage['jp-renshuu']` | 會 |
| 同步伺服器網址與密鑰 | `localStorage['jp-renshuu.sync']` | **不會**（是這台的設定，匯出備份也不含密鑰） |
| 壞掉的資料備份 | `localStorage['jp-renshuu.corrupt']` | 不會 |

雲端那份存在你自己的 Cloudflare KV，key 是 `state:<密鑰>`。

## 間隔複習怎麼算

| 盒子 | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 下次複習（天） | 當天 | 1 | 2 | 4 | 8 | 16 | 32 |

- 答對往上一格，答錯直接回**盒子 1**（不是 0——回 0 的話明天又會被當成新字介紹一次）
- 一回合裡**只有第一次作答計分**，答錯後補的那一題只給點數不動盒子
- 答錯的字會在同一回合的尾巴再出一次
- 盒子 2 以上才會出反向題（羅馬拼音→假名、中文→日文）
- 「我已經會了」把整個單元還沒學的字放進盒子 3

## 專案結構

```
src/
  data/units.ts        12 個單元、283 個字（假名 208 + 單字 75）
  lib/srs.ts           間隔複習、出題、選項、默寫排程
  lib/actions.ts       改進度的純函式（點數、盒子、歷史）
  lib/storage.ts       localStorage 存取與壞資料處理
  lib/validate.ts      所有外來資料的守門員
  lib/legacyImport.ts  吃 Artifact 版的 JSON
  lib/sync.ts          同步的 HTTP 層
  useSync.ts           同步的狀態機（樂觀鎖、衝突、debounce）
  useRound.ts          一回合練習的狀態
  components/          畫面
worker/                Cloudflare Worker（同步後端）
scripts/make-icons.mjs 產生 PWA 圖示
```

## 資料來源與授權

- 筆順資料（階段 2 開始用）：[KanjiVG](https://kanjivg.tagaini.net/)，
  作者 Ulrich Apel，授權 [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)。
  App 的「關於」頁有標示。
- 字型：Klee One、Noto Sans TC，來自 Google Fonts，SIL Open Font License 1.1。

## 沒有做的事

- **沒有帳號系統**。密鑰就是全部的安全性。
- **不支援多人**。這是一個人用的練習本。
- **漢字手寫還沒做**。第一版只練假名；資料結構留了擴充空間。
- **發音靠系統語音**（Web Speech API `ja-JP`）。沒有日文語音的裝置會唸得很怪。
