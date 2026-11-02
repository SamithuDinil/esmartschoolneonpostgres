"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ClipboardList,
  FileWarning,
  Plus,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Row = Record<string, unknown> & { id: string };
type InventoryResponse = {
  items: Row[];
  movements: Row[];
  suppliers: Row[];
  summary: { totalAssets: number; totalUnits: number; lowStock: number; categories: number };
};
const categories = [
  ["computers", "Computers"],
  ["printers", "Printers"],
  ["laboratory_equipment", "Laboratory equipment"],
  ["furniture", "Furniture"],
  ["sports_equipment", "Sports equipment"],
  ["office_supplies", "Office supplies"],
  ["classroom_resources", "Classroom resources"],
] as const;
const labelFor = (value: unknown) =>
  categories.find(([key]) => key === value)?.[1] ?? String(value ?? "—");
const text = (value: unknown) => String(value ?? "—");

export function InventoryPanel({ canManage }: { canManage: boolean }) {
  const [tab, setTab] = useState<"assets" | "movements" | "suppliers" | "reports">("assets");
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAssetForm, setShowAssetForm] = useState(false);
  const [showMovementForm, setShowMovementForm] = useState(false);
  const [showCareForm, setShowCareForm] = useState(false);
  const [showSupplierForm, setShowSupplierForm] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/inventory", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Inventory data could not be loaded.");
      setData(body as InventoryResponse);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inventory data could not be loaded.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const isMovement = form.get("action") === "movement";
    const payload: Record<string, unknown> = { action: form.get("action") };
    [
      "name",
      "assetCode",
      "category",
      "quantity",
      "minimumStock",
      "location",
      "condition",
      "purchaseDate",
      "supplier",
      "unitCostMinor",
      "assetId",
      "movementType",
      "reason",
      "reference",
      "scheduledDate",
      "maintenanceType",
      "notes",
      "fromLocation",
      "toLocation",
      "contactName",
      "phone",
      "email",
    ].forEach((key) => {
      if (form.get(key) !== null) payload[key] = form.get(key);
    });
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Inventory change could not be saved.");
      setNotice(
        isMovement ? "Stock movement recorded and quantity updated." : "Inventory record saved.",
      );
      setShowAssetForm(false);
      setShowMovementForm(false);
      setShowCareForm(false);
      setShowSupplierForm(false);
      event.currentTarget.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Inventory change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () =>
      (data?.items ?? []).filter((item) =>
        `${item.name} ${item.assetCode} ${item.location} ${item.category}`
          .toLowerCase()
          .includes(query.toLowerCase()),
      ),
    [data, query],
  );
  const summary = data?.summary ?? { totalAssets: 0, totalUnits: 0, lowStock: 0, categories: 0 };
  return (
    <main className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">Module 21 · Operations</div>
          <h1>Inventory & asset management</h1>
          <p>Keep every asset accountable from purchase to movement, maintenance and retirement.</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canManage && (
            <>
              <button className="btn-secondary" onClick={() => setShowMovementForm(true)}>
                <ArrowUpFromLine size={14} />
                Record movement
              </button>
              <button className="btn-secondary" onClick={() => setShowCareForm(true)}>
                <ClipboardList size={14} />
                Maintenance / transfer
              </button>
              <button className="btn-primary" onClick={() => setShowAssetForm(true)}>
                <Plus size={14} />
                Register asset
              </button>
            </>
          )}
        </div>
      </div>
      <section className="stat-grid" aria-label="Inventory summary">
        {(
          [
            { label: "Asset records", value: summary.totalAssets, icon: Boxes, color: "#edf2ff" },
            { label: "Units on hand", value: summary.totalUnits, icon: Archive, color: "#e9f8f0" },
            {
              label: "Low-stock alerts",
              value: summary.lowStock,
              icon: FileWarning,
              color: "#fff2d8",
            },
            {
              label: "Categories in use",
              value: summary.categories,
              icon: ClipboardList,
              color: "#f1edff",
            },
          ] as Array<{ label: string; value: number; icon: LucideIcon; color: string }>
        ).map(({ label, value, icon: Icon, color }) => (
          <article className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <span className="stat-icon" style={{ background: color }}>
                <Icon size={15} />
              </span>
            </div>
            <div className="stat-value">{String(value)}</div>
            <div className="stat-note">Live from authorized school records</div>
          </article>
        ))}
      </section>
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="login-success" role="status">
          {notice}
        </p>
      )}
      <div className="module-tabs" role="tablist" aria-label="Inventory views">
        {[
          ["assets", "Assets"],
          ["movements", "Stock movement"],
          ["suppliers", "Suppliers"],
          ["reports", "Reports"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "btn-primary" : "btn-secondary"}
            onClick={() => setTab(id as typeof tab)}
            role="tab"
            aria-selected={tab === id}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "assets" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Asset register</div>
              <div className="panel-subtitle">
                Codes, quantities, condition, owner location and stock thresholds.
              </div>
            </div>
            <label className="search-box" style={{ width: 230 }}>
              <Search size={14} />
              <input
                aria-label="Search inventory"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search assets"
                style={{ border: 0, outline: 0, background: "transparent", width: "100%" }}
              />
            </label>
          </div>
          {filtered.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Category</th>
                    <th>Qty / min</th>
                    <th>Location</th>
                    <th>Condition</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item) => {
                    const low = Number(item.quantity ?? 0) <= Number(item.minimumStock ?? 0);
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{text(item.name)}</strong>
                          <div className="panel-subtitle">{text(item.assetCode)}</div>
                        </td>
                        <td>{labelFor(item.category)}</td>
                        <td>
                          {text(item.quantity)}{" "}
                          <span className="panel-subtitle">/ {text(item.minimumStock)}</span>
                        </td>
                        <td>{text(item.location)}</td>
                        <td>
                          <span
                            className={`pill ${item.condition === "good" || item.condition === "new" ? "active" : item.condition === "needs_repair" ? "pending" : ""}`}
                          >
                            {text(item.condition).replaceAll("_", " ")}
                          </span>
                        </td>
                        <td>
                          {low ? (
                            <span className="pill pending">Low stock</span>
                          ) : (
                            <span className="pill active">Healthy</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <Boxes size={17} />
                </div>
                <h3>No asset records yet</h3>
                <p>
                  Register computers, furniture, supplies and other school resources to start an
                  accountable register.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "movements" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Stock movement history</div>
              <div className="panel-subtitle">
                Append-only stock-in, stock-out and adjustment records.
              </div>
            </div>
            <RefreshCw size={16} color="#315ee8" />
          </div>
          {data?.movements.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Asset</th>
                    <th>Quantity</th>
                    <th>Reason</th>
                    <th>Resulting stock</th>
                    <th>Recorded</th>
                  </tr>
                </thead>
                <tbody>
                  {data.movements.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <span
                          className={`pill ${item.movementType === "stock_in" ? "active" : item.movementType === "stock_out" ? "pending" : ""}`}
                        >
                          {text(item.movementType).replaceAll("_", " ")}
                        </span>
                      </td>
                      <td>{text(item.assetId)}</td>
                      <td>{text(item.quantity)}</td>
                      <td>{text(item.reason)}</td>
                      <td>{text(item.resultingQuantity)}</td>
                      <td>{text(item.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <ArrowDownToLine size={17} />
                </div>
                <h3>No stock movement history</h3>
                <p>Stock-in, stock-out and adjustments will appear here once recorded.</p>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "suppliers" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="panel-title">Supplier directory</div>
              <div className="panel-subtitle">Purchase sources remain scoped to this school.</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Truck size={16} color="#315ee8" />
              {canManage && (
                <button className="btn-secondary" onClick={() => setShowSupplierForm(true)}>
                  <Plus size={13} />
                  Add supplier
                </button>
              )}
            </div>
          </div>
          {data?.suppliers.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Supplier</th>
                    <th>Contact</th>
                    <th>Phone</th>
                    <th>Email</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suppliers.map((item) => (
                    <tr key={item.id}>
                      <td>{text(item.name)}</td>
                      <td>{text(item.contactName)}</td>
                      <td>{text(item.phone)}</td>
                      <td>{text(item.email)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <div className="empty-icon">
                  <Truck size={17} />
                </div>
                <h3>No suppliers recorded</h3>
                <p>
                  Supplier records can be added through the inventory service when purchasing is
                  enabled.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
      {tab === "reports" && (
        <section className="content-grid">
          <article className="panel">
            <div className="panel-title">Inventory report readiness</div>
            <div className="panel-subtitle">
              Operational summaries available from the authorized asset register.
            </div>
            <div className="report-list">
              <div>
                <strong>{summary.totalAssets}</strong>
                <span>Asset records</span>
              </div>
              <div>
                <strong>{summary.totalUnits}</strong>
                <span>Total units</span>
              </div>
              <div>
                <strong>{summary.lowStock}</strong>
                <span>Needs reorder</span>
              </div>
            </div>
          </article>
          <article className="notice">
            <FileWarning size={18} color="#93660d" />
            <div>
              <h3>Low-stock monitoring</h3>
              <p>
                Alerts are calculated from each item’s minimum stock level. Email, SMS and WhatsApp
                delivery still require an authorized provider.
              </p>
            </div>
          </article>
        </section>
      )}
      {showAssetForm && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Register asset</div>
                <div className="panel-subtitle">Create a school-scoped asset record.</div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowAssetForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <input type="hidden" name="action" value="create_asset" />
              <label className="field">
                <span>Asset name</span>
                <input name="name" required placeholder="Science lab microscope" />
              </label>
              <label className="field">
                <span>Asset code</span>
                <input name="assetCode" required placeholder="LAB-0001" />
              </label>
              <label className="field">
                <span>Category</span>
                <select name="category" defaultValue="computers">
                  {categories.map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Quantity</span>
                <input name="quantity" type="number" min="0" defaultValue="1" required />
              </label>
              <label className="field">
                <span>Minimum stock</span>
                <input name="minimumStock" type="number" min="0" defaultValue="0" required />
              </label>
              <label className="field">
                <span>Location</span>
                <input name="location" required placeholder="Block B · Lab 2" />
              </label>
              <label className="field">
                <span>Condition</span>
                <select name="condition" defaultValue="good">
                  <option value="new">New</option>
                  <option value="good">Good</option>
                  <option value="needs_repair">Needs repair</option>
                  <option value="out_of_service">Out of service</option>
                </select>
              </label>
              <label className="field">
                <span>Purchase date</span>
                <input name="purchaseDate" type="date" />
              </label>
              <label className="field">
                <span>Supplier</span>
                <input name="supplier" placeholder="Optional supplier" />
              </label>
              <label className="field">
                <span>Unit cost (minor units)</span>
                <input name="unitCostMinor" type="number" min="0" defaultValue="0" />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAssetForm(false)}
                >
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save asset"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showMovementForm && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Record stock movement</div>
                <div className="panel-subtitle">
                  Every movement appends an auditable history row.
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowMovementForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <input type="hidden" name="action" value="movement" />
              <label className="field full">
                <span>Asset</span>
                <select name="assetId" required defaultValue="">
                  {" "}
                  <option value="" disabled>
                    Select an asset
                  </option>
                  {data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {text(item.assetCode)} · {text(item.name)} ({text(item.quantity)} on hand)
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Movement type</span>
                <select name="movementType" defaultValue="stock_in">
                  <option value="stock_in">Stock in</option>
                  <option value="stock_out">Stock out</option>
                  <option value="adjustment">Adjustment to quantity</option>
                </select>
              </label>
              <label className="field">
                <span>Quantity</span>
                <input name="quantity" type="number" min="1" defaultValue="1" required />
              </label>
              <label className="field full">
                <span>Reason</span>
                <input
                  name="reason"
                  required
                  placeholder="Purchase order, issue to classroom or count correction"
                />
              </label>
              <label className="field full">
                <span>Reference</span>
                <input
                  name="reference"
                  placeholder="Optional purchase order or handover reference"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowMovementForm(false)}
                >
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Record movement"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showSupplierForm && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Add supplier</div>
                <div className="panel-subtitle">Keep purchase contacts scoped to this school.</div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowSupplierForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <input type="hidden" name="action" value="create_supplier" />
              <label className="field full">
                <span>Supplier name</span>
                <input name="name" required placeholder="Approved school supplier" />
              </label>
              <label className="field">
                <span>Contact name</span>
                <input name="contactName" />
              </label>
              <label className="field">
                <span>Phone</span>
                <input name="phone" type="tel" />
              </label>
              <label className="field full">
                <span>Email</span>
                <input name="email" type="email" />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowSupplierForm(false)}
                >
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save supplier"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showCareForm && (
        <div className="modal-backdrop">
          <section className="modal-card">
            <div className="panel-header">
              <div>
                <div className="panel-title">Asset care and location</div>
                <div className="panel-subtitle">
                  Record a maintenance visit or an accountable transfer.
                </div>
              </div>
              <button
                className="icon-button"
                onClick={() => setShowCareForm(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form className="form-grid" onSubmit={submit}>
              <label className="field full">
                <span>Workflow</span>
                <select name="action" defaultValue="create_maintenance">
                  <option value="create_maintenance">Schedule maintenance</option>
                  <option value="transfer">Transfer asset</option>
                </select>
              </label>
              <label className="field full">
                <span>Asset</span>
                <select name="assetId" required defaultValue="">
                  <option value="" disabled>
                    Select an asset
                  </option>
                  {data?.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {text(item.assetCode)} · {text(item.name)} · {text(item.location)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Maintenance date</span>
                <input name="scheduledDate" type="date" />
              </label>
              <label className="field">
                <span>Maintenance type</span>
                <input name="maintenanceType" placeholder="Inspection / repair" />
              </label>
              <label className="field">
                <span>From location</span>
                <input name="fromLocation" placeholder="Current location" />
              </label>
              <label className="field">
                <span>To location</span>
                <input name="toLocation" placeholder="New location" />
              </label>
              <label className="field full">
                <span>Reason / notes</span>
                <textarea
                  name="reason"
                  rows={3}
                  placeholder="Why is this maintenance or transfer being recorded?"
                />
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowCareForm(false)}
                >
                  Cancel
                </button>
                <button className="btn-primary" disabled={busy}>
                  {busy ? "Saving…" : "Save record"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
