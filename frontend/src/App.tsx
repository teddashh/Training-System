import { brand, signIn, applySessionSettings, type SessionSettings } from "./brand";
import { navigationAreas, activeArea, canOpenRoute } from "./navigation";
import AreaTabs from "./AreaTabs";
import LazyPageBoundary from "./LazyPageBoundary";
import { AccessContext, CurrentUserContext, roleLabel } from "./access";
import Brand from "./Brand";
import { t, useLocale, LanguagePicker, setInterfaceLanguages } from "./i18n";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  LayoutDashboard,
  ClipboardCheck,
  Layers3,
  BarChart3,
  Users,
  Settings as SettingsIcon,
  Search,
  HelpCircle,
  Menu,
  LogOut,
  ChevronRight,
  ArrowUpRight,
  RefreshCw,
  GraduationCap,
} from "lucide-react";
import { api } from "./api";
import { appPath, routePath } from "./paths";
import type { Course, Exam, User } from "./types";
import Login from "./Login";
import Registration from "./Registration";
import { parseRegistrationReturn, completeRegistration } from "./registration";

import Courses from "./Courses";
import Exams from "./Exams";
import MyTraining from "./MyTraining";
import MyExams from "./MyExams";
import Attempt, { GuestExam } from "./Attempt";
import { Invitations, People, Results, Settings } from "./Management";
import { Modal, ErrorBox, Spinner } from "./ui";
import Assignments from "./Assignments";
import QuestionBank from "./QuestionBank";

import { PasswordDialog } from "./PeopleTools";
import NewTraining from "./NewTraining";
import TrainingPage from "./TrainingPage";
const ReportsOverview = lazy(() => import("./ReportsOverview"));
const Dashboard = lazy(() => import("./Dashboard"));
const Insights = lazy(() => import("./Insights"));
const Administration = lazy(() => import("./Administration"));
const Email = lazy(() => import("./Email"));

export default function App() {
  useLocale();
  const [user, setUser] = useState<User | null>(null),
    [ready, setReady] = useState(false),
    [entra, setEntra] = useState(false),
    [demo, setDemo] = useState(false),
    [path, setPath] = useState(routePath()),
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
  const [registrationResult, setRegistrationResult] = useState<{course: string; message: string} | null>(null);
  const [registrationBusy, setRegistrationBusy] = useState(false);
  const go = useCallback((next: string, replace = false) => {
    if (replace) history.replaceState({}, "", appPath(next));
    else history.pushState({}, "", appPath(next));
    setPath(new URL(next, window.location.origin).pathname);
    setMobile(false);
    setQuery("");
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const params = new URLSearchParams(window.location.search);
    try {
      if (!user) {
        const kind = path === "/courses" ? "course" : path === "/exams" ? "exam" : null;
        const id = kind ? params.get(kind) : null;
        if (kind && id && /^[1-9]\d*$/.test(id)) {
          sessionStorage.setItem("training-registration", JSON.stringify({
            kind, id, register: kind === "course" && params.get("action") === "register", time: Date.now(),
          }));
        }
      } else {
        // Email verification on the public page completes locally.
        if (path === "/register") return;
        const raw = sessionStorage.getItem("training-registration");
        sessionStorage.removeItem("training-registration");
        const target = parseRegistrationReturn(raw);
        if (target?.choice) {
          setRegistrationBusy(true);
          void completeRegistration(Number(target.id), target.session).then(message => {
            setRegistrationResult({course: target.id, message});
            go(`/courses?course=${target.id}&action=register`);
          }).catch(error => {
            setRegistrationResult({course: target.id, message: error.message});
            go(`/courses?course=${target.id}&action=register`);
          }).finally(() => {
            // The picker must use availability fetched after the admission attempt.
            setCourses([]); setExams([]); setLoading(true);
            setRefreshKey(value => value + 1); setRegistrationBusy(false);
          });
        } else if (target?.kind === "course") {
          go(`/courses?course=${target.id}${target.register ? "&action=register" : ""}`);
        } else if (target?.kind === "exam") {
          go(`/exams?exam=${target.id}`);
        }
      }
    } catch { /* Storage can be disabled; the signed-in catalog remains available. */ }
  }, [ready,user,path,go]);
  const refresh = useCallback(() => setRefreshKey((v) => v + 1), []);
  useEffect(() => {
    const pop = () => setPath(routePath());
    window.addEventListener("popstate", pop);
    const refreshSession = () => api<SessionSettings & {
      user: User | null;
      entra_enabled: boolean;
      demo_mode?: boolean;
      languages: string[];
    }>("auth/session/")
      .then((s) => {
        applySessionSettings(s);
        setInterfaceLanguages(s.languages);
        setUser(s.user);
        setEntra(s.entra_enabled);
        setDemo(!!s.demo_mode);
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        setReady(true);
      });
    void refreshSession();
    window.addEventListener('training-settings', refreshSession);
    return () => { window.removeEventListener("popstate", pop); window.removeEventListener('training-settings', refreshSession); };
  }, []);
  useEffect(() => {
    if (!user || path === "/register" || path.startsWith("/attempt/") || path.startsWith("/preview/"))
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
  if (registrationBusy) return <Spinner />;
  if (path === "/register") return <Registration user={user} entra={entra} onLogin={setUser} />;
  if (path === "/invite") return <GuestExam go={go} />;
  if (path.startsWith("/attempt/"))
    return <Attempt key={path} id={path.split("/")[2]} go={go} guest={!user} />;
  if (!user)
    return (
      <Login
        entra={entra}
        onLogin={(u) => {
          setUser(u);
          go(path === "/manage" && u.access.system_admin ? "/manage" : "/");
        }}
      />
    );
  if (path.startsWith("/preview/"))
    return <Attempt key={path} id={path.split("/")[2]} go={go} preview />;
  const nav = navigationAreas(user.access);
  // New training and training pages live under the Trainings tab and share its capability.
  const trainingRoute = /^\/authoring\/(new|[1-9]\d*)$/.test(path);
  const route = trainingRoute ? "/authoring" : path;
  const current = activeArea(user.access, route, window.location.search);
  const allowed = canOpenRoute(user.access, route);
  const icons = {home: LayoutDashboard, learning: GraduationCap, training: Layers3, exams: ClipboardCheck, reports: BarChart3, people: Users, settings: SettingsIcon};
  const matches = [
    ...courses
      .filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
      .map((c) => ({
        id: "c" + c.id,
        title: c.title,
        type: t("Courses"),
        path: c.published ? `/courses?course=${c.id}` : `/authoring?course=${c.id}&action=edit`,
      })),
    ...exams
      .filter((e) => [e.title, ...e.course_links.map(c => c.title)].some(title => title.toLowerCase().includes(query.toLowerCase())))
      .map((e) => ({
        id: "e" + e.id,
        title: e.title,
        type: t("Assessment"),
        path: `/exams?exam=${e.id}${e.published ? "" : "&action=edit"}`,
      })),
  ].slice(0, 8);
  return (
    <AccessContext.Provider value={user.access}><CurrentUserContext.Provider value={user}>
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
          href={appPath("/")}
          onClick={(e) => {
            e.preventDefault();
            go("/");
          }}
        >
          <Brand />
          {brand.customized && <span className="organization-name">{brand.organization}</span>}
        </a>
        <nav aria-label={t("Main navigation")}>
          {nav.map(area => { const Icon = icons[area.id]; return <a key={area.id}
            href={appPath(area.tabs[0].path)} className={current?.id === area.id ? "active" : ""}
            aria-current={current?.id === area.id ? "page" : undefined}
            onClick={e => {e.preventDefault(); go(area.tabs[0].path);}}>
            <Icon size={19}/><span>{t(area.label)}</span>
          </a>; })}
        </nav>
        <div className="sidebar-bottom">
          <button className="sidebar-help" onClick={() => setHelp(true)}>
            <HelpCircle size={17} />
            {t("Help & support") + " "}
            <ArrowUpRight size={14} />
          </button>
          {demo && <div className="sidebar-version">{t("Demo environment · Synthetic data")}</div>}
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
                    {roleLabel(user.role)}
                  </span>
                </div>
                <ChevronRight size={14} />
              </button>
              {profile && (
                <div className="profile-menu">
                  <strong>{user.email || user.username}</strong>
                  <span>{user.department || t("No department assigned")}</span>
                  {signIn.password && (
                    <button
                      onClick={() => {
                        setProfile(false);
                        setPassword(true);
                      }}
                    >
                      {t("Change password")}
                    </button>
                  )}
                  <button onClick={signOut}>
                    <LogOut size={15} />
                    {t("Sign out") + " "}
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main-content" className={["/manage", "/people", "/settings", "/email"].includes(path) ? "management-surface" : undefined}>
          {current && <AreaTabs area={current} go={go}/>}
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
            ) : path === "/manage" ? (
              <LazyPageBoundary key={path}><Administration go={go} /></LazyPageBoundary>
            ) : path === "/" ? (
              <LazyPageBoundary key={path}><Dashboard
                user={user}
                courses={courses}
                exams={exams}
                go={go}
                refreshKey={refreshKey}
              /></LazyPageBoundary>
            ) : path === "/reports" ? (
              <LazyPageBoundary key={path}><ReportsOverview user={user} exams={exams} go={go} refreshKey={refreshKey}/></LazyPageBoundary>
            ) : path === "/my-training" ? (
              <MyTraining refreshKey={refreshKey} onSaved={refresh} go={go}/>
            ) : path === "/my-exams" ? (
              <MyExams exams={exams}/>
            ) : path === "/courses" ? (
              <Courses registrationMessage={registrationResult?.course === new URLSearchParams(window.location.search).get('course') ? t(registrationResult.message) : undefined} key={"courses" + window.location.search} courses={courses} exams={exams} user={user} onSaved={refresh} go={go} />
            ) : path === "/assignments" ? (
              <Assignments
                key={"assignments" + window.location.search}
                user={user}
                courses={courses}
                exams={exams}
                go={go}
                onSaved={refresh}
              />
            ) : path === "/question-bank" ? (
              <QuestionBank />
            ) : path === "/insights" ? (
              <LazyPageBoundary key={path}><Insights exams={exams} /></LazyPageBoundary>
            ) : path === "/authoring" ? (
              <Courses key={"authoring" + window.location.search} courses={courses} exams={exams} user={user} onSaved={refresh} go={go} studio />
            ) : path === "/authoring/new" ? (
              <NewTraining go={go} />
            ) : trainingRoute ? (
              <TrainingPage key={path} id={Number(path.split("/")[2])} go={go} onSaved={refresh} />
            ) : path === "/exams" ? (
              <Exams key={"exams" + window.location.search}
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
              <People currentUser={user} />
            ) : path === "/email" ? (
              <LazyPageBoundary key={path}><Email /></LazyPageBoundary>
            ) : (
              <Settings user={user} go={go} />
            )}
            <footer className="app-footer">
              <span>
                © {new Date().getFullYear()} {brand.organization}

              </span>
            </footer>
          </Suspense>
        </main>
      </div>
      {password && <PasswordDialog onClose={() => setPassword(false)} />}
      {help && (
        <Modal
          title={t("Welcome to {organization}", { organization: brand.organization })}
          onClose={() => setHelp(false)}
        >
          <div className="modal-form help-content">
            <h3>{t("Start learning")}</h3>
            <p>
              {t(
                "Open a course to start or continue learning.",
              ) + " "}
            </p>
            <h3>{t("Take an assessment")}</h3>
            <p>
              {t(
                "Find available exams in Exams. The timer keeps running once you start. Answers save automatically; view submitted results in Results.",
              ) + " "}
            </p>
            {(user.access.courses !== "none" || user.access.invitations) && (
              <>
                <h3>{t("Create content and invite participants")}</h3>
                <p>
                  {t(
                    "Create a course, edit its content, then publish. Send personal exam links to guests.",
                  ) + " "}
                </p>
              </>
            )}
            <div className="notice">
              {t(signIn.password
                ? "Contact your training administrator to change permissions, reset a password or adjust exam attempts."
                : "Contact your training administrator to change permissions or adjust exam attempts.") + " "}
            </div>
          </div>
        </Modal>
      )}
    </div>
    </CurrentUserContext.Provider></AccessContext.Provider>
  );
}
