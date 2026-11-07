# Evitina Learn · 企業訓練與考核平台

[English](../README.md) · 繁體中文 · [Español](README.es.md)

支援正式員工、非正式員工及受邀訪客的自架學習、教材製作、考試與評分平台。以 Yaksh 為來源重建現代化 API，並整合 Scormly。

**預設介面為英文**，可在登入頁、平台、編輯器及考試頁切換繁體中文或西班牙文。平台與教材工作室共用語言偏好；切換不會清除未儲存的編輯或作答。使用者自行撰寫的教材、題目與姓名不會自動翻譯。

主要功能包括 Entra ID SSO、Email／帳號／員工編號登入、SCORM 課程及續讀、教材發布與原始專案備份、獨立考試、個人次數限制、人工評分及 Dashboard。考試可限定正式員工、非正式員工、部門、指定人員或僅限邀請。訪客連結可要求收件者 Email 驗證，建立連結的介面預設啟用此功能。

從專案根目錄執行：

```bash
cp .env.example .env
# 設定隨機 SECRET_KEY 與 POSTGRES_PASSWORD。
docker compose up --build -d --wait
docker compose exec api python manage.py createsuperuser
docker compose exec api python manage.py shell -c \
  "from training.models import User; User.objects.filter(is_superuser=True).update(role='admin')"
```

開啟 <http://localhost:8080>。公司 Entra 與 SMTP 需另行設定；公開 GitHub 提供原始碼，不代表已部署公司正式服務。SCORM 為單一 SCO 執行期子集，尚非完整認證實作；舊 Yaksh 程式僅供封存與移轉參考，不應部署。

完整建置、測試與範圍請參閱 [英文說明](../README.md)、[部署文件](DEPLOYMENT.md) 與[整合文件](INTEGRATIONS.md)。

![繁體中文介面與合成示範資料](screenshots/dashboard-zh-TW.png)

## 公司部署交接

v1.3 加入最多 200 人的 CSV 批次邀請、收件者與登入別名驗證、整批建立，以及回應遺失後十分鐘內的相同請求復原。關閉前可下載個人連結；邀請紀錄支援搜尋、狀態篩選與分頁。停用帳號也會封鎖其既有訪客連結與工作階段，保留已儲存答案和應試次數。請參閱 [v1.2 升級說明](PEACH1-HANDOVER.md#upgrade-from-v12) 與[邀請操作說明](OPERATIONS.md#guest-invitation-cohorts)。公司 Entra／Graph 串接仍留待 Peach1。

v1.2 強化自動儲存順序、斷線重試與多視窗衝突處理，並讓學員查看自己的作答及講師回饋。SCORM 課程關閉前會等待儲存確認，題庫選擇視窗支援鍵盤操作。升級會套用答案版本欄位的資料庫遷移；請參閱 [Peach1 升級說明](PEACH1-HANDOVER.md#upgrade-from-v11)。Entra／Graph 串接仍留待 Peach1。

v1.1 加入伺服器分頁與篩選成績、符合相同篩選條件的 CSV 匯出、評量與題目分析，以及作答前的個人剩餘次數提示。報表採用每次作答保留的題目版本，並依管理員與講師權限限制資料範圍。[評量分析畫面](screenshots/insights.png)。

v1.0 加入必修訓練指派、截止日期、完成報表、可重複使用的題庫、隨機考題與選項、CSV 人員匯入及密碼管理。介面預設英文，亦提供繁體中文與西班牙文。請參閱 [Peach1 交接指南](PEACH1-HANDOVER.md) 與 [操作說明](OPERATIONS.md)。公司 Entra、Graph 同步及郵件連線於 Peach1 階段完成驗收。
