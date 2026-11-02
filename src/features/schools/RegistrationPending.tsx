"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type RequestRow = {
  id: string;
  schoolName: string;
  role: string;
  status: string;
  requestedAt: string | null;
  decidedAt: string | null;
};

export function RegistrationPending() {
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/registration-requests/mine", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load request status.");
      setRequests(data.requests ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load request status.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <main className="page-content" style={{ maxWidth: 860, margin: "40px auto" }}>
      <section className="card" style={{ padding: 24 }}>
        <h1>Registration status</h1>
        <p>
          Your invitation determined the school and requested role. Access to school records is not
          granted until the school administrator approves the request.
        </p>
        <button type="button" onClick={() => void load()} disabled={loading}>
          Refresh status
        </button>
        {error && <p role="alert">{error}</p>}
        {loading ? (
          <p>Loading your requests…</p>
        ) : !requests.length ? (
          <div>
            <p>No registration requests were found for this account.</p>
            <Link href="/dashboard">Return to dashboard</Link>
          </div>
        ) : (
          requests.map((request) => (
            <article
              key={`${request.schoolName}-${request.id}`}
              style={{ borderTop: "1px solid #e7eaf0", padding: "16px 0" }}
            >
              <h2 style={{ marginBottom: 5 }}>{request.schoolName}</h2>
              <p>
                Requested role: <strong>{request.role.replaceAll("_", " ")}</strong>
              </p>
              <p>
                Status: <strong>{request.status.replaceAll("_", " ")}</strong>
                {request.requestedAt
                  ? ` · Submitted ${new Date(request.requestedAt).toLocaleString()}`
                  : ""}
                {request.decidedAt
                  ? ` · Reviewed ${new Date(request.decidedAt).toLocaleString()}`
                  : ""}
              </p>
              {request.status === "pending" && (
                <p role="status">
                  Your registration is awaiting approval from your school administration. Refresh
                  this page to check for an update.
                </p>
              )}
              {request.status === "approved" && (
                <p className="login-success">
                  Registration approved. <Link href="/dashboard">Open your school dashboard</Link>
                </p>
              )}
              {request.status === "rejected" && (
                <p className="login-error">
                  The request was not approved. Contact the school administration or submit a new
                  request with a new invitation.
                </p>
              )}
            </article>
          ))
        )}
      </section>
    </main>
  );
}
