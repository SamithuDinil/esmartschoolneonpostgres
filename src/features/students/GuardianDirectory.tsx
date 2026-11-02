"use client";

import { useCallback, useEffect, useState } from "react";
import { Mail, Phone, Search, Users, X } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";

type Child = {
  id: string;
  fullName: string;
  admissionNumber: string;
  grade: string;
  className: string;
  relationship: string;
};

type Guardian = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  children: Child[];
};

export function GuardianDirectory({
  parent,
  canManage,
}: {
  parent: boolean;
  canManage: boolean;
}) {
  const [rows, setRows] = useState<Guardian[]>([]);
  const [children, setChildren] = useState<Omit<Child, "relationship">[]>([]);
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [guardianSearch, setGuardianSearch] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [guardianOptions, setGuardianOptions] = useState<Pick<Guardian, "id" | "fullName" | "email" | "phone">[]>([]);
  const [studentOptions, setStudentOptions] = useState<Omit<Child, "relationship">[]>([]);
  const [selectedGuardian, setSelectedGuardian] = useState<Pick<Guardian, "id" | "fullName" | "email" | "phone"> | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<Omit<Child, "relationship"> | null>(null);
  const [guardianSearching, setGuardianSearching] = useState(false);
  const [studentSearching, setStudentSearching] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [fullName, setFullName] = useState("");
  const [relationship, setRelationship] = useState("Parent");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [occupation, setOccupation] = useState("");
  const [guardianUid, setGuardianUid] = useState("");
  const [homeworkAccess, setHomeworkAccess] = useState(true);
  const activeQuery = query.trim().length >= 2 ? query.trim() : "";
  const guardianId = selectedGuardian?.id ?? "";

  const load = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (!parent && activeQuery) params.set("q", activeQuery);
    setLoading(true);
    setErr("");
    try {
      const response = await fetch(`/api/guardians?${params.toString()}`, {
        cache: "no-store",
        signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to load family records.");
      if (parent) setChildren(data.children ?? []);
      else {
        const guardians = (data.guardians ?? []) as Guardian[];
        setRows(guardians);
        setTotal(Number(data.total ?? guardians.length));
        setTruncated(data.truncated === true);
      }
    } catch (cause) {
      if (signal?.aborted) return;
      setErr(cause instanceof Error ? cause.message : "Unable to load family records.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activeQuery, parent]);

  useEffect(() => {
    const term = guardianSearch.trim();
    if (selectedGuardian || term.length < 2) {
      setGuardianOptions([]);
      setGuardianSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setGuardianSearching(true);
      setPickerError("");
      try {
        const response = await fetch(`/api/guardians?picker=guardians&q=${encodeURIComponent(term)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Guardian search is unavailable.");
        setGuardianOptions(data.options ?? []);
      } catch (cause) {
        if (!controller.signal.aborted)
          setPickerError(cause instanceof Error ? cause.message : "Guardian search is unavailable.");
      } finally {
        if (!controller.signal.aborted) setGuardianSearching(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [guardianSearch, selectedGuardian]);

  useEffect(() => {
    const term = studentSearch.trim();
    if (selectedStudent || term.length < 2) {
      setStudentOptions([]);
      setStudentSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStudentSearching(true);
      setPickerError("");
      try {
        const response = await fetch(`/api/guardians?picker=students&q=${encodeURIComponent(term)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Student search is unavailable.");
        setStudentOptions(data.options ?? []);
      } catch (cause) {
        if (!controller.signal.aborted)
          setPickerError(cause instanceof Error ? cause.message : "Student search is unavailable.");
      } finally {
        if (!controller.signal.aborted) setStudentSearching(false);
      }
    }, 220);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [studentSearch, selectedStudent]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), activeQuery ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeQuery, load]);

  async function send(data: object) {
    setErr("");
    setNotice("");
    setBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/guardians", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "The guardian update could not be saved.");
      setNotice(data && "action" in data && data.action === "link"
        ? "Student linked to guardian."
        : "Guardian saved successfully.");
      await load();
      return true;
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "The guardian update could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createParentInvite() {
    if (!selectedGuardian || !selectedStudent) return;
    setErr("");
    setNotice("");
    setInviteUrl("");
    setInviteBusy(true);
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/parent-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ guardianId: selectedGuardian.id, studentId: selectedStudent.id, expiresInDays: 14 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Parent invitation could not be created.");
      setInviteUrl(String(result.url ?? ""));
      setNotice("Parent invitation created. Share the secure link with the guardian.");
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : "Parent invitation could not be created.");
    } finally {
      setInviteBusy(false);
    }
  }

  if (parent) {
    return (
      <main className="page-content guardian-page">
        <div className="page-heading">
          <div>
            <div className="eyebrow">Family access</div>
            <h1>My linked children</h1>
            <p>Student information shared with your verified guardian account.</p>
          </div>
        </div>
        {err && <p className="login-error" role="alert">{err}</p>}
        {children.length ? (
          <div className="guardian-child-grid">
            {children.map((child) => (
              <article className="panel guardian-child-card" key={child.id}>
                <div className="guardian-child-title">
                  <span className="guardian-avatar" aria-hidden="true">{child.fullName.slice(0, 1).toUpperCase()}</span>
                  <div>
                    <h2>{child.fullName}</h2>
                    <span>{child.grade} · Class {child.className}</span>
                  </div>
                </div>
                <p className="guardian-child-meta">Admission no. {child.admissionNumber}</p>
              </article>
            ))}
          </div>
        ) : (
          <section className="panel guardian-empty-state">
            <span className="guardian-empty-icon"><Users size={22} /></span>
            <h2>No linked students yet</h2>
            <p>Ask your school administrator to link your verified account to your child’s student record.</p>
          </section>
        )}
      </main>
    );
  }

  return (
    <main className="page-content guardian-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">School workspace · Families</div>
          <h1>Guardians</h1>
          <p>Find a parent or student quickly, and see their school-approved family links.</p>
        </div>
        <div className="guardian-summary" aria-live="polite">
          <span className="guardian-summary-icon"><Users size={17} /></span>
          <span><strong>{total}</strong><small>family records</small></span>
        </div>
      </div>

      {err && <p className="login-error" role="alert">{err}</p>}
      {notice && <p className="login-success" role="status">{notice}</p>}

      <div className={canManage ? "guardian-workspace" : "guardian-workspace guardian-readonly"}>
        <section className="panel guardian-directory-panel" aria-labelledby="guardian-directory-title">
          <div className="panel-header guardian-panel-header">
            <div>
              <div className="panel-title" id="guardian-directory-title">Family directory</div>
              <div className="panel-subtitle">Search guardian contacts or a linked student’s name, class or admission number.</div>
            </div>
            <span className="guardian-result-count">{loading ? "Searching…" : `${rows.length}${truncated ? "+" : ""} shown`}</span>
          </div>

          <label className="guardian-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search parent or student name, phone, email, admission no."
              aria-label="Search guardians and linked students"
              autoComplete="off"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X size={16} />
              </button>
            )}
          </label>
          <p className="guardian-search-help">Results stay within your active school. Search starts after 2 characters.</p>

          {truncated && (
            <p className="guardian-limit-note">Showing the first 200 matches. Add more detail to narrow the results.</p>
          )}
          {rows.length ? (
            <div className="guardian-card-list">
              {rows.map((guardian) => (
                <article className="guardian-card" key={guardian.id}>
                  <div className="guardian-card-header">
                    <span className="guardian-avatar" aria-hidden="true">{guardian.fullName.slice(0, 1).toUpperCase()}</span>
                    <div className="guardian-card-name">
                      <h2>{guardian.fullName}</h2>
                      <span>Guardian</span>
                    </div>
                    <span className="guardian-child-count">
                      {guardian.children.length} {guardian.children.length === 1 ? "student" : "students"}
                    </span>
                  </div>
                  <div className="guardian-contact-list">
                    {guardian.phone && (
                      <a href={`tel:${guardian.phone}`}><Phone size={14} />{guardian.phone}</a>
                    )}
                    {guardian.email && (
                      <a href={`mailto:${guardian.email}`}><Mail size={14} />{guardian.email}</a>
                    )}
                    {!guardian.phone && !guardian.email && <span className="guardian-muted">No contact details provided</span>}
                  </div>
                  <div className="guardian-linked-students">
                    <div className="guardian-linked-title">Linked students</div>
                    {guardian.children.length ? (
                      <ul>
                        {guardian.children.slice(0, 4).map((child) => (
                          <li key={child.id}>
                            <div>
                              <strong>{child.fullName}</strong>
                              <span>{child.grade}{child.className ? ` · Class ${child.className}` : ""}</span>
                            </div>
                            <span className="guardian-relationship">{child.relationship}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="guardian-muted">No student is linked to this guardian yet.</p>}
                    {guardian.children.length > 4 && (
                      <small className="guardian-muted">And {guardian.children.length - 4} more linked students</small>
                    )}
                  </div>
                  {canManage && (
                    <button
                      className="guardian-link-action"
                      type="button"
                      onClick={() => {
                        setSelectedGuardian({
                          id: guardian.id,
                          fullName: guardian.fullName,
                          email: guardian.email,
                          phone: guardian.phone,
                        });
                        setGuardianSearch("");
                        document.getElementById("guardian-link-form")?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }}
                    >
                      Use this guardian in the link form
                    </button>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <div className="guardian-empty-state guardian-search-empty">
              <span className="guardian-empty-icon"><Search size={20} /></span>
              <h2>{loading ? "Searching family records" : activeQuery ? "No matching families" : "No guardian records yet"}</h2>
              <p>{loading
                ? "Looking through guardian contacts and linked student records…"
                : activeQuery
                  ? "Try another spelling, phone number, email or admission number."
                  : canManage
                    ? "Register a guardian to start building your school’s family directory."
                    : "Guardian records will appear here when they are added by a school administrator."}</p>
            </div>
          )}
        </section>

        {canManage && (
          <aside className="guardian-admin-forms">
            <section className="panel guardian-form-panel">
              <div className="panel-title">Register a guardian</div>
              <p className="panel-subtitle">Add the parent or caregiver’s verified contact details.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                void send({
                  action: "create", fullName, relationship, phone, email, address, occupation,
                  emergencyContact: false, communicationPreferences: ["email"],
                }).then((saved) => {
                  if (saved) { setFullName(""); setEmail(""); setPhone(""); setAddress(""); setOccupation(""); }
                });
              }}>
                <label className="field">Full name<input required value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
                <label className="field">Relationship to student<input required value={relationship} onChange={(event) => setRelationship(event.target.value)} /></label>
                <label className="field">Phone<input required type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                <label className="field">Email (optional)<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
                <details className="guardian-optional-fields">
                  <summary>Optional details</summary>
                  <label className="field">Residential address<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
                  <label className="field">Occupation<input value={occupation} onChange={(event) => setOccupation(event.target.value)} /></label>
                </details>
                <button className="btn-primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save guardian"}</button>
              </form>
            </section>

            <section className="panel guardian-form-panel" id="guardian-link-form">
              <div className="panel-title">Link a guardian to a student</div>
              <p className="panel-subtitle">Search and select both records by name. No record IDs needed.</p>
              <form onSubmit={(event) => {
                event.preventDefault();
                if (!selectedGuardian || !selectedStudent) return;
                void send({
                  action: "link", guardianId: selectedGuardian.id, studentId: selectedStudent.id,
                  relationship, guardianUid: guardianUid || undefined,
                  accessPermissions: ["attendance", "published_results", "fees", "report_cards", "announcements", ...(homeworkAccess ? ["assignments"] : [])],
                }).then((saved) => {
                  if (saved) {
                    setSelectedStudent(null);
                    setStudentSearch("");
                    setStudentOptions([]);
                  }
                });
              }}>
                <div className="guardian-picker-field">
                  <label htmlFor="guardian-link-guardian-search">Search guardian</label>
                  {selectedGuardian ? (
                    <div className="guardian-selected-option">
                      <span className="guardian-avatar" aria-hidden="true">{selectedGuardian.fullName.slice(0, 1).toUpperCase()}</span>
                      <span className="guardian-selected-copy"><strong>{selectedGuardian.fullName}</strong><small>{[selectedGuardian.email, selectedGuardian.phone].filter(Boolean).join(" · ") || "Guardian contact"}</small></span>
                      <button type="button" onClick={() => setSelectedGuardian(null)}>Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="guardian-picker-input">
                        <Search size={15} aria-hidden="true" />
                        <input
                          id="guardian-link-guardian-search"
                          value={guardianSearch}
                          onChange={(event) => {
                            setGuardianOptions([]);
                            setGuardianSearch(event.target.value);
                          }}
                          placeholder="Type a guardian name, email or phone"
                          autoComplete="off"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={guardianOptions.length > 0}
                          aria-controls="guardian-link-guardian-results"
                        />
                      </div>
                      {guardianSearching && <p className="guardian-picker-status" role="status">Searching guardians…</p>}
                      {!guardianSearching && guardianSearch.trim().length >= 2 && guardianOptions.length === 0 && !pickerError && (
                        <p className="guardian-picker-status">No matching guardian. Try another name or contact detail.</p>
                      )}
                      {!!guardianOptions.length && (
                        <div id="guardian-link-guardian-results" className="guardian-picker-results" role="listbox" aria-label="Matching guardians">
                          {guardianOptions.map((option) => (
                            <button type="button" role="option" aria-selected="false" key={option.id} onClick={() => {
                              setSelectedGuardian(option);
                              setGuardianSearch("");
                            }}>
                              <strong>{option.fullName}</strong>
                              <small>{[option.email, option.phone].filter(Boolean).join(" · ") || "No contact details"}</small>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <div className="guardian-picker-field">
                  <label htmlFor="guardian-link-student-search">Search student</label>
                  {selectedStudent ? (
                    <div className="guardian-selected-option">
                      <span className="guardian-avatar" aria-hidden="true">{selectedStudent.fullName.slice(0, 1).toUpperCase()}</span>
                      <span className="guardian-selected-copy"><strong>{selectedStudent.fullName}</strong><small>{[selectedStudent.admissionNumber && `Admission ${selectedStudent.admissionNumber}`, selectedStudent.grade, selectedStudent.className && `Class ${selectedStudent.className}`].filter(Boolean).join(" · ")}</small></span>
                      <button type="button" onClick={() => setSelectedStudent(null)}>Change</button>
                    </div>
                  ) : (
                    <>
                      <div className="guardian-picker-input">
                        <Search size={15} aria-hidden="true" />
                        <input
                          id="guardian-link-student-search"
                          value={studentSearch}
                          onChange={(event) => {
                            setStudentOptions([]);
                            setStudentSearch(event.target.value);
                          }}
                          placeholder="Type a student name or admission number"
                          autoComplete="off"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-expanded={studentOptions.length > 0}
                          aria-controls="guardian-link-student-results"
                        />
                      </div>
                      {studentSearching && <p className="guardian-picker-status" role="status">Searching students…</p>}
                      {!studentSearching && studentSearch.trim().length >= 2 && studentOptions.length === 0 && !pickerError && (
                        <p className="guardian-picker-status">No matching student. Try another name or admission number.</p>
                      )}
                      {!!studentOptions.length && (
                        <div id="guardian-link-student-results" className="guardian-picker-results" role="listbox" aria-label="Matching students">
                          {studentOptions.map((option) => (
                            <button type="button" role="option" aria-selected="false" key={option.id} onClick={() => {
                              setSelectedStudent(option);
                              setStudentSearch("");
                            }}>
                              <strong>{option.fullName}</strong>
                              <small>{[option.admissionNumber && `Admission ${option.admissionNumber}`, option.grade, option.className && `Class ${option.className}`].filter(Boolean).join(" · ")}</small>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <label className="field">Relationship to student<input required value={relationship} onChange={(event) => setRelationship(event.target.value)} /></label>
                <details className="guardian-optional-fields">
                  <summary>Account access options</summary>
                  <label className="field">Verified guardian account UID (optional)<input value={guardianUid} onChange={(event) => setGuardianUid(event.target.value)} /></label>
                  <label className="guardian-checkbox"><input type="checkbox" checked={homeworkAccess} onChange={(event) => setHomeworkAccess(event.target.checked)} />Allow this account to view homework and submission status</label>
                </details>
                {pickerError && <p className="login-error" role="alert">{pickerError}</p>}
                <button className="btn-secondary" type="submit" disabled={busy || !guardianId || !selectedStudent}>{busy ? "Saving…" : "Create student link"}</button>
              </form>
            </section>

            <section className="panel guardian-form-panel" id="parent-invite-form">
              <div className="panel-title">Invite this parent to the portal</div>
              <p className="panel-subtitle">Create a secure 14-day link for the selected guardian. The email must match the guardian record.</p>
              {selectedGuardian && selectedStudent ? (
                <div className="guardian-selected-option" style={{ marginBottom: 12 }}>
                  <span className="guardian-avatar" aria-hidden="true">{selectedGuardian.fullName.slice(0, 1).toUpperCase()}</span>
                  <span className="guardian-selected-copy"><strong>{selectedGuardian.fullName}</strong><small>{selectedStudent.fullName} · {selectedGuardian.email || "No email address"}</small></span>
                </div>
              ) : <p className="guardian-picker-status">Select a guardian and student above first.</p>}
              <button className="btn-primary" type="button" disabled={inviteBusy || !selectedGuardian || !selectedStudent} onClick={() => void createParentInvite()}>
                {inviteBusy ? "Creating secure link…" : "Create parent invite"}
              </button>
              {inviteUrl && <div className="invite-link-controls" style={{ marginTop: 12 }}><input aria-label="Parent invitation link" readOnly value={inviteUrl} /><button className="btn-secondary" type="button" onClick={() => void navigator.clipboard?.writeText(inviteUrl)}>Copy link</button></div>}
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
