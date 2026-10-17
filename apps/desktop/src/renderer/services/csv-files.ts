export type CsvRow = Record<string, string>;

export function encodeCsv(headers: string[], rows: Array<Record<string, string | null | undefined>>) {
  const escape = (value: string | null | undefined) => {
    const text = value ?? "";
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `\uFEFF${[headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))]
    .map((cells) => cells.map((cell) => escape(cell)).join(","))
    .join("\r\n")}\r\n`;
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Record<string, string | null | undefined>>) {
  const blob = new Blob([encodeCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function parseCsvFile(file: { text(): Promise<string> }): Promise<CsvRow[]> {
  const text = (await file.text()).replace(/^\uFEFF/, "");
  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) matrix.push(row);
      row = [];
    } else cell += char;
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted field.");
  if (cell.length || row.length) { row.push(cell); if (row.some((value) => value.trim())) matrix.push(row); }
  if (!matrix.length) throw new Error("The CSV file is empty.");
  const headers = (matrix[0] ?? []).map((header) => header.trim().toLowerCase());
  if (headers.some((header) => !header) || new Set(headers).size !== headers.length) throw new Error("The CSV header row has a blank or duplicate column.");
  return matrix.slice(1).map((values, index) => {
    if (values.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${values.length} columns; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, (values[column] ?? "").trim()]));
  });
}

export function normalizeCsvName(name: string) {
  return name.trim().normalize("NFKC").toLocaleLowerCase();
}
