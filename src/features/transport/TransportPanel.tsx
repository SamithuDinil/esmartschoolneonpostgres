"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Row = Record<string, unknown> & { id: string };
type Tab = "dashboard" | "vehicles" | "routes" | "passengers" | "maintenance" | "fees";
type Dashboard = {
  vehicleCount: number;
  availableVehicles: number;
  routeCount: number;
  passengerCount: number;
  configuredFees: number;
  maintenanceDue: number;
  noLiveLocation: boolean;
};
const tabs: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "vehicles", label: "Vehicles" },
  { id: "routes", label: "Routes & stops" },
  { id: "passengers", label: "Passenger roster" },
  { id: "maintenance", label: "Maintenance" },
  { id: "fees", label: "Fees & invoices" },
];
const emptyDashboard: Dashboard = {
  vehicleCount: 0,
  availableVehicles: 0,
  routeCount: 0,
  passengerCount: 0,
  configuredFees: 0,
  maintenanceDue: 0,
  noLiveLocation: true,
};

function display(value: unknown) {
  if (Array.isArray(value))
    return value
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .join(", ");
  return String(value ?? "—");
}
function pointTextToJson(value: string) {
  return value
    .split("\n")
    .map((line, index) => ({ line: line.trim(), index }))
    .filter((item) => item.line)
    .map(({ line, index }) => {
      const [kind, name, time] = line.split("|").map((part) => part.trim());
      if (kind !== "pickup" && kind !== "dropoff")
        throw new Error("Each stop must start with pickup or dropoff.");
      return { id: `point-${index + 1}`, kind, name, time, order: index + 1 };
    });
}

export function TransportPanel({ canManage = false }: { canManage?: boolean }) {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [items, setItems] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [form, setForm] = useState<Record<string, string>>({
    status: "available",
    availability: "available",
    maintenanceStatus: "scheduled",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/transport?type=${tab}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (tab === "dashboard") {
        setDashboard(data.dashboard ?? emptyDashboard);
        setItems([]);
      } else setItems(data.items ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load transport data");
    }
  }, [tab]);
  useEffect(() => {
    void load();
  }, [load]);
  const set = (key: string, value: string) => setForm((old) => ({ ...old, [key]: value }));

  async function send(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const token = await fetchCsrfToken();
      const response = await fetch("/api/transport", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setNotice("Transport record saved.");
      setForm({ status: "available", availability: "available", maintenanceStatus: "scheduled" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Transport action failed");
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (tab === "vehicles")
        return void (await send({
          action: "create_vehicle",
          registrationNumber: form.registrationNumber,
          vehicleType: form.vehicleType,
          capacity: Number(form.capacity),
          driver: form.driver ?? "",
          routeId: form.routeId ?? "",
          status: form.status || "available",
          availability: form.availability || "available",
          schedule: form.schedule ?? "",
          notes: form.notes ?? "",
        }));
      if (tab === "routes")
        return void (await send({
          action: "create_route",
          name: form.name,
          schedule: form.schedule,
          feeAmount: Number(form.feeAmount),
          pickupPoints: pointTextToJson(form.points ?? ""),
          assignedVehicleId: form.assignedVehicleId ?? "",
          status: form.status === "inactive" ? "inactive" : "active",
        }));
      if (tab === "passengers") {
        const ids = (form.studentIds ?? "")
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
        if (!ids.length) throw new Error("Enter at least one student ID.");
        for (const studentId of ids)
          await send({
            action: "assign_student",
            studentId,
            routeId: form.routeId,
            pickupPointId: form.pickupPointId,
            dropoffPointId: form.dropoffPointId,
            feeAmount: form.feeAmount ? Number(form.feeAmount) : undefined,
          });
        setNotice(`${ids.length} passenger assignment${ids.length === 1 ? "" : "s"} saved.`);
        return;
      }
      if (tab === "maintenance")
        return void (await send({
          action: "record_maintenance",
          vehicleId: form.vehicleId,
          serviceDate: form.serviceDate,
          nextServiceDate: form.nextServiceDate,
          description: form.description,
          status: form.maintenanceStatus || "scheduled",
          cost: form.cost ? Number(form.cost) : undefined,
        }));
      if (tab === "fees")
        return void (await send({
          action: "link_fee_invoice",
          assignmentId: form.assignmentId,
          financeInvoiceId: form.financeInvoiceId,
        }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Check the form values");
    }
  }
  async function downloadCsv() {
    try {
      const response = await fetch(`/api/transport?type=csv&dataset=${tab}`, { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json()).error);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `transport-${tab}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CSV export failed");
    }
  }
  function input(key: string, label: string, type = "text", required = false) {
    return (
      <label className="field" key={key}>
        {label}
        <input
          required={required}
          type={type}
          value={form[key] ?? ""}
          onChange={(event) => set(key, event.target.value)}
        />
      </label>
    );
  }
  const columns =
    tab === "vehicles"
      ? [
          "registrationNumber",
          "vehicleType",
          "capacity",
          "driver",
          "routeName",
          "status",
          "availability",
          "schedule",
        ]
      : tab === "routes"
        ? [
            "name",
            "schedule",
            "feeAmount",
            "passengerCount",
            "vehicleRegistration",
            "status",
            "pickupPoints",
          ]
        : tab === "passengers"
          ? [
              "studentId",
              "routeName",
              "pickupPointId",
              "dropoffPointId",
              "configuredFee",
              "financeInvoiceId",
              "status",
            ]
          : tab === "maintenance"
            ? [
                "registrationNumber",
                "serviceDate",
                "nextServiceDate",
                "description",
                "status",
                "cost",
              ]
            : ["routeName", "feeAmount", "passengerCount", "linkedInvoiceCount"];

  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Operations · Module 20</div>
          <h1>Transport management</h1>
          <p>
            Manage vehicles, routes, ordered stops, passenger rosters, maintenance reminders,
            schedules and transport fees.
          </p>
        </div>
        {tab !== "dashboard" && (
          <button className="btn-secondary" onClick={() => void downloadCsv()}>
            Download CSV
          </button>
        )}
      </div>
      {error && <div className="login-error">{error}</div>}
      {notice && <div className="login-success">{notice}</div>}
      <div className="notice" style={{ marginBottom: 16 }}>
        <div>
          <h3>Operations boundary</h3>
          <p>
            This MVP records schedules and availability; it does <strong>not</strong> provide live
            GPS or live vehicle location. Fee payments are not recorded here: use the finance
            invoice link on the Fees & invoices tab.
          </p>
        </div>
      </div>
      <nav style={{ display: "flex", gap: 8, overflowX: "auto", marginBottom: 16 }}>
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab === "dashboard" ? (
        <>
          <div className="stat-grid">
            {[
              ["Vehicles", dashboard.vehicleCount],
              ["Available", dashboard.availableVehicles],
              ["Active routes", dashboard.routeCount],
              ["Passengers", dashboard.passengerCount],
              ["Route fees", dashboard.configuredFees.toFixed(2)],
              ["Service reminders", dashboard.maintenanceDue],
            ].map(([label, value]) => (
              <div className="stat-card" key={String(label)}>
                <div className="stat-top">{label}</div>
                <div className="stat-value">{value}</div>
                <div className="stat-note">School-scoped records</div>
              </div>
            ))}
          </div>
          <section className="panel" style={{ marginTop: 16 }}>
            <div className="panel-title">Transport controls</div>
            <p className="panel-subtitle">
              Availability is an operational flag. A vehicle marked unavailable or in maintenance
              should not be assigned for service until reviewed.
            </p>
          </section>
        </>
      ) : (
        <div className="content-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <div className="panel-title">{tabs.find((item) => item.id === tab)?.label}</div>
                <div className="panel-subtitle">
                  {items.length} record{items.length === 1 ? "" : "s"}
                </div>
              </div>
            </div>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((column) => (
                      <th key={column}>{column.replaceAll(/([A-Z])/g, " $1")}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id}>
                      {columns.map((column) => (
                        <td key={column}>
                          {column === "status" || column === "availability" ? (
                            <span
                              className={`pill ${row[column] === "active" || row[column] === "available" || row[column] === "completed" ? "active" : row[column] === "pending" ? "pending" : ""}`}
                            >
                              {display(row[column])}
                            </span>
                          ) : (
                            display(row[column])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.length && (
                <div className="empty-state">
                  <div>
                    <h3>No records yet</h3>
                    <p>Authorized transport managers can add the first record using the form.</p>
                  </div>
                </div>
              )}
            </div>
          </section>
          {canManage && (
            <section className="panel">
              <div className="panel-title">
                {tab === "vehicles"
                  ? "Register vehicle"
                  : tab === "routes"
                    ? "Create route"
                    : tab === "passengers"
                      ? "Assign passenger(s)"
                      : tab === "maintenance"
                        ? "Record maintenance"
                        : "Link fee to finance invoice"}
              </div>
              <div className="panel-subtitle" style={{ marginBottom: 12 }}>
                {tab === "routes"
                  ? "Stops use one line each: pickup|Name|07:30 or dropoff|Name|16:00."
                  : tab === "fees"
                    ? "Requires transport.manage and finance.manage. Payment status remains in Finance."
                    : "All changes are audited."}
              </div>
              <form onSubmit={submit} className="form-grid">
                {tab === "vehicles" && (
                  <>
                    {input("registrationNumber", "Registration number", "text", true)}
                    {input("vehicleType", "Vehicle type", "text", true)}
                    {input("capacity", "Capacity", "number", true)}
                    {input("driver", "Driver")}
                    {input("routeId", "Route ID")}
                    {input("schedule", "Transport schedule")}
                    {input("notes", "Notes")}
                    <label className="field">
                      Status
                      <select
                        value={form.status ?? "available"}
                        onChange={(event) => set("status", event.target.value)}
                      >
                        <option value="available">available</option>
                        <option value="unavailable">unavailable</option>
                        <option value="maintenance">maintenance</option>
                        <option value="retired">retired</option>
                      </select>
                    </label>
                    <label className="field">
                      Availability
                      <select
                        value={form.availability ?? "available"}
                        onChange={(event) => set("availability", event.target.value)}
                      >
                        <option value="available">available</option>
                        <option value="unavailable">unavailable</option>
                      </select>
                    </label>
                  </>
                )}
                {tab === "routes" && (
                  <>
                    {input("name", "Route name", "text", true)}
                    {input("schedule", "Transport schedule", "text", true)}
                    {input("feeAmount", "Configured fee", "number", true)}
                    {input("assignedVehicleId", "Assigned vehicle ID")}
                  </>
                )}
                {tab === "routes" && (
                  <label className="field full">
                    Ordered pickup/drop-off stops
                    <textarea
                      required
                      rows={8}
                      value={form.points ?? ""}
                      onChange={(event) => set("points", event.target.value)}
                      placeholder="pickup|Main gate|07:30\ndropoff|North junction|16:00"
                    />
                  </label>
                )}
                {tab === "passengers" && (
                  <>
                    {input("studentIds", "Student IDs (comma-separated)", "text", true)}
                    {input("routeId", "Route ID", "text", true)}
                    {input("pickupPointId", "Pickup point ID", "text", true)}
                    {input("dropoffPointId", "Drop-off point ID", "text", true)}
                    {input("feeAmount", "Optional fee override", "number")}
                  </>
                )}
                {tab === "maintenance" && (
                  <>
                    {input("vehicleId", "Vehicle ID", "text", true)}
                    {input("serviceDate", "Service date", "date", true)}
                    {input("nextServiceDate", "Next-service reminder", "date", true)}
                    {input("cost", "Cost", "number")}
                    {
                      <label className="field full">
                        Description
                        <textarea
                          required
                          rows={3}
                          value={form.description ?? ""}
                          onChange={(event) => set("description", event.target.value)}
                        />
                      </label>
                    }
                    <label className="field">
                      Status
                      <select
                        value={form.maintenanceStatus ?? "scheduled"}
                        onChange={(event) => set("maintenanceStatus", event.target.value)}
                      >
                        <option>scheduled</option>
                        <option>in_progress</option>
                        <option>completed</option>
                        <option>overdue</option>
                      </select>
                    </label>
                  </>
                )}
                {tab === "fees" && (
                  <>
                    {input("assignmentId", "Transport assignment ID", "text", true)}
                    {input("financeInvoiceId", "Finance invoice ID", "text", true)}
                  </>
                )}
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save record"}
                </button>
              </form>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
