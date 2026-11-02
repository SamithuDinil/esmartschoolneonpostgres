export function normalizeLogoUrl(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const host = url.hostname.replace(/^www\./, "");
  if (host === "drive.google.com" || host === "docs.google.com") {
    const id = url.pathname.match(/\/d\/([^/]+)/)?.[1] ?? url.searchParams.get("id");
    if (id) return `https://drive.google.com/thumbnail?id=${id}&sz=w256`;
  }
  if (host === "dropbox.com") {
    url.hostname = "dl.dropboxusercontent.com";
    url.searchParams.delete("dl");
    return url.toString();
  }
  if (host === "github.com" && url.pathname.includes("/blob/")) {
    return `https://raw.githubusercontent.com${url.pathname.replace("/blob/", "/")}`;
  }
  return url.toString();
}

export function schoolInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "S";
  const letters =
    words.length === 1
      ? words[0].slice(0, 2)
      : words
          .slice(0, 2)
          .map((word) => word[0])
          .join("");
  return letters.toUpperCase();
}
