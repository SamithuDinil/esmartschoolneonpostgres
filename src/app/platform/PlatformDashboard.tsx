"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type School = {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  planId?: string;
  subscriptionExpiresAt?: { _seconds?: number } | string | null;
};
export default function PlatformPage() {
  const [schools, setSchools] = useState<School[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");
  const [stats, setStats] = useState({ schools: 0, users: 0 });
  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/platform/schools", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSchools(d.schools);
      setStats(d.stats);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load platform data");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function mutate(body: object, method: string) {
    const csrf = await fetchCsrfToken();
    const r = await fetch("/api/platform/schools", {
      method,
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Operation failed");
    await load();
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
      await mutate(
        { name, slug, adminEmail: adminEmail || undefined, adminName: adminName || undefined },
        "POST",
      );
      setName("");
      setSlug("");
      setAdminEmail("");
      setAdminName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to create school");
    }
  }
  const shown = useMemo(
    () =>
      schools.filter(
        (s) =>
          (filter === "all" || s.status === filter) &&
          `${s.name} ${s.slug ?? ""}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [schools, filter, query],
  );
  return (
    <main style={{ maxWidth: 1100, margin: "40px auto", padding: 24, color: "#172033" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: "#60708a", fontSize: 13 }}>E-SMARTSCHOOL.LK · PLATFORM</div>
          <h1 style={{ margin: "8px 0" }}>E-SmartSchool.lk Control Center</h1>
          <p>Platform-wide school oversight, lifecycle controls, and audited administration.</p>
        </div>
        <button onClick={() => void load()}>Refresh</button>
      </header>
      {error && (
        <p role="alert" style={{ color: "#b42318", background: "#fff2f0", padding: 12 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 14, margin: "24px 0" }}>
        <div className="panel" style={{ padding: 20, flex: 1 }}>
          Registered schools{" "}
          <strong style={{ display: "block", fontSize: 28 }}>{stats.schools}</strong>
        </div>
        <div className="panel" style={{ padding: 20, flex: 1 }}>
          Platform accounts{" "}
          <strong style={{ display: "block", fontSize: 28 }}>{stats.users}</strong>
        </div>
      </div>
      <section className="panel" style={{ padding: 20, marginBottom: 20 }}>
        <h2>Create New School</h2>
        <form
          onSubmit={create}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
            gap: 12,
          }}
        >
          <input
            aria-label="School name"
            placeholder="School name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            aria-label="School slug"
            placeholder="school-slug"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          />
          <input
            aria-label="Administrator name"
            placeholder="Principal name (optional)"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
          />
          <input
            aria-label="Administrator email"
            type="email"
            placeholder="Principal email (optional)"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
          />
          <button className="btn-primary">Create school</button>
        </form>
      </section>
      <section className="panel" style={{ padding: 20 }}>
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <input
            aria-label="Search schools"
            placeholder="Search schools"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label="Filter by status"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </select>
        </div>
        {loading ? (
          <p>Loading schools…</p>
        ) : !shown.length ? (
          <p>No schools found.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", textAlign: "left", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Status</th>
                  <th>Plan</th>
                  <th>Subscription</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid #e8ecf2" }}>
                    <td style={{ padding: 12 }}>
                      <strong>{s.name}</strong>
                      <div>{s.slug}</div>
                    </td>
                    <td>{s.status ?? "active"}</td>
                    <td>
                      <select
                        aria-label={`Plan for ${s.name}`}
                        value={s.planId ?? "free"}
                        onChange={(e) =>
                          void mutate({ schoolId: s.id, planId: e.target.value }, "PATCH").catch(
                            (x) => setError(x.message),
                          )
                        }
                      >
                        <option value="free">Free</option>
                        <option value="standard">Standard</option>
                        <option value="premium">Premium</option>
                      </select>
                    </td>
                    <td>{s.subscriptionExpiresAt ? "Set" : "No expiry"}</td>
                    <td>
                      <button
                        onClick={() =>
                          void mutate(
                            {
                              schoolId: s.id,
                              status: s.status === "suspended" ? "active" : "suspended",
                            },
                            "PATCH",
                          ).catch((x) => setError(x.message))
                        }
                      >
                        {s.status === "suspended" ? "Activate" : "Suspend"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p style={{ color: "#68758a", marginTop: 20 }}>
        All administrative changes are written to platform audit logs. Access is verified on every
        API request.
      </p>
    </main>
  );
}
