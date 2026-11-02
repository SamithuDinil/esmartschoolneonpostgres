"use client";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarRange,
  Download,
  FileSpreadsheet,
  Filter,
  Printer,
  TrendingUp,
} from "lucide-react";

type Group = { label: string; count?: number; average?: number; total?: number };
type Analytics = {
  filters: { from: string; to: string; grade: string; className: string };
  academic: {
    examinationCount: number;
    averagePerformance: number;
    byGrade: Group[];
    bySubject: Group[];
    historical: Group[];
  };
  attendance: {
    records: number;
    present: number;
    absent: number;
    percentage: number;
    daily: Group[];
    byGrade: Group[];
    byClass: Group[];
  };
  finance: {
    invoiceCount: number;
    collected: number;
    outstanding: number;
    payments: number;
    expenses: number;
    monthlyCollections: Group[];
    expenseCategories: Group[];
  };
  administrative: {
    enrollment: number;
    newAdmissions: number;
    transfers: number;
    teachers: number;
    staffAttendance: number;
    libraryUsage: number;
    inventoryAssets: number;
    inventoryUnits: number;
  };
};
const empty: Analytics = {
  filters: { from: "", to: "", grade: "", className: "" },
  academic: {
    examinationCount: 0,
    averagePerformance: 0,
    byGrade: [],
    bySubject: [],
    historical: [],
  },
  attendance: {
    records: 0,
    present: 0,
    absent: 0,
    percentage: 0,
    daily: [],
    byGrade: [],
    byClass: [],
  },
  finance: {
    invoiceCount: 0,
    collected: 0,
    outstanding: 0,
    payments: 0,
    expenses: 0,
    monthlyCollections: [],
    expenseCategories: [],
  },
  administrative: {
    enrollment: 0,
    newAdmissions: 0,
    transfers: 0,
    teachers: 0,
    staffAttendance: 0,
    libraryUsage: 0,
    inventoryAssets: 0,
    inventoryUnits: 0,
  },
};
function money(value: number) {
  return `LKR ${Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}
function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
function rowsFor(data: Analytics, section: string): Record<string, unknown>[] {
  if (section === "academic")
    return data.academic.bySubject.map((row) => ({
      subject: row.label,
      average: row.average,
      examinations: row.count,
    }));
  if (section === "attendance")
    return data.attendance.daily.map((row) => ({ date: row.label, records: row.count }));
  if (section === "finance")
    return [
      ...data.finance.monthlyCollections.map((row) => ({
        month: row.label,
        collections: row.total,
      })),
      ...data.finance.expenseCategories.map((row) => ({
        category: row.label,
        expenses: row.total,
      })),
    ];
  return [
    { metric: "Enrollment", value: data.administrative.enrollment },
    { metric: "New admissions", value: data.administrative.newAdmissions },
    { metric: "Transfers", value: data.administrative.transfers },
    { metric: "Teachers", value: data.administrative.teachers },
    { metric: "Library usage", value: data.administrative.libraryUsage },
    { metric: "Inventory units", value: data.administrative.inventoryUnits },
  ];
}
function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function downloadExcel(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const html = `<table><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr>${rows
    .map(
      (row) =>
        `<tr>${headers
          .map(
            (header) =>
              `<td>${String(row[header] ?? "")
                .replaceAll("&", "&amp;")
                .replaceAll("<", "&lt;")}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("")}</table>`;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([`<html><body>${html}</body></html>`], { type: "application/vnd.ms-excel" }),
  );
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function GroupTable({ rows }: { rows: Group[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Segment</th>
            <th>Value</th>
            <th>Records</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 12).map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>
                {row.average != null
                  ? row.average
                  : row.total != null
                    ? row.total.toLocaleString()
                    : row.count}
              </td>
              <td>{row.count ?? "—"}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={3}>No records match these filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function AnalyticsPanel() {
  const [data, setData] = useState<Analytics>(empty);
  const [section, setSection] = useState<"academic" | "attendance" | "finance" | "administrative">(
    "academic",
  );
  const [filters, setFilters] = useState({ from: "", to: "", grade: "", className: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setError("");
    try {
      const query = new URLSearchParams(
        Object.entries(filters).filter(([, value]) => Boolean(value)) as string[][],
      );
      const response = await fetch(`/api/analytics?${query.toString()}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Analytics could not be loaded.");
      setData(body as Analytics);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analytics could not be loaded.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => rowsFor(data, section), [data, section]);
  const filterNote =
    [
      filters.from && `from ${filters.from}`,
      filters.to && `to ${filters.to}`,
      filters.grade && filters.grade,
      filters.className && `class ${filters.className}`,
    ]
      .filter(Boolean)
      .join(" · ") || "All available school records";
  const metricCards =
    section === "academic"
      ? [
          ["Published examinations", data.academic.examinationCount],
          ["Average performance", `${data.academic.averagePerformance}%`],
          ["Subject groups", data.academic.bySubject.length],
          ["Historical periods", data.academic.historical.length],
        ]
      : section === "attendance"
        ? [
            ["Attendance rate", `${data.attendance.percentage}%`],
            ["Present / late", data.attendance.present],
            ["Absences", data.attendance.absent],
            ["Attendance records", data.attendance.records],
          ]
        : section === "finance"
          ? [
              ["Collected", money(data.finance.collected)],
              ["Outstanding", money(data.finance.outstanding)],
              ["Payments", data.finance.payments],
              ["Approved expenses", money(data.finance.expenses)],
            ]
          : [
              ["Enrollment", data.administrative.enrollment],
              ["New admissions", data.administrative.newAdmissions],
              ["Teachers", data.administrative.teachers],
              ["Inventory units", data.administrative.inventoryUnits],
            ];
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Module 28 · Reporting and analytics</div>
          <h1>School analytics</h1>
          <p>Real database information, visible filters and exportable evidence.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn-secondary"
            onClick={() => downloadCsv(`edusphere-${section}.csv`, rows)}
          >
            <Download size={13} />
            CSV
          </button>
          <button
            className="btn-secondary"
            onClick={() => downloadExcel(`edusphere-${section}.xls`, rows)}
          >
            <FileSpreadsheet size={13} />
            Excel
          </button>
          <button className="btn-secondary" onClick={() => window.print()}>
            <Printer size={13} />
            Print / PDF
          </button>
        </div>
      </div>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel analytics-filters">
        <div className="panel-header">
          <div>
            <div className="panel-title">Filter the evidence</div>
            <div className="panel-subtitle">
              Every card and export uses the same date, grade and class filters.
            </div>
          </div>
          <Filter size={16} color="#315ee8" />
        </div>
        <div className="form-grid">
          <label className="field">
            <span>From</span>
            <input
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </label>
          <label className="field">
            <span>To</span>
            <input
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Grade</span>
            <input
              value={filters.grade}
              onChange={(event) => setFilters({ ...filters, grade: event.target.value })}
              placeholder="Grade 8"
            />
          </label>
          <label className="field">
            <span>Class</span>
            <input
              value={filters.className}
              onChange={(event) => setFilters({ ...filters, className: event.target.value })}
              placeholder="A"
            />
          </label>
          <div className="form-actions">
            <button className="btn-primary" onClick={() => void load()} disabled={busy}>
              <TrendingUp size={13} />
              {busy ? "Refreshing…" : "Refresh analytics"}
            </button>
          </div>
        </div>
        <div className="analytics-filter-ribbon">
          <CalendarRange size={13} />
          {filterNote}
        </div>
      </section>
      <div className="module-tabs">
        {(["academic", "attendance", "finance", "administrative"] as const).map((item) => (
          <button
            key={item}
            className={section === item ? "btn-primary" : "btn-secondary"}
            onClick={() => setSection(item)}
          >
            {item[0].toUpperCase() + item.slice(1)}
          </button>
        ))}
      </div>
      <section className="stat-grid analytics-metrics">
        {metricCards.map(([label, value]) => (
          <article className="stat-card" key={String(label)}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon">
                <BarChart3 size={14} />
              </span>
            </div>
            <div className="stat-value">{String(value)}</div>
            <div className="stat-note">Calculated from current authorized records</div>
          </article>
        ))}
      </section>
      <section className="content-grid analytics-content">
        <article className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">
                {section[0].toUpperCase() + section.slice(1)} breakdown
              </div>
              <div className="panel-subtitle">Grouped values available for export.</div>
            </div>
          </div>
          <GroupTable
            rows={
              section === "academic"
                ? data.academic.bySubject
                : section === "attendance"
                  ? data.attendance.daily
                  : section === "finance"
                    ? data.finance.monthlyCollections
                    : [
                        { label: "Enrollment", count: data.administrative.enrollment },
                        { label: "Admissions", count: data.administrative.newAdmissions },
                        { label: "Transfers", count: data.administrative.transfers },
                        { label: "Teachers", count: data.administrative.teachers },
                        { label: "Library usage", count: data.administrative.libraryUsage },
                        { label: "Inventory assets", count: data.administrative.inventoryAssets },
                      ]
            }
          />
        </article>
        <article className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Supporting view</div>
              <div className="panel-subtitle">A second lens for the same filter ribbon.</div>
            </div>
          </div>
          {section === "academic" && <GroupTable rows={data.academic.byGrade} />}
          {section === "attendance" && <GroupTable rows={data.attendance.byClass} />}
          {section === "finance" && <GroupTable rows={data.finance.expenseCategories} />}
          {section === "administrative" && (
            <div className="report-list">
              <div>
                <strong>{data.administrative.staffAttendance}</strong>
                <span>Staff attendance records</span>
              </div>
              <div>
                <strong>{data.administrative.libraryUsage}</strong>
                <span>Library loans</span>
              </div>
              <div>
                <strong>{data.administrative.inventoryAssets}</strong>
                <span>Inventory assets</span>
              </div>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
