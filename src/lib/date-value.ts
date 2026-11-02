export function dateFromValue(value: unknown): Date | null {
  let date: Date | null = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "string" || typeof value === "number") {
    date = new Date(value);
  } else if (value && typeof value === "object") {
    const timestamp = value as {
      toDate?: () => unknown;
      toMillis?: () => unknown;
      seconds?: unknown;
      _seconds?: unknown;
    };
    try {
      if (typeof timestamp.toDate === "function") {
        const parsed = timestamp.toDate();
        if (parsed instanceof Date) date = parsed;
      } else if (typeof timestamp.toMillis === "function") {
        const millis = timestamp.toMillis();
        if (typeof millis === "number") date = new Date(millis);
      } else {
        const seconds = typeof timestamp.seconds === "number"
          ? timestamp.seconds
          : timestamp._seconds;
        if (typeof seconds === "number") date = new Date(seconds * 1000);
      }
    } catch {
      return null;
    }
  }
  return date && Number.isFinite(date.getTime()) ? date : null;
}

export function isFutureDate(value: unknown, now = Date.now()): boolean {
  const date = dateFromValue(value);
  return date !== null && date.getTime() > now;
}
