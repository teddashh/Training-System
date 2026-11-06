# 公司部署、登入與營運

## 網域與儲存

建議使用 `learn.example.com` 與 `content.example.com`，由 Azure Application Gateway／反向代理提供有效 HTTPS。兩者需要不同 origin，但維持同一 registrable site，以便內容服務使用 SameSite=Lax cookie。不可把 SCORM HTML 直接放到主平台的 `/media/`，也不可讓內容服務暴露 `/api/` 或 `/admin/`。

Compose 預設為本機示範。正式環境將 `DEBUG=false`、`DEMO_MODE=false`，設定足夠隨機的 `SECRET_KEY`、資料庫密碼、實際 `ALLOWED_HOSTS`、`APP_ORIGIN` 和 `SCORM_ORIGIN`。只開放 HTTPS，並限制資料庫與內部 API 網路。若 TLS 在最外層代理終止，須由可信代理正確設置 `X-Forwarded-Proto`；部署時同步調整 Nginx，不接受任意來源偽造此 header。

`SECRET_KEY` 用於 Django session 簽署與 SCORM 啟動票證；更換將使舊票證無效。正式 session／CSRF cookie 使用 `__Host-` 前綴、Secure、host-only；session 為 HttpOnly。SCORM 專用內容 cookie 只能讀取授權 package，最長 8 小時。啟動票證有效 120 秒，不記入內容代理 access log。

資料庫採 PostgreSQL 17；SQLite 僅供開發。SCORM、原始專案儲存在 `media` volume，正式可使用持久化 Azure Files（需驗證寫入／讀取權限與效能）。SQL 資料和 media 必須共同備份，並定期進行還原測試。

## Microsoft Entra ID

1. 在公司 tenant 的 App registrations 建立單租用戶應用，平台選 **Web**。
2. Redirect URI 設為 `https://learn.example.com/api/auth/entra/callback/`。
3. 設定 `ENTRA_TENANT_ID` 為 tenant GUID、`ENTRA_CLIENT_ID` 為 app GUID。
4. 以部署環境／Key Vault 提供 `ENTRA_CLIENT_SECRET`，保留到期輪替程序。不需要把 Secret 提供給前端。
5. 依公司政策啟用 Enterprise application 的使用者指派、MFA／Conditional Access。
6. 實際測試允許的員工、guest、停用帳號、錯誤 tenant、登出與 session 到期。

MSAL 管理 authorization-code flow、state、nonce 與 PKCE。回呼額外檢查 tenant，並使用 `tenant-id:object-id` 作為穩定 SSO subject。首次有效 SSO 登入建立 **learner**，不因輸入的 E-mail 或顯示名稱授予管理員。

如果 E-mail 已存在於本機帳號，SSO 不會自動依同名 E-mail 綁定。由 Django 管理員確認本人後，將該帳號的 `entra_subject` 設為 `tenant-id:object-id`；再次登入後沿用既有身分和次數。平台新增的 role=admin 不會自動成為 Django superuser；保留少數維運人員作為 superuser。

官方依據：[OIDC](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc)、[Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)。

## E-mail 與員工編號

管理員先建立帳號。登入識別碼會跨 username、E-mail、employee_id 檢查碰撞。E-mail 僅有一個啟用／停用帳號可以使用；登入識別碼不能透過一般編輯 API 修改，以免次數歸戶錯誤。帳號不用 E-mail 時，可用 username 或 employee_id＋密碼。

E-mail OTP 使用 SMTP TLS，六位數、10 分鐘、最多五次驗證失敗、成功後刪除。未知 E-mail 不建立帳號且回應相同。資料庫持久化登入速率計數跨 Gunicorn worker 生效；DRF 的一般請求節流另為記憶體型。大型部署應把全站節流改為共享 cache，並在入口設 rate limit。

SMTP 失敗不向匿名訪客揭露帳號是否存在，因此 API 仍回傳一般提示；正式環境應另加入郵件投遞監測及維運警報。密碼由 Django PBKDF2 雜湊，建立／更新時套用密碼驗證。已有帳號重設密碼可由受權 Django 管理員處理。

## 考試與訪客

次數上限為該身分對某考試的總額度，優先採個別 override，否則採 exam.max_attempts。邀請另外受到本連結上限約束。開始作答在 PostgreSQL transaction 中鎖定 exam 與 budget，建立新作答才扣一次；重整可返回同一份未到期試卷。未登入訪客的受測者身分已寫在 Invitation，無法由訪客任意替換 key。

訪客 URL 的隨機 token 放在 fragment，初次交換為受 CSRF 保護的 server session 後清除。DB 只保存 SHA-256；明文連結只在建立時顯示一次。持有者可以作答，因此分享對象應是指定受測者。連結沒有對收件者做第二次 OTP 身分驗證。

試卷啟動時保存題目／答案／配分／及格門檻快照；學員和訪客 API 不回傳標準答案。截止後提交的新答案不會計入。`scheduler` 每分鐘執行逾時交卷；讀取結果或該作答也會處理逾時。PostgreSQL row lock 保護交卷與評分的原子性。

## 發布與營運

1. 執行 CI 與 Docker 建置，套用 migrations。
2. 部署 API、Web、Content 和單一 scheduler；設定健康檢查及服務監控。
3. 建立少數 superuser，透過平台分配 admin／instructor／learner。
4. 設定 SSO 與 SMTP，完成正式環境登入／邀請／SCORM 驗收。
5. 用公司實際教材驗證格式，用目標同時在線人數測試負載。
6. 保留 PostgreSQL、media 備份和操作紀錄。稽核表的 API 為唯讀；目前不是防竄改外部日誌儲存，資料庫維運者仍能修改。

目前 Docker 綁定本機，GitHub 公開的是程式碼。GitHub Actions 提供 build/test，不會自動把公司資料或網站部署到公網。
