import { useEffect, useState } from "react";
import {
  Plus,
  Search,
  Download,
  Link2,
  Copy,
  Check,
  Ban,
  Users as UsersIcon,
  ShieldCheck,
  Mail,
  KeyRound,
  FileCheck2,
  ExternalLink,
} from "lucide-react";
import { api } from "./api";
import type { User, Exam, Invitation, Result, Attempt } from "./types";
import {
  Modal,
  Badge,
  ErrorBox,
  Empty,
  Spinner,
  date,
  statusLabel,
} from "./ui";

export function Invitations({ exams }: { exams: Exam[] }) {
  const [rows, setRows] = useState<Invitation[]>([]),
    [open, setOpen] = useState(false),
    [exam, setExam] = useState(exams[0]?.id.toString() || ""),
    [key, setKey] = useState(""),
    [limit, setLimit] = useState(1),
    [days, setDays] = useState(7),
    [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const load = () =>
    api<Invitation[]>("invitations/")
      .then(setRows)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function issue(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const row = await api<Invitation>("invitations/issue/", "POST", {
        exam: Number(exam),
        key,
        max_attempts: limit,
        days,
      });
      setUrl(row.url!);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(id: string) {
    try {
      await api(`invitations/${id}/revoke/`, "POST", {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("無法使用剪貼簿，請選取連結後手動複製。");
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">GUEST ACCESS</div>
          <h1>訪客考試邀請</h1>
          <p>一人一個專屬連結，讓非帳號使用者也能安心參與。</p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setOpen(true);
            setUrl("");
            setCopied(false);
            setError("");
          }}
        >
          <Plus size={17} />
          建立專屬連結
        </button>
      </div>
      <div className="info-banner">
        <ShieldCheck size={25} />
        <div>
          <strong>每一份邀請，都有明確的使用範圍。</strong>
          <p>
            以 E-mail
            或帳號綁定受測者，設定有效天數與可考次數。多個連結仍共用同一受測者的總額度。
          </p>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>受測者</th>
                <th>考試</th>
                <th>連結使用次數</th>
                <th>有效期限</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <div className="cell-person">
                      <div className="avatar soft">
                        <Mail size={16} />
                      </div>
                      <strong>
                        {row.identity_key.replace(/^(email|account):/, "")}
                      </strong>
                    </div>
                  </td>
                  <td>{row.exam_title}</td>
                  <td>
                    {row.used} / {row.max_attempts}
                  </td>
                  <td>{date(row.expires_at)}</td>
                  <td>
                    <Badge
                      tone={
                        row.revoked
                          ? "neutral"
                          : new Date(row.expires_at) < new Date()
                            ? "amber"
                            : "teal"
                      }
                    >
                      {row.revoked
                        ? "已停用"
                        : new Date(row.expires_at) < new Date()
                          ? "已過期"
                          : "有效"}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="text-btn danger-text"
                      disabled={row.revoked}
                      onClick={() => revoke(row.id)}
                    >
                      <Ban size={14} />
                      停用
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <Empty
            title="尚未建立邀請"
            description="建立連結後，即可分享給指定受測者。"
          />
        )}
      </div>
      {open && (
        <Modal
          title={url ? "專屬連結已建立" : "建立考試邀請"}
          onClose={() => setOpen(false)}
        >
          <form className="modal-form" onSubmit={issue}>
            {url ? (
              <>
                <div className="success-icon">
                  <Check size={28} />
                </div>
                <p>
                  請複製並分享給指定受測者。為保護存取權限，此完整連結只顯示一次。
                </p>
                <label>
                  專屬考試連結
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
                <button
                  type="button"
                  className="btn primary full"
                  onClick={copy}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}{" "}
                  {copied ? "已複製連結" : "複製連結"}
                </button>
                <p className="notice">連結是受測者的存取憑證，請勿公開張貼。</p>
              </>
            ) : (
              <>
                <label>
                  指定考試
                  <select
                    required
                    value={exam}
                    onChange={(e) => setExam(e.target.value)}
                  >
                    <option value="">請選擇</option>
                    {exams.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  受測者 E-mail、帳號或員工編號
                  <input
                    required
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder="person@example.com"
                  />
                </label>
                <div className="form-grid">
                  <label>
                    此連結最多可考幾次
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={limit}
                      onChange={(e) => setLimit(Number(e.target.value))}
                    />
                  </label>
                  <label>
                    有效天數
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={days}
                      onChange={(e) => setDays(Number(e.target.value))}
                    />
                  </label>
                </div>
                <p className="notice">
                  若需要增加受測者總次數，請在「考試與評量 →
                  個別次數設定」調整；重新建立連結不會重置已使用次數。
                </p>
                <div className="modal-footer">
                  <button className="btn primary" disabled={busy}>
                    {busy ? "建立中…" : "建立專屬連結"}
                    <Link2 size={16} />
                  </button>
                </div>
              </>
            )}
            <ErrorBox message={error} />
          </form>
        </Modal>
      )}
    </>
  );
}

function ReviewModal({
  id,
  onClose,
  onSaved,
}: {
  id: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(null),
    [marks, setMarks] = useState<Attempt["manual_grades"]>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Attempt>(`results/${id}/review/`)
      .then((a) => {
        setAttempt(a);
        setMarks(a.manual_grades);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`results/${id}/review/`, "POST", { grades: marks });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="試卷評閱" onClose={onClose} wide>
      <form className="modal-form" onSubmit={save}>
        <ErrorBox message={error} />
        {attempt ? (
          <>
            <h3>
              {attempt.title} · {attempt.person}
            </h3>
            {attempt.questions.map((q, i) => (
              <div className="review-question" key={q.id}>
                <div>
                  <Badge tone="neutral">
                    題目 {i + 1} · {q.points} 分
                  </Badge>
                  <h3>{q.description}</h3>
                  <p className="review-answer">
                    {Array.isArray(attempt.answers[String(q.id)])
                      ? (attempt.answers[String(q.id)] as number[])
                          .map((v) => q.options[v])
                          .join("、")
                      : typeof attempt.answers[String(q.id)] === "number"
                        ? q.options[attempt.answers[String(q.id)] as number]
                        : String(attempt.answers[String(q.id)] || "（未作答）")}
                  </p>
                </div>
                {q.type === "essay" ? (
                  <div className="form-grid">
                    <label>
                      得分
                      <input
                        type="number"
                        min={0}
                        max={q.points}
                        step={0.5}
                        required
                        value={marks[String(q.id)]?.points ?? ""}
                        onChange={(e) =>
                          setMarks({
                            ...marks,
                            [String(q.id)]: {
                              ...marks[String(q.id)],
                              points: Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      評語
                      <input
                        value={marks[String(q.id)]?.feedback || ""}
                        onChange={(e) =>
                          setMarks({
                            ...marks,
                            [String(q.id)]: {
                              points: marks[String(q.id)]?.points ?? 0,
                              feedback: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                ) : (
                  <small className="muted">
                    自動評分 · 標準答案：
                    {q.solution
                      ?.map((v) => (typeof v === "number" ? q.options[v] : v))
                      .join("、")}
                  </small>
                )}
              </div>
            ))}
            <div className="modal-footer">
              <button type="button" className="btn" onClick={onClose}>
                關閉
              </button>
              {attempt.questions.some((q) => q.type === "essay") && (
                <button className="btn primary" disabled={busy}>
                  {busy ? "儲存中…" : "儲存評分與回饋"}
                </button>
              )}
            </div>
          </>
        ) : (
          !error && <Spinner />
        )}
      </form>
    </Modal>
  );
}

export function Results({
  user,
  refreshKey,
  onSaved,
  go,
}: {
  user: User;
  refreshKey: number;
  onSaved: () => void;
  go: (p: string) => void;
}) {
  const [rows, setRows] = useState<Result[]>([]),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [review, setReview] = useState(""),
    [page, setPage] = useState(0);
  useEffect(() => {
    api<Result[]>("results/")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [refreshKey]);
  const filtered = rows.filter(
    (r) =>
      (r.exam + r.person + r.department).includes(search) &&
      (!status || r.status === status),
  );
  const scored = rows.filter((r) => r.score !== null),
    average = scored.length
      ? Math.round(scored.reduce((s, r) => s + r.score!, 0) / scored.length)
      : 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PERFORMANCE & INSIGHTS</div>
          <h1>成績與考核</h1>
          <p>從每一份評量中，找到下一次進步的方向。</p>
        </div>
        <a className="btn" href="/api/results/export/">
          <Download size={17} />
          匯出成績 CSV
        </a>
      </div>
      <div className="summary-strip">
        <div>
          <FileCheck2 size={23} />
          <strong>{rows.length}</strong>
          <span>份作答紀錄</span>
        </div>
        <div>
          <Check size={23} />
          <strong>{average}</strong>
          <span>平均分數</span>
        </div>
        <div>
          <ClockIcon />
          <strong>
            {rows.filter((r) => r.status === "pending_review").length}
          </strong>
          <span>份待評分</span>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["", "全部紀錄"],
            ["pending_review", "待人工評分"],
            ["graded", "已評分"],
            ["in_progress", "作答中"],
          ].map(([value, label]) => (
            <button
              className={status === value ? "active" : ""}
              key={value}
              onClick={() => {
                setStatus(value);
                setPage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder="搜尋人員、考試或部門…"
            aria-label="搜尋成績"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
          />
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>受測者</th>
                <th>考試名稱</th>
                <th>第幾次</th>
                <th>成績</th>
                <th>狀態</th>
                <th>交卷時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(page * 12, (page + 1) * 12).map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="cell-person">
                      <div className="avatar soft">{r.person.slice(0, 1)}</div>
                      <div>
                        <strong>{r.person}</strong>
                        <small>{r.department || "未分配部門"}</small>
                      </div>
                    </div>
                  </td>
                  <td>{r.exam}</td>
                  <td>第 {r.number} 次</td>
                  <td>
                    <strong className={r.passed ? "teal-text" : ""}>
                      {r.score === null ? "—" : r.score}
                    </strong>
                    {r.score !== null && (
                      <small className="muted"> / 100</small>
                    )}
                  </td>
                  <td>
                    <Badge
                      tone={
                        r.status === "pending_review"
                          ? "amber"
                          : r.passed
                            ? "teal"
                            : r.status === "graded"
                              ? "red"
                              : "blue"
                      }
                    >
                      {r.status === "graded"
                        ? r.passed
                          ? "通過"
                          : "未通過"
                        : statusLabel[r.status]}
                    </Badge>
                  </td>
                  <td>{date(r.submitted_at)}</td>
                  <td>
                    {user.role !== "learner" && r.status !== "in_progress" ? (
                      <button
                        className="text-btn"
                        onClick={() => setReview(r.id)}
                      >
                        {r.status === "pending_review"
                          ? "前往評分"
                          : "檢視試卷"}
                      </button>
                    ) : user.role === "learner" ? (
                      <button
                        className="text-btn"
                        onClick={() => go("/attempt/" + r.id)}
                      >
                        查看
                      </button>
                    ) : (
                      <span className="muted">尚未交卷</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!filtered.length && <Empty title="尚無符合的評量紀錄" />}
        <div className="table-footer">
          <span>
            共 {filtered.length} 筆
            {rows.length === 1000
              ? "（顯示最近 1,000 筆；完整資料請匯出）"
              : ""}
          </span>
          <div>
            <button
              className="btn small"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              上一頁
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(filtered.length / 12))}
            </span>
            <button
              className="btn small"
              disabled={(page + 1) * 12 >= filtered.length}
              onClick={() => setPage(page + 1)}
            >
              下一頁
            </button>
          </div>
        </div>
      </div>
      {review && (
        <ReviewModal
          id={review}
          onClose={() => setReview("")}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
function ClockIcon() {
  return <FileCheck2 size={23} />;
}

export function People() {
  const [users, setUsers] = useState<User[]>([]),
    [search, setSearch] = useState(""),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    api<User[]>("users/")
      .then(setUsers)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      await api("users/", "POST", Object.fromEntries(form));
      setOpen(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle(user: User) {
    try {
      await api(`users/${user.id}/`, "PATCH", { is_active: !user.is_active });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">PEOPLE DIRECTORY</div>
          <h1>人員與權限</h1>
          <p>串聯正式員工與合作夥伴，建立共同成長的學習空間。</p>
        </div>
        <button
          className="btn primary"
          onClick={() => {
            setOpen(true);
            setError("");
          }}
        >
          <Plus size={17} />
          新增人員
        </button>
      </div>
      <div className="toolbar">
        <h2>
          所有人員 <span className="count">{users.length}</span>
        </h2>
        <div className="search-field">
          <Search size={16} />
          <input
            placeholder="搜尋姓名、E-mail 或部門…"
            aria-label="搜尋人員"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>人員</th>
                <th>員工編號</th>
                <th>部門</th>
                <th>身分類型</th>
                <th>權限</th>
                <th>狀態</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {users
                .filter((u) =>
                  (u.display_name + u.email + u.department).includes(search),
                )
                .map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="cell-person">
                        <div className="avatar soft">
                          {u.display_name?.slice(0, 1) || "U"}
                        </div>
                        <div>
                          <strong>{u.display_name || u.username}</strong>
                          <small>{u.email || u.username}</small>
                        </div>
                      </div>
                    </td>
                    <td>{u.employee_id || "—"}</td>
                    <td>{u.department || "—"}</td>
                    <td>
                      <Badge
                        tone={u.employment === "employee" ? "blue" : "purple"}
                      >
                        {u.employment === "employee"
                          ? "正式員工"
                          : "非正式員工"}
                      </Badge>
                    </td>
                    <td>
                      {
                        {
                          admin: "管理員",
                          instructor: "講師",
                          learner: "學員",
                        }[u.role]
                      }
                    </td>
                    <td>
                      <Badge tone={u.is_active ? "teal" : "neutral"}>
                        {u.is_active ? "啟用" : "停用"}
                      </Badge>
                    </td>
                    <td>
                      <button className="text-btn" onClick={() => toggle(u)}>
                        {u.is_active ? "停用" : "啟用"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {open && (
        <Modal title="新增培訓人員" onClose={() => setOpen(false)}>
          <form className="modal-form" onSubmit={create}>
            <div className="form-grid">
              <label>
                顯示姓名
                <input name="display_name" required maxLength={100} />
              </label>
              <label>
                登入帳號
                <input name="username" required maxLength={100} />
              </label>
              <label className="span-2">
                E-mail（選填，可使用驗證碼登入）
                <input name="email" type="email" />
              </label>
              <label>
                員工編號（選填）
                <input name="employee_id" />
              </label>
              <label>
                部門
                <input name="department" />
              </label>
              <label>
                身分類型
                <select name="employment">
                  <option value="employee">正式員工</option>
                  <option value="contractor">非正式員工</option>
                </select>
              </label>
              <label>
                系統權限
                <select name="role">
                  <option value="learner">學員</option>
                  <option value="instructor">講師</option>
                  <option value="admin">管理員</option>
                </select>
              </label>
              <label className="span-2">
                初始密碼（選填，至少 12 碼）
                <input
                  name="password"
                  type="password"
                  minLength={12}
                  autoComplete="new-password"
                />
              </label>
            </div>
            <p className="notice">
              未設定密碼的帳號可透過已設定的 E-mail 驗證碼登入。Entra
              帳號連結可由 Django 管理介面設定。
            </p>
            <ErrorBox message={error} />
            <div className="modal-footer">
              <button className="btn primary" disabled={busy}>
                {busy ? "建立中…" : "建立人員"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

export function Settings({ entra }: { entra: boolean }) {
  const [rows, setRows] = useState<
      {
        id: number;
        actor__display_name: string;
        action: string;
        target: string;
        created_at: string;
      }[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    api<typeof rows>("audit/")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE SETTINGS</div>
          <h1>系統與稽核</h1>
          <p>清楚掌握登入設定與系統操作紀錄。</p>
        </div>
        <a className="btn" href="/admin/" target="_blank" rel="noreferrer">
          進階管理
          <ExternalLink size={16} />
        </a>
      </div>
      <div className="settings-grid">
        {[
          [
            ShieldCheck,
            "Microsoft Entra ID",
            entra
              ? "已設定企業單一登入"
              : "等待設定 Tenant ID、Client ID 與伺服器端 Secret",
          ],
          [Mail, "E-mail 驗證碼", "管理員建立帳號後，可寄送一次性登入驗證碼"],
          [
            KeyRound,
            "帳號／員工編號",
            "支援帳號、E-mail 或員工編號搭配密碼登入",
          ],
        ].map(([Icon, title, body]) => {
          const C = Icon as typeof ShieldCheck;
          return (
            <section className="panel setting-card" key={String(title)}>
              <C size={26} />
              <h2>{String(title)}</h2>
              <p>{String(body)}</p>
            </section>
          );
        })}
      </div>
      <div className="toolbar">
        <h2>最近操作紀錄</h2>
        <Badge tone="neutral">最近 200 筆</Badge>
      </div>
      <ErrorBox message={error} />
      <div className="panel table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>操作者</th>
                <th>動作</th>
                <th>對象 ID</th>
                <th>時間</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.actor__display_name || "訪客／系統"}</td>
                  <td>
                    <code>{r.action}</code>
                  </td>
                  <td className="muted truncate">{r.target}</td>
                  <td>{date(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="尚無操作紀錄" />}
      </div>
    </>
  );
}
