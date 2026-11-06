# 上游整合與移轉紀錄

## FOSSEE / online_test（Yaksh）

- 來源 commit：`336fc050cce6eab6d45475297d19f3b659491d48`
- 本 repository 直接保留其 Git 歷史，原始工作樹搬至 `legacy/yaksh/`。
- 企業平台以其 Question、Quiz、QuestionPaper、AnswerPaper 的題庫／考試／作答／評分概念重建資料模型；課程關聯改為選填，新增 stable Identity、AttemptBudget 與 Invitation。
- 舊 Django 3.1 與 code-server 未啟用，也沒有宣稱所有舊 API 相容。保留舊 source 供評估與移轉核對。

題庫移轉範例，`questions.json`：

```json
[
  {
    "summary": "Security",
    "type": "mcq",
    "description": "收到可疑郵件時應如何處理？",
    "points": 10,
    "testcase": [
      {"test_case_type": "mcqtestcase", "options": "回報資訊窗口", "correct": true},
      {"test_case_type": "mcqtestcase", "options": "提供密碼", "correct": false}
    ]
  }
]
```

```bash
DEBUG=true .venv/bin/python backend/manage.py import_yaksh questions.json \
  --owner demo.admin --title '舊題庫移轉檢查'
```

原生 YAML export 可在有 PyYAML 的受控環境執行 `list(yaml.safe_load_all(...))` 後輸出 JSON。禁止 `yaml.load` 或執行舊 HookTestCase 程式碼。轉換器只接受 mcq／mcc 與整數配分，清除 HTML 顯示標籤，驗證選項與答案後整批建立為草稿。其餘題型、附件、使用者、課程、歷史成績應另做有對照表的資料移轉；不要直接把舊 DB 接到新 app。

## dhodges47 / SCORM-LearningManagementSystem

- 來源 commit：`87a57d9702aa5d9f3befb22b55444d026ba3be51`
- 原 `OutermostLMSV5.js` 與 MIT license 放在 `vendor/scorm-reference/`。
- 新 runtime 保留 `API`（SCORM 1.2）／`API_1484_11`（2004）的 initialize/get/set/commit/finish 表面，改由跨 origin postMessage 交給登入中的父頁面，再寫入 Django。
- 不執行舊 .NET Core 2.1／SQL Server app。ZIP 防路徑穿越與解壓限制、簽署啟動票證、專用內容 cookie 和獨立來源為新整合層。
- synchronous SCORM Commit 先接受記憶體 buffer；父頁面取得伺服器回覆後才顯示已儲存，失敗時保留畫面錯誤且 runtime 設置 general exception。每 15 秒 commit 一次。這不是完整 SCORM certification，未實作完整 sequencing 或所有資料型別驗證。

## dmmat / Scormly

- 來源 commit：`53c35d2753e89db5f58f07de4d6164be14359fce`
- 完整 MIT 原始碼在 `vendor/scormly/`，建置時掛載 `/studio/`。
- 新增 `buildScormZip` 與 `PublishLms`：透過登入 session／CSRF 將 SCORM 1.2 和 project ZIP 送到指定課程。
- 原始專案不放到公開媒體 URL，僅課程擁有講師／管理員可下載；教材版本檔保留舊版。
- 載入還原：在主平台教材卡下載原始專案，再於 Scormly「Open a project (.zip)」開啟。不是多人即時共同編輯，也不會自動持續同步每一個編輯動作。
- 原版 192 個測試與建置納入 CI；企業新增發布流程另有瀏覽器整合驗證。

## 視覺參考

[School-Management-Dashboard](https://github.com/MariemMagdi/School-Management-Dashboard) 用作卡片、圖表、表格的資訊架構參考；其公開 repository 未列出明確 license，因此沒有複製其原始碼或圖像。

[Evitina](https://www.evitina.tw/) 用作深色底、青綠 accent、Serif 中文標題和幾何系統圖語彙參考。企業介面原創實作，搭配 Azure 藍。未複製其 CSS/template，也未使用其 Logo 圖檔。
