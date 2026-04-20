# KELLY LIN — 官網 + 後台

Kelly Lin 2026 S/S Collection 的官網 + 可直接在網路上編輯的後台。
一個 Node.js/Express 小專案，部署到 Railway（含 Volume）即可使用。

---

## 目錄結構

```
kelly-admin/
├── server.js              ← 主程式（Express 路由、登入、CRUD、上傳）
├── package.json
├── railway.json           ← Railway 部署設定
├── public/
│   └── style.css          ← 前台 + 後台樣式
├── views/                 ← EJS 頁面模板
│   ├── home.ejs           ← 首頁
│   ├── lookbook.ejs       ← Lookbook 大圖牆
│   ├── outfit.ejs         ← 單件作品頁
│   ├── partials/          ← 共用 head / footer / 導覽
│   └── admin/
│       ├── login.ejs      ← 後台登入
│       ├── dashboard.ejs  ← 作品列表（拖曳排序 / 顯示隱藏 / 編輯 / 刪除）
│       └── edit.ejs       ← 單件編輯（資料 + 照片管理）
└── seed/                  ← 第一次啟動時自動複製到 Volume
    ├── outfits.json       ← 17 套現有作品的資料
    └── photos/            ← 34 張現有照片
```

所有正式資料都存放在 `DATA_DIR`（Railway Volume），seed 只是第一次部署時用來建立初始內容。

---

## 本機預覽（可略過）

```bash
cd kelly-admin
npm install
npm start
# → 打開 http://localhost:3000
# → 後台登入：http://localhost:3000/admin  密碼 kelly2026
```

第一次啟動會在 `kelly-admin/data/` 建立資料夾，之後所有新增、修改都會寫進那裡。

---

## Railway 部署步驟（繁體中文 step-by-step）

### 1. 把這個資料夾推上 GitHub

如果還沒建 repo，打開 terminal：

```bash
cd kelly-admin
git init
git add .
git commit -m "Initial KELLY LIN admin app"
# 到 github.com 建一個新的空 repo，例如 kelly-admin
git remote add origin https://github.com/fulin8319-cmyk/kelly-admin.git
git branch -M main
git push -u origin main
```

### 2. 在 Railway 建立專案

1. 前往 https://railway.app，登入後點 **New Project**
2. 選 **Deploy from GitHub repo**，授權後選擇剛剛建立的 `kelly-admin` repo
3. Railway 會自動偵測到 Node.js，第一次 build 會失敗沒關係，先往下做

### 3. 加一個 Volume（重要！）

這一步是關鍵，沒有 Volume 的話每次重新部署照片和資料都會消失。

1. 在專案裡點你的 service → **Settings** → **Volumes**
2. 點 **+ New Volume**
3. Mount Path 填：`/data`
4. 大小用預設就好（1 GB 已經夠放好幾百張照片）
5. 按儲存

### 4. 設定環境變數

進到同一個 service → **Variables**，加這 3 個：

| Variable | Value | 說明 |
| --- | --- | --- |
| `DATA_DIR` | `/data` | 告訴程式要把資料寫到 Volume |
| `ADMIN_PASSWORD` | 你自己的密碼 | 後台登入密碼，請換掉預設值 |
| `SESSION_SECRET` | 任意一長串亂碼 | 用來加密登入 cookie |
| `NODE_ENV` | `production` | 讓 cookie 只走 https |

> `SESSION_SECRET` 可以隨便敲一串長字元，例如 `k3lly-2o26-super-long-secret-xyz-9871`。

### 5. 重新部署

1. **Deployments** → 最上面一筆 → 點右邊的 `⋯` → **Redeploy**
2. 等 1~2 分鐘看到綠色勾勾
3. **Settings** → **Networking** → **Generate Domain**
4. 拿到的網址打開就是前台，後面加 `/admin` 就是後台登入

### 6. 登入後台

- 網址：`https://你的專案.up.railway.app/admin`
- 密碼：你剛剛設定的 `ADMIN_PASSWORD`

登入後可以：
- **拖曳 ⠿** 調整首頁與 Lookbook 順序
- **編輯** 改資料、上傳新照片、刪除舊照片
- **隱藏/顯示** 暫時讓某套不要顯示（不是刪除）
- **+ 新增 Outfit** 加入全新作品

---

## 日常使用

### 換首頁某件作品的照片
後台 → 編輯那件 → 滑到「照片管理」→ 按 `×` 移除舊的 → 上傳新的 → 拖曳排序，第一張就是封面。

### 新增一整套作品
後台 → 右上角 **+ 新增 Outfit** → 填資料（ID 例如 `18`）→ 建立 → 進編輯頁上傳照片。

### 暫時不想讓某套曝光
後台列表 → 按該列的 **隱藏** 按鈕（資料不會消失，只是前台看不到）。

### 調整順序
後台列表 → 用左側 ⠿ 圖示拖曳，放開後會自動儲存。

---

## 疑難排解

**登入後馬上又跳回登入頁**
→ 應該是 `NODE_ENV=production` 但網址還是 http。Railway 給的網址預設就是 https，確認網址前綴是否為 `https://`。

**上傳照片失敗**
→ 檢查 Volume 是否掛在 `/data`；檢查 `DATA_DIR` 環境變數是否設成 `/data`；檔案大小上限 15 MB。

**修改後重新部署就看不到了**
→ 一定是 Volume 沒設好。Settings → Volumes 裡必須有一個 mount 在 `/data` 的 volume。

**忘記密碼**
→ 直接到 Railway Variables 改 `ADMIN_PASSWORD`，Redeploy 後就是新密碼。

---

## 為什麼不用資料庫？

整個站只有 ~20 套作品、幾百張照片，用 JSON 檔 + 檔案系統寫入簡單、可以直接用 Railway Volume 備份、不用額外付資料庫的錢。

如果之後作品突破 200 套或有多人同時編輯的需求，可以再改接 Postgres（Railway 內建很好接）。
