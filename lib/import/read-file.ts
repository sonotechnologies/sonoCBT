import "server-only";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";

export class FileReadError extends Error {}

const MAX_BYTES = 3_000_000;

/** Reads the first sheet of an .xlsx, or a .csv, into rows of cells. */
export async function readSpreadsheet(file: File): Promise<unknown[][]> {
  if (file.size > MAX_BYTES) throw new FileReadError("That file is too large. Split it into smaller lists (under 3 MB).");
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || file.type === "text/csv") {
    const text = (await file.text()).replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    return parsed.data;
  }
  if (name.endsWith(".xlsx")) {
    try {
      return (await readSheet(Buffer.from(await file.arrayBuffer()))) as unknown[][];
    } catch {
      throw new FileReadError("We couldn't open that Excel file. Try saving it again as .xlsx or .csv.");
    }
  }
  if (name.endsWith(".xls")) throw new FileReadError("That's an old Excel format. In Excel, choose Save As → Excel Workbook (.xlsx), then upload again.");
  throw new FileReadError("Upload an Excel (.xlsx) or CSV file.");
}
