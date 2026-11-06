import { t, useLocale } from "./i18n";
import { useEffect, useState } from "react";
import {
  Users,
  BookOpen,
  GraduationCap,
  Target,
  ArrowUpRight,
  CalendarDays,
  ArrowRight,
  Clock3,
  CheckCheck,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";
import { api } from "./api";
import type { Dashboard as Data, Course, Exam, User } from "./types";
import {
  Spinner,
  ErrorBox,
  SectionTitle,
  LinkButton,
  Empty,
  Badge,
} from "./ui";
export default function Dashboard({
  user,
  courses,
  exams,
  go,
  refreshKey,
}: {
  user: User;
  courses: Course[];
  exams: Exam[];
  go: (p: string) => void;
  refreshKey: number;
}) {
  useLocale();
  const [data, setData] = useState<Data | null>(null),
    [days, setDays] = useState("30"),
    [department, setDepartment] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    api<Data>(
      `dashboard/?days=${days}&department=${encodeURIComponent(department)}`,
    )
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [days, department, refreshKey]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return <Spinner />;
  const audience = [
    { name: t("Employees"), value: data.employee_count },
    { name: t("Contractors"), value: data.contractor_count },
  ];
  const stats = [
    {
      label: t("Training participants"),
      value: data.people,
      suffix: t("people"),
      icon: Users,
      detail: t("Employees {v0} \u00B7 Contractors {v1}", {
        v0: data.employee_count,
        v1: data.contractor_count,
      }),
      color: "blue",
    },
    {
      label: t("Learning courses"),
      value: data.courses,
      suffix: t("courses"),
      icon: BookOpen,
      detail: t("{v0} total enrollments", { v0: data.enrollments }),
      color: "teal",
    },
    {
      label: t("Course completion"),
      value: data.completion,
      suffix: "%",
      icon: GraduationCap,
      detail: t("{v0} completed enrollments", { v0: data.completed }),
      color: "purple",
    },
    {
      label: t("Exam pass rate"),
      value: data.pass_rate,
      suffix: "%",
      icon: Target,
      detail: t("{v0} graded attempts in this period", {
        v0: data.graded_count,
      }),
      color: "amber",
    },
  ];
  const published = exams.filter((e) => e.published).slice(0, 3);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("WORKSPACE OVERVIEW")}</div>
          <h1>
            {t("Learning & development overview") + " "}
            <span className="heading-dot" />
          </h1>
          <p>
            {t("Follow your team's progress and recognize every step forward.")}
          </p>
        </div>
        <div className="heading-actions">
          <select
            aria-label={t("Filter by department")}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">{t("All departments")}</option>
            {Array.from(
              new Set(data.departments.map((d) => d.user__department)),
            )
              .filter(Boolean)
              .map((d) => (
                <option key={d}>{d}</option>
              ))}
            {department &&
              !data.departments.find(
                (d) => d.user__department === department,
              ) && <option>{department}</option>}
          </select>
          <div className="select-icon">
            <CalendarDays size={16} />
            <select
              aria-label={t("Reporting period")}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="7">{t("Last 7 days")}</option>
              <option value="30">{t("Last 30 days")}</option>
              <option value="90">{t("Last 90 days")}</option>
            </select>
          </div>
        </div>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="banner-label">
            <span />
            {" " + t("LEARNING NEVER STOPS")}
          </span>
          <h2>
            {user.display_name}
            {t(", let's help your team grow.")}
          </h2>
          <p>
            {data.pending
              ? t(
                  "{v0} attempts await grading. Help learners get timely feedback.",
                  { v0: data.pending },
                )
              : t("Small steps today create new possibilities tomorrow.")}
          </p>
          <button onClick={() => go(data.pending ? "/results" : "/courses")}>
            {data.pending ? t("Go to grading") : t("Explore courses")}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-grid" />
          <div className="art-card one">
            <BookOpen size={28} />
            <span>{t("KNOWLEDGE")}</span>
            <i />
          </div>
          <div className="art-card two">
            <GraduationCap size={30} />
            <span>{t("GROWTH")}</span>
            <i />
          </div>
          <div className="art-dot" />
        </div>
      </section>
      <div className="stats-grid">
        {stats.map((s) => (
          <section className="stat-card" key={s.label}>
            <div className="stat-top">
              <span>{s.label}</span>
              <div className={"stat-icon " + s.color}>
                <s.icon size={21} />
              </div>
            </div>
            <div className="stat-value">
              {s.value.toLocaleString()}
              <span>{s.suffix}</span>
            </div>
            <div className="stat-foot">
              <span className={"tiny-dot " + s.color} />
              {s.detail}
            </div>
          </section>
        ))}
      </div>
      <div className="dashboard-main">
        <section className="panel trend-panel">
          <SectionTitle
            title={t("Learning & assessment trends")}
            subtitle={t("Daily submissions and your team's learning activity")}
            action={
              <Badge tone="neutral">
                {t("Last") + " "}
                {data.days}
                {" " + t("days")}
              </Badge>
            }
          />
          <div className="chart-top">
            <span className="chart-key" />
            <span>{t("Graded attempts")}</span>
            <strong>
              {data.graded_count}
              <small>{" " + t("submissions")}</small>
            </strong>
          </div>
          <div className="chart-area">
            {data.trend.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={data.trend}
                  margin={{ left: -24, right: 12, top: 8, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="areaBlue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2787ed" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="#2787ed" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="4 5"
                    vertical={false}
                    stroke="#e8edf3"
                  />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v) => v.slice(5).replace("-", "/")}
                    tick={{ fontSize: 11, fill: "#8490a3" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={25}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "#8490a3" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    labelFormatter={(v) => String(v)}
                    contentStyle={{
                      border: "1px solid #e5eaf0",
                      borderRadius: 10,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name={t("Graded attempts")}
                    stroke="#2584e7"
                    strokeWidth={2.5}
                    fill="url(#areaBlue)"
                    dot={{ r: 3, fill: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title={t("No assessment records yet")}
                description={t(
                  "Trends appear here once learners submit exams and receive grades.",
                )}
              />
            )}
          </div>
          <div className="chart-footer">
            <CheckCheck size={16} />
            <span>{t("Based on actual submissions")}</span>
            <span>
              {t("Average score") + " "}
              <strong>{data.average_score}</strong>
              {" " + t("points") + " "}
            </span>
          </div>
        </section>
        <section className="panel audience-panel">
          <SectionTitle
            title={t("Training audience")}
            subtitle={t("Room to grow in every role")}
          />
          <div className="donut-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    data.people
                      ? audience
                      : [{ name: t("No people yet"), value: 1 }]
                  }
                  innerRadius={65}
                  outerRadius={83}
                  dataKey="value"
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={data.contractor_count ? 5 : 0}
                  stroke="none"
                >
                  <Cell fill={data.people ? "#267ee5" : "#e8edf3"} />
                  <Cell fill="#52bcae" />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="donut-label">
              <strong>{data.people}</strong>
              <span>{t("Total participants")}</span>
            </div>
          </div>
          {audience.map((a, i) => (
            <div className="audience-legend" key={a.name}>
              <i style={{ background: i ? "#52bcae" : "#267ee5" }} />
              <span>{a.name}</span>
              <strong>{a.value}</strong>
              <small>
                {data.people ? Math.round((a.value / data.people) * 100) : 0}%
              </small>
            </div>
          ))}
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <SectionTitle
            title={t("Department learning outcomes")}
            subtitle={t("Course completion by department")}
            action={
              <LinkButton onClick={() => go("/results")}>
                {t("Full report")}
              </LinkButton>
            }
          />
          <div className="department-list">
            {data.departments.length ? (
              data.departments.slice(0, 5).map((d, i) => (
                <div className="dept-row" key={d.user__department}>
                  <div className={"dept-icon tone-" + i}>
                    <Users size={16} />
                  </div>
                  <div className="dept-detail">
                    <div>
                      <span>
                        {d.user__department || t("No department assigned")}
                      </span>
                      <small>
                        {d.completed} / {d.total}
                        {" " + t("completed") + " "}
                      </small>
                    </div>
                    <div className="progress">
                      <i
                        style={{
                          width: (d.completed / d.total) * 100 + "%",
                          background: [
                            "#267ee5",
                            "#52bcae",
                            "#8b81cf",
                            "#e4ad58",
                          ][i % 4],
                        }}
                      />
                    </div>
                  </div>
                  <strong>
                    {Math.round((d.completed / d.total) * 100)}
                    <small>%</small>
                  </strong>
                </div>
              ))
            ) : (
              <Empty
                description={t(
                  "Department statistics appear after enrollment.",
                )}
              />
            )}
          </div>
        </section>
        <section className="panel">
          <SectionTitle
            title={t("Exams & assessments")}
            subtitle={t("Plan the next step and review learning outcomes")}
            action={
              <LinkButton onClick={() => go("/exams")}>
                {t("View all")}
              </LinkButton>
            }
          />
          {published.length ? (
            published.map((exam, i) => (
              <button
                className="upcoming-row"
                key={exam.id}
                onClick={() => go("/exams")}
              >
                <div className={"exam-number tone-" + i}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div>
                  <strong>{exam.title}</strong>
                  <span>
                    <Clock3 size={12} />
                    {exam.duration_minutes}
                    {" " + t("min") + " "}
                    <span className="inline-sep">·</span>
                    {t("up to")} {exam.max_attempts}
                    {" " + t("attempts") + " "}
                  </span>
                </div>
                <Badge tone={exam.course ? "teal" : "blue"}>
                  {exam.course ? t("Course assessment") : t("Standalone exam")}
                </Badge>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <Empty title={t("No exams available yet")} />
          )}
          <div className="panel-bottom-note">
            <Target size={15} />
            {" " +
              t("Courses and exams can be planned independently or combined.") +
              " "}
          </div>
        </section>
      </div>
      <section className="panel score-overview">
        <SectionTitle
          title={t("Score distribution")}
          subtitle={t("Score ranges for graded attempts")}
        />
        <div className="score-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.distribution.map((count, i) => ({
                name: [t("Below 60"), "60–69", "70–79", "80–89", "90–100"][i],
                count,
              }))}
            >
              <CartesianGrid strokeDasharray="4 5" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar
                dataKey="count"
                name={t("Attempts")}
                fill="#5e9de1"
                radius={[5, 5, 0, 0]}
                maxBarSize={75}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}
