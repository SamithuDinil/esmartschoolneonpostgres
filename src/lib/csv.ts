export type ParsedCsv = {
  columns: string[];
  rows: Record<string, string>[];
  rowNumbers: number[];
  delimiter: string;
};

function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (const character of firstLine) {
      if (character === '"') quoted = !quoted;
      else if (character === candidate && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsvMatrix(input: string): { cells: string[][]; delimiter: string } {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const cells: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === delimiter) {
      row.push(value.trim());
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      cells.push(row);
      row = [];
      value = "";
    } else value += character;
  }
  if (value.length || row.length) {
    row.push(value.trim());
    cells.push(row);
  }
  return { cells, delimiter };
}

export function parseCsv(input: string): ParsedCsv {
  const { cells, delimiter } = parseCsvMatrix(input);
  const headerIndex = cells.findIndex((row) => row.some((cell) => cell !== ""));
  if (headerIndex < 0) return { columns: [], rows: [], rowNumbers: [], delimiter };
  const columns = cells[headerIndex].map((column) => column.trim());
  const rows: Record<string, string>[] = [];
  const rowNumbers: number[] = [];
  for (let index = headerIndex + 1; index < cells.length; index += 1) {
    const cellRow = cells[index];
    if (!cellRow.some((cell) => cell !== "")) continue;
    const record: Record<string, string> = {};
    columns.forEach((column, position) => {
      if (column) record[column] = cellRow[position] ?? "";
    });
    rows.push(record);
    rowNumbers.push(index + 1);
  }
  return { columns, rows, rowNumbers, delimiter };
}

export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) || text !== text.trim() ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  return (
    [
      columns.map(csvCell).join(","),
      ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
    ].join("\r\n") + "\r\n"
  );
}

export function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function canonicalizeRecord(
  record: Record<string, unknown>,
  canonical: readonly string[],
  aliases: Record<string, readonly string[]> = {},
): Record<string, string> {
  const lookup = new Map<string, string>();
  for (const name of canonical) {
    lookup.set(headerKey(name), name);
    for (const alias of aliases[name] ?? []) lookup.set(headerKey(alias), name);
  }
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const target = lookup.get(headerKey(key));
    const text =
      typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
    if (target) {
      if (!output[target]) output[target] = text;
    } else output[key] = text;
  }
  return output;
}

export function canonicalizeColumns(
  columns: readonly string[],
  canonical: readonly string[],
  aliases: Record<string, readonly string[]> = {},
): string[] {
  const lookup = new Map<string, string>();
  for (const name of canonical) {
    lookup.set(headerKey(name), name);
    for (const alias of aliases[name] ?? []) lookup.set(headerKey(alias), name);
  }
  return columns.map((column) => lookup.get(headerKey(column)) ?? column);
}

export function downloadTextFile(
  filename: string,
  content: string,
  type = "text/csv;charset=utf-8",
) {
  const blob = new Blob(["\uFEFF", content], { type });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}
