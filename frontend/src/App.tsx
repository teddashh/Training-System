import { useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  BookOpen,
  ClipboardCheck,
  Layers3,
  Link2,
  BarChart3,
  Users,
  Settings as SettingsIcon,
  Search,
  HelpCircle,
  Menu,
  X,
  LogOut,
  ChevronRight,
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { api } from "./api";
import type { Course, Exam, User } from "./types";
import Login from "./Login";
import Dashboard from "./Dashboard";
import Courses from "./Courses";
import Exams from "./Exams";
import Attempt, { GuestExam } from "./Attempt";
import { Invitations, People, Results, Settings } from "./Management";
import { Modal, ErrorBox, Spinner } from "./ui";

const nav = [
  {
    path: "/",
    label: "總覽 Dashboard",
    icon: LayoutDashboard,
    group: "工作空間",
  },
  { path: "/courses", label: "學習課程", icon: BookOpen },
  { path: "/exams", label: "考試與評量", icon: ClipboardCheck },
  { path: "/results", label: "成績與考核", icon: BarChart3 },
  {
    path: "/authoring",
    label: "教材工作室",
    icon: Layers3,
    manage: true,
    group: "內容與管理",
  },
  { path: "/invitations", label: "訪客考試邀請", icon: Link2, manage: true },
  { path: "/people", label: "人員與權限", icon: Users, admin: true },
  { path: "/settings", label: "系統與稽核", icon: SettingsIcon, admin: true },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [entra, setEntra] = useState(false),
    [demo, setDemo] = useState(false),
    [path, setPath] = useState(window.location.pathname),
    [courses, setCourses] = useState<Course[]>([]),
    [exams, setExams] = useState<Exam[]>([]),
    [error, setError] = useState(""),
    [refreshKey, setRefreshKey] = useState(0),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(""),
    [help, setHelp] = useState(false),
    [profile, setProfile] = useState(false),
    [loading, setLoading] = useState(false);
  const go = useCallback((next: string) => {
    history.pushState({}, "", next);
    setPath(next);
    setMobile(false);
    setQuery("");
    window.scrollTo(0, 0);
  }, []);
  const refresh = useCallback(() => setRefreshKey((v) => v + 1), []);
  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", pop);
    api<{ user: User | null; entra_enabled: boolean; demo_mode?: boolean }>(
      "auth/session/",
    )
      .then((s) => {
        setUser(s.user);
        setEntra(s.entra_enabled);
        setDemo(!!s.demo_mode);
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([api<Course[]>("courses/"), api<Exam[]>("exams/")])
      .then(([c, e]) => {
        setCourses(c);
        setExams(e);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [user, refreshKey]);
  async function signOut() {
    try {
      await api("auth/logout/", "POST", {});
      setUser(null);
      setProfile(false);
      go("/");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (!ready) return <Spinner />;
  if (error && !user)
    return (
      <div className="connection-error">
        <ErrorBox message={"無法連接訓練平台：" + error} />
        <button className="btn" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          重新連線
        </button>
      </div>
    );
  if (path === "/invite") return <GuestExam go={go} />;
  if (path.startsWith("/attempt/"))
    return <Attempt id={path.split("/")[2]} go={go} guest={!user} />;
  if (!user)
    return (
      <Login
        entra={entra}
        onLogin={(u) => {
          setUser(u);
          go("/");
        }}
      />
    );
  const current = nav.find((n) => n.path === path),
    allowed =
      current &&
      (!current.admin || user.role === "admin") &&
      (!current.manage || user.role !== "learner");
  const matches = [
    ...courses
      .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
      .map((c) => ({
        id: "c" + c.id,
        title: c.title,
        type: "學習課程",
        path: "/courses",
      })),
    ...exams
      .filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
      .map((e) => ({
        id: "e" + e.id,
        title: e.title,
        type: "考試評量",
        path: "/exams",
      })),
  ].slice(0, 8);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        跳至主要內容
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label="關閉導覽"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={"sidebar " + (mobile ? "open" : "")}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <span className="brand-mark">
            <Layers3 size={23} />
          </span>
          <span>
            evitina<span className="brand-light"> learn</span>
            <small>企業人才發展平台</small>
          </span>
        </a>
        <div className="workspace-picker">
          <div className="workspace-avatar">E</div>
          <div>
            <strong>企業學習工作空間</strong>
            <span>Enterprise workspace</span>
          </div>
          <ShieldCheck size={16} />
        </div>
        <nav aria-label="主要導覽">
          {nav
            .filter(
              (n) =>
                (!n.admin || user.role === "admin") &&
                (!n.manage || user.role !== "learner"),
            )
            .map((n) => (
              <div key={n.path}>
                {n.group && <div className="nav-group">{n.group}</div>}
                <a
                  href={n.path}
                  className={path === n.path ? "active" : ""}
                  onClick={(e) => {
                    e.preventDefault();
                    go(n.path);
                  }}
                >
                  <n.icon size={19} />
                  <span>{n.label}</span>
                  {path === n.path && <span className="nav-active-dot" />}
                </a>
              </div>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="grow-card">
            <div className="grow-icon">
              <BookOpen size={22} />
              <span>+</span>
            </div>
            <h3>成長，從學習開始。</h3>
            <p>每一份投入，都是更好的自己。</p>
            <button onClick={() => go("/courses")}>
              探索學習資源
              <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <HelpCircle size={17} />
            使用說明與支援
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-version">
            <span className="live-dot" />
            {demo ? "示範環境 · 合成資料" : "企業訓練工作空間"}
            <span>v0.1</span>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-btn mobile-toggle"
            aria-label="開啟導覽"
            onClick={() => setMobile(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            <span>工作空間</span>
            <ChevronRight size={14} />
            <strong>{current?.label || "頁面"}</strong>
          </div>
          <div className="topbar-right">
            <div className="global-search">
              <Search size={17} />
              <input
                placeholder="搜尋課程、考試…"
                aria-label="全站搜尋"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌕</kbd>
              {query && (
                <div className="search-results">
                  {matches.length ? (
                    matches.map((m) => (
                      <button key={m.id} onClick={() => go(m.path)}>
                        <span>
                          <strong>{m.title}</strong>
                          <small>{m.type}</small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))
                  ) : (
                    <p>找不到符合的課程或考試</p>
                  )}
                </div>
              )}
            </div>
            <button
              className="icon-btn help-top"
              onClick={() => setHelp(true)}
              aria-label="使用說明"
            >
              <HelpCircle size={19} />
            </button>
            <span className="topbar-divider" />
            <div className="profile-wrap">
              <button
                className="profile-button"
                onClick={() => setProfile(!profile)}
                aria-expanded={profile}
              >
                <div className="avatar">{user.display_name.slice(0, 1)}</div>
                <div>
                  <strong>{user.display_name}</strong>
                  <span>
                    {
                      {
                        admin: "系統管理員",
                        instructor: "培訓講師",
                        learner: "學習成員",
                      }[user.role]
                    }
                  </span>
                </div>
                <ChevronRight size={14} />
              </button>
              {profile && (
                <div className="profile-menu">
                  <strong>{user.email || user.username}</strong>
                  <span>{user.department || "未分配部門"}</span>
                  <button onClick={signOut}>
                    <LogOut size={15} />
                    登出工作空間
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content">
          <ErrorBox message={error} />
          {loading && !courses.length && !exams.length ? (
            <Spinner />
          ) : !allowed ? (
            <div className="panel not-found">
              <h1>此頁面不存在或無存取權限</h1>
              <button className="btn primary" onClick={() => go("/")}>
                返回總覽
              </button>
            </div>
          ) : path === "/" ? (
            <Dashboard
              user={user}
              courses={courses}
              exams={exams}
              go={go}
              refreshKey={refreshKey}
            />
          ) : path === "/courses" ? (
            <Courses courses={courses} user={user} onSaved={refresh} />
          ) : path === "/authoring" ? (
            <Courses courses={courses} user={user} onSaved={refresh} studio />
          ) : path === "/exams" ? (
            <Exams
              exams={exams}
              courses={courses}
              user={user}
              onSaved={refresh}
              go={go}
            />
          ) : path === "/invitations" ? (
            <Invitations exams={exams} />
          ) : path === "/results" ? (
            <Results
              user={user}
              refreshKey={refreshKey}
              onSaved={refresh}
              go={go}
            />
          ) : path === "/people" ? (
            <People />
          ) : (
            <Settings entra={entra} />
          )}
          <footer className="app-footer">
            <span>
              © {new Date().getFullYear()} Evitina Learn
              <span className="inline-sep">·</span>讓學習成為成長的力量
            </span>
            <span>
              <ShieldCheck size={13} />
              企業人才發展平台
            </span>
          </footer>
        </main>
      </div>
      {help && (
        <Modal title="歡迎使用 Evitina Learn" onClose={() => setHelp(false)}>
          <div className="modal-form help-content">
            <h3>開始學習</h3>
            <p>
              前往「學習課程」開啟教材。SCORM
              課程會自動儲存進度，下次可以接續學習。
            </p>
            <h3>參與評量</h3>
            <p>
              在「考試與評量」查看開放中的考試。開始後計時不會暫停，答案會自動儲存；交卷後可在「成績與考核」查看結果。
            </p>
            {user.role !== "learner" && (
              <>
                <h3>製作教材與邀請受測者</h3>
                <p>
                  使用「教材工作室」編寫文字教材，或開啟 Scormly
                  製作互動課程並匯出 SCORM
                  ZIP。訪客可透過專屬連結參加考試，每個身分的總次數由伺服器統一管理。
                </p>
              </>
            )}
            <div className="notice">
              如需變更權限、重設密碼或調整考試次數，請聯絡公司訓練管理員。
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
