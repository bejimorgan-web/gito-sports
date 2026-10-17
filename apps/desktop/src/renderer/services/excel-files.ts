import ExcelJS from "exceljs";

export type SpreadsheetRow = Record<string, string>;

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("hyperlink" in value) return value.hyperlink;
  }
  return String(value).trim();
}

export async function parseExcelFile(file: { arrayBuffer(): Promise<ArrayBuffer> }): Promise<SpreadsheetRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets.find((candidate) => candidate.rowCount > 0);
  if (!sheet) throw new Error("The Excel workbook has no data sheet.");
  const headerRow = sheet.getRow(1);
  const headers = Array.from({ length: headerRow.cellCount }, (_, index) =>
    cellText(headerRow.getCell(index + 1).value).trim().toLowerCase()
  );
  if (!headers.length || headers.some((header) => !header) || new Set(headers).size !== headers.length) {
    throw new Error("The Excel header row has a blank or duplicate column.");
  }
  const rows: SpreadsheetRow[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const sourceRow = sheet.getRow(rowNumber);
    const values = headers.map((_, index) => cellText(sourceRow.getCell(index + 1).value));
    if (!values.some((value) => value.trim())) continue;
    if (sourceRow.cellCount > headers.length && Array.from({ length: sourceRow.cellCount - headers.length }, (_, index) =>
      cellText(sourceRow.getCell(headers.length + index + 1).value)
    ).some((value) => value.trim())) {
      throw new Error(`Excel row ${rowNumber} has more cells than the header row.`);
    }
    rows.push(Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
  }
  return rows;
}

export function downloadExcel(filename: string, sheetName: string, title: string, headers: string[], rows: Array<Record<string, string | null | undefined>>, instructions: string) {
  void (async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "GiTO Live Sports";
    const sheet = workbook.addWorksheet(sheetName);
    sheet.addRow(headers);
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF183B56" } };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: headers.length } };
    for (const row of rows) sheet.addRow(headers.map((header) => row[header] ?? ""));
    headers.forEach((header, index) => { sheet.getColumn(index + 1).width = Math.max(16, Math.min(38, header.length + 5)); });
    const notes = workbook.addWorksheet("Instructions");
    notes.addRow([title]);
    notes.addRow(["How to use", instructions]);
    notes.addRow(["Upload", `Fill or edit the ${sheetName} sheet and upload this .xlsx workbook in GiTO Live Sports.`]);
    notes.getColumn(1).width = 22;
    notes.getColumn(2).width = 100;
    notes.getRow(1).font = { bold: true, size: 14 };
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer as ArrayBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  })();
}
