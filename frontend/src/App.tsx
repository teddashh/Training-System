import { t, useLocale, LanguagePicker } from "./i18n";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
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
  ClipboardList,
  LibraryBig,
} from "lucide-react";
import { api } from "./api";
import type { Course, Exam, User } from "./types";
import Login from "./Login";

import Courses from "./Courses";
import Exams from "./Exams";
import Attempt, { GuestExam } from "./Attempt";
import { Invitations, People, Results, Settings } from "./Management";
import { Modal, ErrorBox, Spinner } from "./ui";
import Assignments from "./Assignments";
import QuestionBank from "./QuestionBank";

import { PasswordDialog } from "./PeopleTools";
const Dashboard = lazy(() => import("./Dashboard"));
const Insights = lazy(() => import("./Insights"));

const getNav = () => [
  {
    path: "/",
    label: t("Overview Dashboard"),
    icon: LayoutDashboard,
    group: t("Workspace"),
  },
  { path: "/courses", label: t("Learning courses"), icon: BookOpen },
  { path: "/assignments", label: t("Assigned training"), icon: ClipboardList },
  { path: "/exams", label: t("Exams & assessments"), icon: ClipboardCheck },
  { path: "/results", label: t("Results & reviews"), icon: BarChart3 },
  {
    path: "/insights",
    label: t("Assessment insights"),
    icon: BarChart3,
    manage: true,
  },
  {
    path: "/authoring",
    label: t("Authoring studio"),
    icon: Layers3,
    manage: true,
    group: t("Content & administration"),
  },
  {
    path: "/invitations",
    label: t("Guest exam invitations"),
    icon: Link2,
    manage: true,
  },
  {
    path: "/question-bank",
    label: t("Question bank"),
    icon: LibraryBig,
    manage: true,
  },
  {
    path: "/people",
    label: t("People & permissions"),
    icon: Users,
    admin: true,
  },
  {
    path: "/settings",
    label: t("Settings & audit"),
    icon: SettingsIcon,
    admin: true,
  },
];
export default function App() {
  useLocale();
  const nav = getNav();
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
    [password, setPassword] = useState(false),
    [loading, setLoading] = useState(false);
  const go = useCallback((next: string) => {
    history.pushState({}, "", next);
    setPath(new URL(next, window.location.origin).pathname);
    setMobile(false);
    setQuery("");
    window.scrollTo(0, 0);
  }, []);
  const refresh = useCallback(() => setRefreshKey((v) => v + 1), []);
  useEffect(() => {
    const pop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", pop);
    api<{
      user: User | null;
      entra_enabled: boolean;
      demo_mode?: boolean;
    }>("auth/session/")
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
    if (!user || path.startsWith("/attempt/") || path.startsWith("/preview/"))
      return;
    let alive = true;
    setLoading(true);
    Promise.all([api<Course[]>("courses/"), api<Exam[]>("exams/")])
      .then(([c, e]) => {
        if (!alive) return;
        setCourses(c);
        setExams(e);
        setError("");
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [user, refreshKey, path]);
  async function signOut() {
    try {
      await api("auth/logout/", "POST", {});
      setUser(null);
      setCourses([]);
      setExams([]);
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
        <ErrorBox
          message={t("Cannot connect to the learning platform: ") + error}
        />
        <button className="btn" onClick={() => window.location.reload()}>
          <RefreshCw size={16} />
          {t("Reconnect") + " "}
        </button>
      </div>
    );
  if (path === "/invite") return <GuestExam go={go} />;
  if (path.startsWith("/attempt/"))
    return <Attempt key={path} id={path.split("/")[2]} go={go} guest={!user} />;
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
  if (path.startsWith("/preview/"))
    return <Attempt key={path} id={path.split("/")[2]} go={go} preview />;
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
        type: t("Learning courses"),
        path: "/courses",
      })),
    ...exams
      .filter((e) => e.title.toLowerCase().includes(query.toLowerCase()))
      .map((e) => ({
        id: "e" + e.id,
        title: e.title,
        type: t("Assessment"),
        path: "/exams",
      })),
  ].slice(0, 8);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {t("Skip to main content") + " "}
      </a>
      {mobile && (
        <button
          className="sidebar-backdrop"
          aria-label={t("Close navigation")}
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
            <small>{t("Enterprise learning platform")}</small>
          </span>
        </a>
        <div className="workspace-picker">
          <div className="workspace-avatar">E</div>
          <div>
            <strong>{t("Company learning workspace")}</strong>
            <span>{t("Enterprise workspace")}</span>
          </div>
          <ShieldCheck size={16} />
        </div>
        <nav aria-label={t("Main navigation")}>
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
            <h3>{t("Growth starts with learning.")}</h3>
            <p>{t("Every step brings new possibilities.")}</p>
            <button onClick={() => go("/courses")}>
              {t("Explore learning resources") + " "}
              <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <HelpCircle size={17} />
            {t("Help & support") + " "}
            <ArrowUpRight size={14} />
          </button>
          <div className="sidebar-version">
            <span className="live-dot" />
            {demo
              ? t("Demo environment \u00B7 Synthetic data")
              : t("Enterprise training workspace")}
            <span>v1.3</span>
          </div>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <button
            className="icon-btn mobile-toggle"
            aria-label={t("Open navigation")}
            onClick={() => setMobile(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            <span>{t("Workspace")}</span>
            <ChevronRight size={14} />
            <strong>{current?.label || t("Page")}</strong>
          </div>
          <div className="topbar-right">
            <LanguagePicker />
            <div className="global-search">
              <Search size={17} />
              <input
                placeholder={t("Search courses and exams\u2026")}
                aria-label={t("Search everything")}
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
                    <p>{t("No matching courses or exams")}</p>
                  )}
                </div>
              )}
            </div>
            <button
              className="icon-btn help-top"
              onClick={() => setHelp(true)}
              aria-label={t("Help")}
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
                        admin: t("System administrator"),
                        instructor: t("Training instructor"),
                        learner: t("Learning member"),
                      }[user.role]
                    }
                  </span>
                </div>
                <ChevronRight size={14} />
              </button>
              {profile && (
                <div className="profile-menu">
                  <strong>{user.email || user.username}</strong>
                  <span>{user.department || t("No department assigned")}</span>
                  <button
                    onClick={() => {
                      setProfile(false);
                      setPassword(true);
                    }}
                  >
                    {t("Change password")}
                  </button>
                  <button onClick={signOut}>
                    <LogOut size={15} />
                    {t("Sign out") + " "}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content">
          <Suspense fallback={<Spinner />}>
            <ErrorBox message={error} />
            {loading && !courses.length && !exams.length ? (
              <Spinner />
            ) : !allowed ? (
              <div className="panel not-found">
                <h1>{t("This page does not exist or is not accessible")}</h1>
                <button className="btn primary" onClick={() => go("/")}>
                  {t("Back to overview") + " "}
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
            ) : path === "/assignments" ? (
              <Assignments
                user={user}
                courses={courses}
                exams={exams}
                go={go}
                onSaved={refresh}
              />
            ) : path === "/question-bank" ? (
              <QuestionBank />
            ) : path === "/insights" ? (
              <Insights exams={exams} />
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
                exams={exams}
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
                <span className="inline-sep">·</span>
                {t("Make learning a part of growth") + " "}
              </span>
              <span>
                <ShieldCheck size={13} />
                {t("Enterprise learning platform") + " "}
              </span>
            </footer>
          </Suspense>
        </main>
      </div>
      {password && <PasswordDialog onClose={() => setPassword(false)} />}
      {help && (
        <Modal
          title={t("Welcome to Evitina Learn")}
          onClose={() => setHelp(false)}
        >
          <div className="modal-form help-content">
            <h3>{t("Start learning")}</h3>
            <p>
              {t(
                "Open a course from Learning courses. SCORM courses save progress automatically so you can continue later.",
              ) + " "}
            </p>
            <h3>{t("Take an assessment")}</h3>
            <p>
              {t(
                "Find available exams in Exams & assessments. The timer keeps running once you start. Answers save automatically; view submitted results in Results & reviews.",
              ) + " "}
            </p>
            {user.role !== "learner" && (
              <>
                <h3>{t("Create content and invite participants")}</h3>
                <p>
                  {t(
                    "Write lessons in Authoring studio or use Scormly to create interactive SCORM courses. Guests can take exams through personal links, with a shared attempt budget for each identity.",
                  ) + " "}
                </p>
              </>
            )}
            <div className="notice">
              {t(
                "Contact your training administrator to change permissions, reset a password or adjust exam attempts.",
              ) + " "}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
