"use client";
import { useEffect } from "react";
import { Languages } from "lucide-react";
import { fetchCsrfToken } from "@/lib/firebase/session-client";
import { useI18n, type Language } from "@/lib/i18n/useI18n";
export function LanguageSwitcher() {
  const { language, setLanguage, languageLabels } = useI18n();
  useEffect(() => {
    void fetch("/api/preferences", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json();
      if (body.language && body.language !== language) setLanguage(body.language as Language);
    });
  }, [language, setLanguage]);
  async function change(next: Language) {
    setLanguage(next);
    try {
      const csrf = await fetchCsrfToken();
      await fetch("/api/preferences", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ language: next }),
      });
    } catch {
      /* local preference remains available if the account request is unavailable */
    }
  }
  return (
    <label className="language-switcher">
      <Languages size={14} />
      <span className="sr-only">Language</span>
      <select
        aria-label="Language"
        value={language}
        onChange={(event) => void change(event.target.value as Language)}
      >
        {(Object.keys(languageLabels) as Language[]).map((key) => (
          <option key={key} value={key}>
            {languageLabels[key]}
          </option>
        ))}
      </select>
    </label>
  );
}
