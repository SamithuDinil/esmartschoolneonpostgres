"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ padding: 40, maxWidth: 520, margin: "60px auto", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ color: "#556", lineHeight: 1.5 }}>
        The page failed to load. You can retry, go home, or open school setup.
      </p>
      {error?.digest ? (
        <p style={{ fontSize: 12, color: "#889", marginTop: 12 }}>Digest: {error.digest}</p>
      ) : null}
      <div style={{ display: "flex", gap: 16, marginTop: 24 }}>
        <button type="button" onClick={() => reset()}>
          Try again
        </button>
        <a href="/dashboard">Dashboard</a>
        <a href="/setup">Setup</a>
        <Link href="/">Home</Link>
      </div>
    </main>
  );
}
