import "server-only";

type SameSite = "lax" | "strict" | "none";

function sameSite(): SameSite {
  const value = process.env.COOKIE_SAMESITE?.toLowerCase();
  if (value === "strict" || value === "none") return value;
  return "lax";
}

export function cookieOptions(maxAge: number) {
  const policy = sameSite();
  return {
    httpOnly: true,
    secure: policy === "none" || process.env.NODE_ENV === "production",
    sameSite: policy,
    path: "/",
    maxAge,
  };
}
