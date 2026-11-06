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
    { name: "正式員工", value: data.employee_count },
    { name: "非正式員工", value: data.contractor_count },
  ];
  const stats = [
    {
      label: "培訓人員",
      value: data.people,
      suffix: "人",
      icon: Users,
      detail: `正式 ${data.employee_count} · 非正式 ${data.contractor_count}`,
      color: "blue",
    },
    {
      label: "學習課程",
      value: data.courses,
      suffix: "門",
      icon: BookOpen,
      detail: `累計 ${data.enrollments} 筆修課紀錄`,
      color: "teal",
    },
    {
      label: "課程完成率",
      value: data.completion,
      suffix: "%",
      icon: GraduationCap,
      detail: `${data.completed} 筆已完成學習`,
      color: "purple",
    },
    {
      label: "考試通過率",
      value: data.pass_rate,
      suffix: "%",
      icon: Target,
      detail: `期間內 ${data.graded_count} 份已評分考卷`,
      color: "amber",
    },
  ];
  const published = exams.filter((e) => e.published).slice(0, 3);
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">WORKSPACE OVERVIEW</div>
          <h1>
            人才發展總覽
            <span className="heading-dot" />
          </h1>
          <p>掌握團隊的學習進度，讓每一份努力都被看見。</p>
        </div>
        <div className="heading-actions">
          <select
            aria-label="部門篩選"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          >
            <option value="">所有部門</option>
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
              aria-label="統計期間"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="7">最近 7 天</option>
              <option value="30">最近 30 天</option>
              <option value="90">最近 90 天</option>
            </select>
          </div>
        </div>
      </div>
      <section className="welcome-banner">
        <div>
          <span className="banner-label">
            <span /> LEARNING NEVER STOPS
          </span>
          <h2>{user.display_name}，一起讓團隊持續成長。</h2>
          <p>
            {data.pending
              ? `目前有 ${data.pending} 份考卷等待評分，幫助學員更快獲得回饋。`
              : "從今天的一小步，累積明天的更多可能。"}
          </p>
          <button onClick={() => go(data.pending ? "/results" : "/courses")}>
            {data.pending ? "前往評分中心" : "探索學習課程"}
            <ArrowRight size={16} />
          </button>
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="art-grid" />
          <div className="art-card one">
            <BookOpen size={28} />
            <span>KNOWLEDGE</span>
            <i />
          </div>
          <div className="art-card two">
            <GraduationCap size={30} />
            <span>GROWTH</span>
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
            title="學習與評量趨勢"
            subtitle="觀察每日交卷量與團隊學習節奏"
            action={<Badge tone="neutral">近 {data.days} 天</Badge>}
          />
          <div className="chart-top">
            <span className="chart-key" />
            <span>已評分考卷</span>
            <strong>
              {data.graded_count}
              <small> 份</small>
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
                    name="已評分考卷"
                    stroke="#2584e7"
                    strokeWidth={2.5}
                    fill="url(#areaBlue)"
                    dot={{ r: 3, fill: "#fff", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <Empty
                title="尚無評量紀錄"
                description="學員交卷並完成評分後，趨勢將顯示於此。"
              />
            )}
          </div>
          <div className="chart-footer">
            <CheckCheck size={16} />
            <span>依實際交卷紀錄統計</span>
            <span>
              平均分數 <strong>{data.average_score}</strong> 分
            </span>
          </div>
        </section>
        <section className="panel audience-panel">
          <SectionTitle title="培訓對象" subtitle="讓不同角色，都能持續成長" />
          <div className="donut-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={
                    data.people ? audience : [{ name: "尚無人員", value: 1 }]
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
              <span>培訓總人數</span>
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
            title="部門學習成效"
            subtitle="各部門課程完成率"
            action={
              <LinkButton onClick={() => go("/results")}>完整報表</LinkButton>
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
                      <span>{d.user__department || "未分配部門"}</span>
                      <small>
                        {d.completed} / {d.total} 筆完成
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
              <Empty description="修課後會出現部門統計。" />
            )}
          </div>
        </section>
        <section className="panel">
          <SectionTitle
            title="考試與評量"
            subtitle="安排下一步，檢視學習成果"
            action={
              <LinkButton onClick={() => go("/exams")}>查看全部</LinkButton>
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
                    {exam.duration_minutes} 分鐘
                    <span className="inline-sep">·</span>最多{" "}
                    {exam.max_attempts} 次
                  </span>
                </div>
                <Badge tone={exam.course ? "teal" : "blue"}>
                  {exam.course ? "課程評量" : "獨立考試"}
                </Badge>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <Empty title="尚無已開放考試" />
          )}
          <div className="panel-bottom-note">
            <Target size={15} /> 課程與考試可獨立規劃，依需求彈性組合。
          </div>
        </section>
      </div>
      <section className="panel score-overview">
        <SectionTitle title="分數分布" subtitle="已評分考卷的成績區間" />
        <div className="score-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data.distribution.map((count, i) => ({
                name: ["未滿 60", "60–69", "70–79", "80–89", "90–100"][i],
                count,
              }))}
            >
              <CartesianGrid strokeDasharray="4 5" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={false} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} />
              <Tooltip />
              <Bar
                dataKey="count"
                name="考卷數"
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
