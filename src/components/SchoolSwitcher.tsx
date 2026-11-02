"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { normalizeLogoUrl, schoolInitials } from "@/lib/logo-url";

type School = { id: string; name: string; role: string; isActive: boolean; logoUrl?: string };

function SchoolMark({ name, logoUrl }: { name: string; logoUrl?: string }) {
  const [failed, setFailed] = useState(false);
  const src = normalizeLogoUrl(logoUrl);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed)
    return (
      <img
        className="school-avatar-image"
        src={src}
        alt=""
        width={88}
        height={88}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  return (
    <span className="school-avatar-fallback" aria-hidden="true">
      {schoolInitials(name)}
    </span>
  );
}

export function SchoolSwitcher({ schoolName }: { schoolName: string }) {
  const [schools, setSchools] = useState<School[]>([]);
  const [current, setCurrent] = useState<School | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const activeSchool = schools.find((school) => school.isActive) ?? current ?? undefined;
  const activeName = activeSchool?.name || schoolName;

  useEffect(() => {
    let mounted = true;
    void fetch("/api/schools", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const data = (await response.json()) as { schools?: School[]; activeSchool?: School | null };
        if (!mounted) return;
        setSchools(data.schools ?? []);
        setCurrent(data.activeSchool ?? null);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  async function switchSchool(schoolId: string) {
    setBusy(true);
    setError("");
    try {
      const csrf = await fetchCsrfToken();
      const response = await fetch("/api/schools", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "switch", schoolId }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "School switch failed.");
      window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "School switch failed.");
      setBusy(false);
    }
  }

  const identity = (
    <>
      <SchoolMark name={activeName} logoUrl={activeSchool?.logoUrl} />
      <span className="school-switcher-copy">
        <strong className="school-name" title={activeName}>
          {activeName}
        </strong>
        <small className="school-meta">Active school{schools.length > 1 ? " · Switch" : ""}</small>
      </span>
    </>
  );

  return (
    <div className={`school-switcher ${schools.length > 1 ? "is-switchable" : ""}`} ref={rootRef}>
      {schools.length > 1 ? (
        <button
          className="school-chip school-switcher-trigger"
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={`Active school: ${activeName}. Switch school`}
        >
          {identity}
          {busy ? <Loader2 className="spin" size={15} /> : <ChevronDown size={15} />}
        </button>
      ) : (
        <div
          className="school-chip school-switcher-trigger"
          aria-label={`Active school: ${activeName}`}
        >
          {identity}
        </div>
      )}
      {open && schools.length > 1 && (
        <div className="school-switcher-menu" aria-label="Switch school">
          {schools.map((school) => (
            <button
              key={school.id}
              type="button"
              className="school-option"
              onClick={() => void switchSchool(school.id)}
              disabled={busy || school.isActive}
              aria-current={school.isActive ? "true" : undefined}
            >
              <SchoolMark name={school.name} logoUrl={school.logoUrl} />
              <span>
                <strong>{school.name}</strong>
                <small>
                  {school.role.replaceAll("_", " ")}
                  {school.isActive ? " · Current" : ""}
                </small>
              </span>
              {school.isActive && <Check size={14} aria-hidden="true" />}
            </button>
          ))}
          {error && (
            <div className="school-switcher-error" role="alert">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
