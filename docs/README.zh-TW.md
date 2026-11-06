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
