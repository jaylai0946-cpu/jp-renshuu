# 日文練習本：微型商轉交接包

給 Claude Code 的實作說明。repo 是 `jaylai0946-cpu/jp-renshuu`，目前部署在 GitHub Pages（`https://jaylai0946-cpu.github.io/jp-renshuu/`），後端是 Cloudflare Worker `jp-renshuu-sync`（`https://jp-renshuu-sync.jaylai0946.workers.dev`）。

## 任務一句話

讓這個 App 可以**收小額月費給身邊的大學生用**：付費的人能用 AI 造句批改，沒付費的人照樣能練習、手寫、同步。最重要的是**API 帳單不可能失控**。不接金流、不上 App Store、不做 Email 登入。

## 規模與前提

- 使用者：身邊的大學生，預估 10–50 人。
- 收款：轉帳或 LINE Pay，管理員（App 作者）收到錢後手動開通。**不接 Stripe。**
- 管理員只有一個人，用手機或電腦操作。
- 現有功能、資料結構、手寫判分、同步的合併邏輯都**不要改壞**；全部測試（目前 336 個）要繼續通過。

---

## 0. 決策表（先照預設值做，管理員之後可以改）

| 項目 | 預設值 | 放在哪裡 |
|---|---|---|
| 價格 | 每月 NT$49，或一學期（5 個月）NT$199 | 說明頁文字 + 付款說明 |
| 付款方式文字 | 「轉帳或 LINE Pay 給管理員，備註你的會員代碼」 | Worker 設定（見 3.4），可隨時改 |
| 付費會員每人每天批改上限 | 30 次 | Worker 環境變數 `GRADE_MEMBER_DAILY` |
| 免費使用者每天批改次數 | 2 次（讓人試用） | `GRADE_FREE_DAILY` |
| 全站每天批改上限 | 300 次（約 US$0.9） | `GRADE_GLOBAL_DAILY` |
| Anthropic 每月花費上限 | US$20 | Anthropic Console（見 1.4，手動設定） |
| 會員到期前提醒 | 7 天 | 前端常數 |

成本依據：批改用 `claude-haiku-4-5`（US$1 / 百萬輸入 token、US$5 / 百萬輸出 token），一次批改約 US$0.002–0.003。

---

## 1. 先做：帳單不可能失控（任何人付錢之前必須完成）

現在的問題：`POST /grade/<key>` 只限「每組密鑰每天 50 次」，但任何人都能在登入頁無限建立新帳號（每個新帳號 = 新密鑰 = 新的 50 次）。

### 1.1 會員代碼

- 密鑰是憑證，**管理員永遠不該看到別人的密鑰**。改用「會員代碼」辨識人：`memberId = SHA-256(key)` 的前 10 個 hex 字元。
- Worker 和前端用同一個算法算出 memberId（前端用 `crypto.subtle.digest`，Worker 一樣）。
- 前端在「紀錄 › 會員」顯示會員代碼，旁邊有「複製」按鈕，讓使用者付款時貼給管理員。

### 1.2 會員與用量存到 D1（不要用 KV）

KV 免費方案每天只能寫 1,000 次，而且計數器不是原子操作。改用 **Cloudflare D1**（免費方案每天 10 萬次寫入，`UPDATE ... SET n = n + 1` 是原子的）。同步資料 `state:<key>` **維持在 KV，不要搬**。

```sql
-- worker/schema.sql
CREATE TABLE members (
  id TEXT PRIMARY KEY,          -- memberId
  until TEXT NOT NULL,          -- 付費到哪一天（含），YYYY-MM-DD，台灣時間
  note TEXT NOT NULL DEFAULT '',-- 管理員備註（姓名、付款方式）
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE usage (
  day TEXT NOT NULL,            -- YYYY-MM-DD，台灣時間（UTC+8）
  member_id TEXT NOT NULL,      -- 全站總數用 '*'
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, member_id)
);
CREATE TABLE config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
```

- 「一天」改用**台灣時間**換日（現在是 UTC，台灣早上 8 點才重置，學生會困惑）。
- `wrangler.toml` 加 `[[d1_databases]]` binding `DB`；`worker/README` 或註解寫清楚建立步驟（`wrangler d1 create`、`wrangler d1 execute --file schema.sql`）。

### 1.3 `/grade` 的檢查順序

1. 密鑰格式不對 → 400（現有）。
2. 雲端沒有這組密鑰的進度 → 403（現有，擋掉亂打的密鑰）。
3. 算 memberId，查 `members`：`until >= 今天` 就是付費會員，上限 `GRADE_MEMBER_DAILY`；否則上限 `GRADE_FREE_DAILY`。
4. 全站今天用量 ≥ `GRADE_GLOBAL_DAILY` → 503，訊息「今天全站的批改額度用完了，明天再來」。
5. 個人今天用量 ≥ 上限 → 免費使用者回 **402**（訊息「AI 批改是付費功能，今天的免費次數用完了」，附 `upgrade: true`）；會員回 429（現有訊息）。
6. **先**把個人和全站計數各加 1，**再**呼叫 Anthropic（避免同時送出很多次繞過上限）。上游失敗時把兩個計數減回來。
7. 回應多帶 `{ member: boolean, until?: string, used, limit }`，前端拿來顯示剩幾次。

### 1.4 管理員手動設定（寫進 `docs/OPERATIONS.md`，不是程式）

- Anthropic Console 為這把 API key 所在的 workspace 設**每月花費上限** US$20。這是最後一道保險，程式出錯也不會超過。
- Cloudflare 後台加一條**速率限制規則**：`/s/*` 和 `/grade/*` 每個 IP 每分鐘最多 60 次。目的是擋住有人一直試密碼（登入是名字＋密碼在前端算成密鑰，猜的人只能一直打 `/s/<key>`）。

### 1.5 前端

- 造句頁：非會員且免費次數用完時，原本的批改按鈕換成一張卡片：「AI 批改是付費功能」＋價格＋付款說明＋會員代碼（可複製）。收到 402 時也顯示這張卡。
- 造句頁頁首的膠囊改顯示「今天還能批改 N 次」（會員和免費都顯示）。

**驗收**

- Worker 測試（`worker/worker.test.js`，用假的 KV 和 D1）：免費使用者第 3 次回 402；會員第 31 次回 429；全站第 301 次回 503；過期會員當免費處理；上游失敗時計數有退回；兩個請求同時送不會多扣或少扣到超過上限。
- 用 50 個新密鑰各打 3 次 `/grade`：Anthropic 實際只被呼叫 ≤ `GRADE_GLOBAL_DAILY` 次。

---

## 2. 成本與穩定

### 2.1 同步改成合併寫入

`src/useSync.ts` 現在 `PUSH_DEBOUNCE_MS = 1500`，練習時幾乎每答一題就寫一次 KV。改成：

- 有改動時最多每 **20 秒**推一次。
- 頁面切到背景（`visibilitychange` → hidden）或關閉（`pagehide`）時立刻推，用 `fetch(..., { keepalive: true })`。
- 一回合練習結束（結算畫面）時立刻推。
- 合併邏輯（`mergeStates`、409 處理）不動。

**驗收**：一回合 20 題的練習，KV 寫入 ≤ 3 次；練習中切到別的 App 再切回來，另一台裝置拉得到最新進度。

### 2.2 Worker 從 repo 部署

- `wrangler.toml` 換成真的 KV id 和 D1 id（管理員提供，或用 `wrangler` 查）。
- 新增 GitHub Action：`worker/` 有變動時跑 `worker` 測試再 `wrangler deploy`，用 repo secret `CLOUDFLARE_API_TOKEN`。這樣 repo 裡的程式就是線上跑的程式。
- secrets：`ANTHROPIC_API_KEY`（現有）、`ADMIN_TOKEN`（新增，見 3.1）。**不要寫進任何檔案。**

### 2.3 網站搬到 Cloudflare Pages

GitHub Pages 的條款不允許拿來跑收費服務。

- 部署到 Cloudflare Pages（免費），先用 `*.pages.dev`，自訂網域之後再說。
- Vite `base` 從 `/jp-renshuu/` 改成可設定（`VITE_BASE`），Pages 用 `/`，PWA 的 `start_url`、`scope` 跟著改。
- **搬家會換網址，瀏覽器裡的資料不會跟過去。** 登入過的人到新網址重新登入就會從雲端拉回進度；選「只存這台」的人會不見。處理方式：
  - 舊網址（GitHub Pages）保留一個月，App 頂部顯示橫幅：「網站搬家了 → 新網址」。只存這台的使用者，橫幅要先引導他「匯出進度」或「登入」再走。
  - 一個月後 GitHub Pages 的 workflow 改成只放一個轉址頁。

### 2.4 備份

`scripts/backup.mjs`：用 `wrangler` 匯出所有 `state:*`（KV）和 D1 的 `members` 到本機一個 JSON。寫進 `docs/OPERATIONS.md`，建議每週跑一次。

---

## 3. 會員管理

### 3.1 管理 API（Worker）

全部要 `Authorization: Bearer <ADMIN_TOKEN>`，用固定時間比對（constant-time）。token 不對一律 404（不要透露有這個路由）。

| 方法 | 路徑 | 做什麼 |
|---|---|---|
| GET | `/admin/members` | 列出全部會員（id、until、note），依 until 排序 |
| PUT | `/admin/members/<id>` | 新增或延長：body `{ months?: number, until?: string, note?: string }`；`months` 是從「今天或目前到期日，取晚的那天」往後加 |
| DELETE | `/admin/members/<id>` | 移除 |
| GET | `/admin/usage?days=7` | 每天全站用量、用最多的前 10 個 memberId、估計花費（次數 × US$0.0025） |
| GET/PUT | `/admin/config` | 讀寫 `config` 表：`pay_text`（付款說明）、`price_text`（價格文字） |

### 3.2 管理頁（前端）

- 網址 `#admin`，不出現在任何導覽裡。打開時要求輸入 ADMIN_TOKEN，存在 `sessionStorage`（關掉分頁就忘記）。
- 功能：輸入會員代碼＋選「1 個月／1 學期／自訂到期日」＋備註 → 開通；會員列表（快到期的標黃、已過期的標灰）可延長、移除；今日與 7 天用量和估計花費；編輯付款說明和價格文字。
- 沿用 A 版設計（`tokens.css`、`.card`、`.btn`），手機上要好操作（管理員多半用手機開通）。

### 3.3 使用者端（紀錄頁新增「會員」卡，放在設定上面）

- 會員代碼（可複製）。
- 狀態：「免費」或「付費會員，到 2026/02/28」。
- 今天的批改次數：已用 / 上限。
- 非會員：價格＋付款說明（從 `GET /me/<key>` 拿，見下）。
- 到期前 7 天在今日頁顯示一行提醒；過期後自動變回免費，**練習進度完全不受影響**。

新增 `GET /me/<key>`：回 `{ memberId, member, until, used, limit, priceText, payText }`。

### 3.4 付款說明文字可遠端修改

價格和付款方式存在 D1 `config` 表，管理員在管理頁改，**不用重新部署**。

---

## 4. 帳號

### 4.1 改密碼

紀錄頁新增「改密碼」：輸入舊密碼（驗證算出來的密鑰等於目前的）＋新密碼兩次。

- Worker 新增 `POST /rekey/<oldKey>`，body `{ newKey }`：把 `state:<old>` 複製到 `state:<new>`、把 `members` 裡 old memberId 的資料搬到 new memberId、刪掉舊的。新密鑰已經有進度的話回 409，不要蓋掉。
- 前端成功後換掉本機的同步設定，提示「其他裝置要用新密碼重新登入」。

### 4.2 忘記密碼

技術上救不回來（伺服器沒有密碼，也沒有密碼算出來的密鑰以外的東西）。做這兩件事：

- 登入頁「建立新帳號」確認框加一句：「忘記密碼就救不回來，請用記得住的密碼。」
- 管理頁可以把**會員資格**轉到新的會員代碼（使用者重新註冊後，把新代碼給管理員）。進度救不回來，除非他有匯出備份。

### 4.3 刪除帳號

`關掉並刪除雲端` 時，Worker 一併刪掉 D1 裡這個 memberId 的 `members` 和 `usage` 資料。

---

## 5. 說明與條款（文字為主）

新增「使用說明與條款」頁（從登入頁底部和「關於」頁都能點到），內容至少要有：

1. **收的是什麼錢**：App 與 AI 批改的服務費。單字和題目是依課程自編的練習內容，不販售教材本身。
2. **退費**：付款後 7 天內、還沒用超過 10 次批改，全額退；之後不退（管理員可改）。
3. **資料放在哪**：練習進度存在 Cloudflare；造句內容會傳給 Anthropic（Claude）批改；不賣資料、不放廣告。
4. **怎麼刪除**：紀錄 › 手機與電腦同步 › 關掉並刪除雲端。
5. **聯絡方式**：管理員的聯絡方式（佔位文字，管理員自己填）。

其他：

- `About.tsx` 裡「銘傳國企一甲『日文一（上）』的練習本」改成中性描述（例如「大學日文一（上）的練習本」）。
- KanjiVG 的 CC BY-SA 3.0 標示保留，不能拿掉。

---

## 不要做

- 不接 Stripe 或任何金流，不上架 App Store，不做 Email 或社群登入，不加數據分析。
- 不要把任何密鑰、token、API key 寫進前端或 repo。
- 不要讓管理員看得到任何人的同步密鑰；管理員只看得到會員代碼。
- 不要動手寫判分、SRS 排程、同步合併的邏輯。

## 驗收清單

- [ ] 全部測試通過，新增的 Worker 測試涵蓋 1.3、3.1、4.1、4.3。
- [ ] 50 個新帳號同時刷批改，Anthropic 被呼叫的次數 ≤ 全站上限。
- [ ] 免費使用者：每天 2 次批改，第 3 次看到付費卡片；練習、手寫、同步完全正常。
- [ ] 管理員用手機在管理頁貼會員代碼、選「1 個月」，對方重新整理後造句頁可用 30 次。
- [ ] 過期會員自動變回免費，進度不受影響。
- [ ] 一回合 20 題，KV 寫入 ≤ 3 次。
- [ ] 改密碼後，舊密碼登入看到的是空進度（並且有「目前沒有進度」的確認），新密碼登入進度與會員資格都在。
- [ ] 新網址（Cloudflare Pages）可以安裝成主畫面 App；舊網址有搬家橫幅。
- [ ] `docs/OPERATIONS.md` 寫好：開通流程、每月對帳、Anthropic 花費上限、Cloudflare 速率限制規則、備份指令、額度用完時怎麼處理。

## 建議的實作順序（每段做完就推一次）

1. 第 1 節（費用上限、會員判斷、D1）＋ Worker 測試
2. 2.1 同步合併寫入
3. 第 3 節（管理 API、管理頁、會員卡）
4. 2.2 Worker 從 repo 部署
5. 第 4 節（改密碼、刪除）＋第 5 節（條款頁）
6. 2.3 搬到 Cloudflare Pages（最後做，因為會換網址）

需要管理員本人動手的步驟（建立 D1、設 secret、Anthropic 花費上限、Cloudflare 規則、Pages 專案），做到時用編號步驟告訴他要點哪裡，一次一個。

---

## 給 Claude Code 的開場指令（可直接貼上）

> 請讀 `docs/MICRO-COMMERCE.md`，照「建議的實作順序」一段一段做，每段做完跑全部測試、推上 main，再做下一段。決策表先用預設值。需要我在 Cloudflare 或 Anthropic 後台手動操作的地方，停下來用編號步驟告訴我要點哪裡，一次一個。功能邏輯（手寫判分、SRS、同步合併）不要動。
