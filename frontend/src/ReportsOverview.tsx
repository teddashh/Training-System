import { hasManagementAccess } from "./access";
import { countLabel, attemptCount, t, useLocale } from "./i18n";
import { useEffect, useState } from "react";
import {
  Users,
  BookOpen,
  GraduationCap,
  Target,
  ArrowUpRight,
  CalendarDays,
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
import type { Dashboard as Data, Exam, User } from "./types";
import {
  Spinner,
  ErrorBox,
  SectionTitle,
  LinkButton,
  Empty,
  Badge,
} from "./ui";
export default function ReportsOverview({user, exams, go, refreshKey}: {
  user: User; exams: Exam[]; go: (path: string) => void; refreshKey: number;
}) {
  useLocale();
  const management = hasManagementAccess(user.access);
  const [data, setData] = useState<Data | null>(null),
    [days, setDays] = useState("30"),
    [department, setDepartment] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    if (!management) return;
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
  }, [days, department, refreshKey, management]);
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
      label: t("Courses"),
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

          <h1>
            {t("Training overview") + " "}
            <span className="heading-dot" />
          </h1>

        </div>
        <div className="heading-actions">
          {management && <select
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
          </select>}
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
      <div className={`dashboard-main${management ? "" : " personal-overview"}`}>
        <section className="panel trend-panel">
          <SectionTitle
            title={t("Learning & assessment trends")}

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
              <small>{" " + t(!management && data.graded_count === 1 ? "submission" : "submissions")}</small>
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
                      <stop offset="0%" stopColor="var(--brand-blue)" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="var(--brand-blue)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="4 5"
                    vertical={false}
                    stroke="var(--stroke-subtle)"
                  />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v) => v.slice(5).replace("-", "/")}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={25}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    labelFormatter={(v) => String(v)}
                    contentStyle={{
                      border: "1px solid var(--stroke-subtle)",
                      borderRadius: 10,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    name={t("Graded attempts")}
                    stroke="var(--brand-blue)"
                    strokeWidth={2.5}
                    fill="url(#areaBlue)"
                    dot={{ r: 3, fill: "var(--surface)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title={t("No assessment records yet")}

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
        {management && <section className="panel audience-panel">
          <SectionTitle
            title={t("Training audience")}

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
                  <Cell fill={data.people ? "var(--brand-blue)" : "var(--stroke-subtle)"} />
                  <Cell fill="var(--brand-green-accent)" />
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
              <i style={{ background: i ? "var(--brand-green-accent)" : "var(--brand-blue)" }} />
              <span>{a.name}</span>
              <strong>{a.value}</strong>
              <small>
                {data.people ? Math.round((a.value / data.people) * 100) : 0}%
              </small>
            </div>
          ))}
        </section>}
      </div>
      <div className={`dashboard-bottom${management ? "" : " personal-overview"}`}>
        {management && <section className="panel">
          <SectionTitle
            title={t("Department learning outcomes")}

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
                            "var(--brand-blue)",
                            "var(--brand-green-accent)",
                            "var(--brand-burgundy)",
                            "var(--brand-brown-accent)",
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
        </section>}
        <section className="panel">
          <SectionTitle
            title={t("Exams")}

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
                    {countLabel(exam.duration_minutes, "{count} minute", "{count} minutes")}
                    <span className="inline-sep">·</span>
                    {t("up to")} {attemptCount(exam.max_attempts)}
                  </span>
                </div>
                <Badge tone={exam.courses.length ? "teal" : "blue"}>
                  {exam.courses.length ? t("Course assessment") : t("Standalone exam")}
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
                fill="var(--brand-pink)"
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
