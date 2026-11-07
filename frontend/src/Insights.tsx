import { useEffect, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Users,
} from "lucide-react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "./api";
import { t, useLocale } from "./i18n";
import { Badge, Empty, ErrorBox, Spinner } from "./ui";
import type { Exam, ExamInsights } from "./types";

export default function Insights({ exams }: { exams: Exam[] }) {
  useLocale();
  const managed = exams.filter((exam) => exam.can_manage);
  const [selected, setSelected] = useState(
    new URLSearchParams(window.location.search).get("exam") || "",
  );
  const [days, setDays] = useState("90"),
    [data, setData] = useState<ExamInsights | null>(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [questionSearch, setQuestionSearch] = useState("");
  useEffect(() => {
    if (!selected && managed.length) setSelected(String(managed[0].id));
  }, [exams, selected]);
  useEffect(() => {
    if (!selected) return;
    let alive = true;
    setLoading(true);
    setError("");
    api<ExamInsights>(`exams/${selected}/insights/?days=${days}`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e) => {
        if (alive) {
          setError(e.message);
          setData(null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selected, days]);
  const stats = data?.summary;
  const questions =
    data?.questions.filter((q) =>
      q.description.toLowerCase().includes(questionSearch.toLowerCase()),
    ) || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{t("ASSESSMENT INTELLIGENCE")}</div>
          <h1>{t("Assessment insights")}</h1>
          <p>
            {t(
              "Find learning gaps and review question performance using actual assessment evidence.",
            )}
          </p>
        </div>
        {selected && (
          <a
            className="btn"
            href={`/api/exams/${selected}/insights/?days=${days}&export=csv`}
          >
            <Download size={17} />
            {t("Export question analysis")}
          </a>
        )}
      </div>
      <div className="report-filters insights-filters">
        <label>
          {t("Assessment")}
          <select
            aria-label={t("Select assessment")}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setQuestionSearch("");
            }}
          >
            <option value="" disabled>
              {t("Select assessment")}
            </option>
            {managed.map((exam) => (
              <option key={exam.id} value={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Reporting period")}
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="all">{t("All time")}</option>
            {[7, 30, 90, 365].map((value) => (
              <option key={value} value={value}>
                {t("Last {days} days", { days: value })}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ErrorBox message={error} />
      {loading ? (
        <Spinner />
      ) : data && stats ? (
        <>
          <div className="assignment-metrics">
            {[
              {
                label: t("Graded attempts"),
                value: stats.graded,
                icon: ClipboardCheck,
                tone: "blue",
              },
              {
                label: t("Participants"),
                value: stats.participants,
                icon: Users,
                tone: "purple",
              },
              {
                label: t("Average score"),
                value: stats.average_score ?? "—",
                icon: BarChart3,
                tone: "teal",
              },
              {
                label: t("Attempt pass rate"),
                value: stats.pass_rate === null ? "—" : stats.pass_rate + "%",
                icon: CheckCircle2,
                tone: "teal",
              },
            ].map((item) => (
              <section
                className={"panel assignment-metric " + item.tone}
                key={item.label}
              >
                <item.icon size={23} />
                <div>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              </section>
            ))}
          </div>
          <div className="insight-context">
            <strong>{data.exam.title}</strong>
            <Badge tone="amber">
              {t("{count} awaiting review", { count: stats.pending })}
            </Badge>
            <Badge tone="blue">
              {t("{count} in progress", { count: stats.in_progress })}
            </Badge>
          </div>
          <div className="insight-charts">
            <section className="panel insight-panel">
              <h2>{t("Score distribution")}</h2>
              <p>{t("Graded attempts by score band")}</p>
              {stats.graded ? (
                <div
                  className="insight-chart"
                  role="img"
                  aria-label={
                    t("Score distribution") +
                    ": " +
                    data.distribution
                      .map((row) => row.band + ": " + row.count)
                      .join(", ")
                  }
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.distribution}
                      margin={{ left: -20, right: 12, top: 12, bottom: 4 }}
                    >
                      <CartesianGrid vertical={false} stroke="#eaf0f6" />
                      <XAxis
                        dataKey="band"
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <YAxis
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        fontSize={12}
                      />
                      <Tooltip cursor={{ fill: "#f1f7ff" }} />
                      <Bar
                        dataKey="count"
                        name={t("Graded attempts")}
                        fill="#2483df"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={52}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <Empty
                  title={t("No graded attempts yet")}
                  description={t(
                    "Completed grading will populate the score and question analysis.",
                  )}
                />
              )}
            </section>
            <section className="panel insight-panel">
              <h2>{t("Department performance")}</h2>
              <p>{t("Attempt pass rate within each department")}</p>
              <div className="insight-departments">
                {data.departments.map((row, index) => (
                  <div
                    className="insight-department"
                    key={row.department ?? "external"}
                  >
                    <div>
                      <strong>
                        {row.department === null
                          ? t("External participant")
                          : row.department || t("No department assigned")}
                      </strong>
                      <span>
                        {row.graded
                          ? Math.round((row.passed / row.graded) * 100) + "%"
                          : "—"}
                      </span>
                    </div>
                    <div className="insight-progress">
                      <span
                        style={{
                          width: `${row.graded ? (row.passed / row.graded) * 100 : 0}%`,
                          background: index % 2 ? "#2aa99a" : "#2581da",
                        }}
                      />
                    </div>
                    <small>
                      {t("{graded} graded · {total} total attempts", {
                        graded: row.graded,
                        total: row.attempts,
                      })}{" "}
                      · {t("Average score")}: {row.average ?? "—"}
                    </small>
                  </div>
                ))}
                {!data.departments.length && (
                  <Empty title={t("No matching assessment records")} />
                )}
              </div>
            </section>
          </div>
          <div className="toolbar">
            <div>
              <h2>{t("Question performance")}</h2>
              <p className="muted">
                {t("Sorted by full-credit rate, lowest first")}
              </p>
            </div>
            <input
              className="insight-search"
              aria-label={t("Search question analysis")}
              placeholder={t("Search question analysis")}
              value={questionSearch}
              onChange={(e) => setQuestionSearch(e.target.value)}
            />
          </div>
          <p className="notice">
            {t(
              "Each saved question version is analyzed separately. Shuffled options are normalized; sampled questions count only when presented. Repeated attempts count separately. Only fully graded attempts contribute to score and question statistics.",
            )}
          </p>
          <div className="panel table-panel insight-question-table">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t("Question")}</th>
                    <th>{t("Graded responses")}</th>
                    <th>{t("Answer rate")}</th>
                    <th>{t("Full-credit rate")}</th>
                    <th>{t("Average points")}</th>
                  </tr>
                </thead>
                <tbody>
                  {questions.map((q) => (
                    <tr key={q.variant}>
                      <td className="bank-description">
                        <strong>{q.description}</strong>
                        <small className="cell-note">
                          {
                            {
                              single: t("Single choice"),
                              multiple: t("Multiple choice"),
                              short: t("Short answer"),
                              essay: t("Written response"),
                            }[q.type]
                          }{" "}
                          · {t("Question version")} {q.question_id} ·{" "}
                          {q.variant.slice(0, 6)}
                        </small>
                      </td>
                      <td>{q.responses}</td>
                      <td>{q.answer_rate}%</td>
                      <td>
                        <Badge
                          tone={
                            q.full_credit_rate >= 80
                              ? "teal"
                              : q.full_credit_rate >= 60
                                ? "blue"
                                : "amber"
                          }
                        >
                          {q.full_credit_rate}%
                        </Badge>
                        <small className="cell-note">
                          {q.full_credit} / {q.responses}
                        </small>
                      </td>
                      <td>
                        {q.average_points} / {q.points}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!questions.length && (
              <Empty
                title={t("No question analysis to show")}
                description={t(
                  "Completed grading will populate the score and question analysis.",
                )}
              />
            )}
          </div>
        </>
      ) : (
        !error && (
          <Empty
            title={t("Select an assessment to view its insights")}
            description={t(
              "Instructors can analyze their own assessments. Administrators can analyze all assessments.",
            )}
          />
        )
      )}
    </>
  );
}
