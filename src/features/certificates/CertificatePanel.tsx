"use client";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, FileCheck2, FileText, Printer, ShieldCheck } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { useI18n } from "@/lib/i18n/useI18n";
type Student = {
  id: string;
  fullName: string;
  admissionNumber: string;
  grade: string;
  className: string;
  status: string;
  verified: boolean;
};
type Certificate = {
  id: string;
  certificateType: string;
  certificateTypeLabel: string;
  studentId: string;
  studentName: string;
  admissionNumber: string;
  grade: string;
  className: string;
  status: "draft" | "approved" | "issued";
  certificateNumber?: string;
  remarks?: string;
  createdAt?: string;
  approvedAt?: string;
  issuedAt?: string;
};
type School = {
  name: string;
  logoUrl?: string | null;
  motto?: string | null;
  address?: string | null;
  principalName?: string | null;
  signatureLabel?: string | null;
};
function dateLabel(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}
export function CertificatePanel({
  canApprove,
  canIssue,
  canManage,
}: {
  canApprove: boolean;
  canIssue: boolean;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const [students, setStudents] = useState<Student[]>([]);
  const [types, setTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [school, setSchool] = useState<School>({ name: "My school" });
  const [studentId, setStudentId] = useState("");
  const [certificateType, setCertificateType] = useState("");
  const [remarks, setRemarks] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function load() {
    try {
      const response = await fetch("/api/certificates", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Certificates unavailable");
      setStudents(body.students ?? []);
      setTypes(body.certificateTypes ?? []);
      setCertificates(body.certificates ?? []);
      setSchool(body.school ?? { name: "My school" });
      setStudentId((current) => current || body.students?.[0]?.id || "");
      setCertificateType((current) => current || body.certificateTypes?.[0]?.value || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Certificates unavailable");
    }
  }
  useEffect(() => {
    void load();
  }, []);
  const selected = certificates.find((item) => item.id === selectedId) ?? null;
  const selectedStudent = students.find((item) => item.id === studentId) ?? null;
  const typeLabel =
    types.find((item) => item.value === (selected?.certificateType ?? certificateType))?.label ??
    selected?.certificateTypeLabel ??
    "Certificate";
  async function action(actionName: "request" | "approve" | "issue", requestId?: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/certificates", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: actionName,
          requestId,
          studentId: actionName === "request" ? studentId : undefined,
          certificateType: actionName === "request" ? certificateType : undefined,
          remarks,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Certificate action failed");
      setNotice(
        actionName === "request"
          ? "Draft created. Required approval is still pending."
          : actionName === "approve"
            ? "Certificate approved for issuance."
            : `Certificate issued as ${body.certificateNumber}.`,
      );
      await load();
      if (body.id) setSelectedId(body.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Certificate action failed");
    } finally {
      setBusy(false);
    }
  }
  const issued = useMemo(
    () => certificates.filter((item) => item.status === "issued"),
    [certificates],
  );
  return (
    <main className="page-content">
      <div className="page-heading no-print">
        <div>
          <div className="eyebrow">Official records · controlled issue</div>
          <h1>School certificates</h1>
          <p>
            Prepare verified student certificates, obtain approval, then issue a numbered record
            with school branding.
          </p>
        </div>
        <div className="portal-access-note">
          <ShieldCheck size={13} /> Approval required
        </div>
      </div>
      {(error || notice) && (
        <div
          className={error ? "login-error no-print" : "login-success no-print"}
          style={{ marginBottom: 14 }}
        >
          {error || notice}
        </div>
      )}
      <div className="content-grid certificate-layout" style={{ alignItems: "start" }}>
        <section className="panel no-print">
          <div className="panel-header">
            <div>
              <div className="panel-title">Create certificate request</div>
              <div className="panel-subtitle">
                Only active, verified student records are selectable.
              </div>
            </div>
            <FileCheck2 size={20} color="#315ee8" />
          </div>
          <div className="form-grid">
            <label className="field full">
              <span>Certificate type</span>
              <select
                disabled={!canManage}
                value={certificateType}
                onChange={(event) => setCertificateType(event.target.value)}
              >
                <option value="">Select a type</option>
                {types.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>Verified student</span>
              <select
                disabled={!canManage}
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
              >
                <option value="">Select a student</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.fullName} · {student.admissionNumber} · {student.grade}{" "}
                    {student.className}
                  </option>
                ))}
              </select>
            </label>
            <label className="field full">
              <span>Authorized remarks</span>
              <textarea
                disabled={!canManage}
                rows={4}
                maxLength={1200}
                value={remarks}
                onChange={(event) => setRemarks(event.target.value)}
                placeholder="Optional approved wording for this certificate"
              />
            </label>
            <div className="form-actions">
              <button
                className="btn-primary"
                disabled={busy || !canManage || !studentId || !certificateType}
                onClick={() => void action("request")}
              >
                <FileText size={14} />
                {busy ? "Saving…" : "Prepare draft"}
              </button>
            </div>
          </div>
          <div className="portal-footnote">
            <BadgeCheck size={13} /> Student information is loaded from the verified school record;
            remarks remain permission-scoped.
          </div>
          <div className="certificate-history">
            <div className="panel-title">Certificate history</div>
            <div className="panel-subtitle">
              {issued.length} issued record{issued.length === 1 ? "" : "s"}
            </div>
            {certificates.length ? (
              <div className="activity-list" style={{ marginTop: 14 }}>
                {certificates.slice(0, 8).map((item) => (
                  <button
                    className={`history-row ${selectedId === item.id ? "selected" : ""}`}
                    key={item.id}
                    onClick={() => {
                      setSelectedId(item.id);
                      setRemarks(item.remarks ?? "");
                    }}
                  >
                    <span>
                      <strong>{item.certificateNumber ?? "Draft request"}</strong>
                      <small>
                        {item.studentName} · {item.certificateTypeLabel}
                      </small>
                    </span>
                    <span className={`pill ${item.status === "issued" ? "active" : "pending"}`}>
                      {item.status}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state" style={{ minHeight: 120 }}>
                <div>
                  <div className="empty-icon">
                    <FileText size={16} />
                  </div>
                  <h3>{t("common.noRecords")}</h3>
                  <p>Prepare a draft to begin the approval history.</p>
                </div>
              </div>
            )}
          </div>
        </section>
        <section className="certificate-paper" aria-label="Certificate preview">
          <div className="certificate-ribbon">
            {selected?.status === "issued"
              ? `Issued · ${selected.certificateNumber}`
              : selected?.status === "approved"
                ? "Approved · awaiting issuance"
                : "Preview · not issued"}
          </div>
          <header className="certificate-header">
            {school.logoUrl ? (
              <img src={school.logoUrl} alt={`${school.name} logo`} />
            ) : (
              <div className="certificate-seal">ES</div>
            )}
            <div>
              <div className="eyebrow">{school.motto ?? "Verified school record"}</div>
              <h2>{school.name}</h2>
              {school.address && <p>{school.address}</p>}
            </div>
          </header>
          <div className="certificate-title">
            <div>Certificate of</div>
            <h1>{typeLabel}</h1>
            <p>
              This certifies that the official student information below has been reviewed from the
              school record.
            </p>
          </div>
          <div className="certificate-student">
            <span>Student name</span>
            <strong>
              {selected?.studentName ?? selectedStudent?.fullName ?? "Select a verified student"}
            </strong>
            <span>Admission number</span>
            <strong>{selected?.admissionNumber ?? selectedStudent?.admissionNumber ?? "—"}</strong>
            <span>Grade / class</span>
            <strong>
              {selected
                ? `${selected.grade} / ${selected.className}`
                : selectedStudent
                  ? `${selectedStudent.grade} / ${selectedStudent.className}`
                  : "—"}
            </strong>
          </div>
          <div className="certificate-remarks">
            <b>Authorized remarks</b>
            <p>{selected?.remarks || remarks || "No additional remarks have been recorded."}</p>
          </div>
          <div className="certificate-date">
            Issued on:{" "}
            {selected?.issuedAt ? dateLabel(selected.issuedAt) : "Pending approval and issue"}
          </div>
          <footer className="certificate-signatures">
            <span>Class teacher</span>
            <span>{school.principalName ?? "Principal"}</span>
            <span>{school.signatureLabel ?? "Authorized signature"}</span>
          </footer>
          <div className="certificate-actions no-print">
            <button className="btn-secondary" disabled={!selected} onClick={() => window.print()}>
              <Printer size={13} />
              Print / Save PDF
            </button>
            {selected?.status === "draft" && canApprove && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void action("approve", selected.id)}
              >
                <ShieldCheck size={13} />
                Approve certificate
              </button>
            )}
            {selected?.status === "approved" && canIssue && (
              <button
                className="btn-primary"
                disabled={busy}
                onClick={() => void action("issue", selected.id)}
              >
                <BadgeCheck size={13} />
                Issue numbered certificate
              </button>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
