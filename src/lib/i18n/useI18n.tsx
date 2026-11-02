"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { languageLabels, languages, messages, type Language } from "./messages";
export function useI18n() {
  const [language, setLanguageState] = useState<Language>("en");
  useEffect(() => {
    const stored = window.localStorage.getItem("edusphere-language");
    if (stored && languages.includes(stored as Language)) setLanguageState(stored as Language);
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<Language>).detail;
      if (languages.includes(next)) setLanguageState(next);
    };
    window.addEventListener("edusphere:language", onChange);
    return () => window.removeEventListener("edusphere:language", onChange);
  }, []);
  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    window.localStorage.setItem("edusphere-language", next);
    document.documentElement.lang = next === "si" ? "si-LK" : next === "ta" ? "ta-LK" : "en";
    window.dispatchEvent(new CustomEvent("edusphere:language", { detail: next }));
  }, []);
  const t = useMemo(
    () => (key: keyof typeof messages.en) => messages[language][key] ?? messages.en[key],
    [language],
  );
  return { language, setLanguage, t, languageLabels };
}
export type { Language };
