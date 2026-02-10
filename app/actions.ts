"use server";

import {
  initializeDatabase,
  getTableData as getTableDataFromDb,
  insertRows,
  updateCell as updateCellFromDb,
  deleteRow as deleteRowFromDb,
  deleteAllRows as deleteAllRowsFromDb,
  type TableData,
  type TableColumn,
} from "@/lib/db";
import { CSV_COLUMN_MAP, XLSX_EXPORT_ORDER } from "@/lib/column-mapping";
import * as XLSX from "xlsx";

// Re-export types for components
export type { TableData, TableColumn };

// Check database connection status
export async function checkConnection(): Promise<{
  connected: boolean;
  tableExists: boolean;
  tableName: string;
}> {
  try {
    return await initializeDatabase();
  } catch (error) {
    console.error("Connection check error:", error);
    return { connected: false, tableExists: false, tableName: "products" };
  }
}

// Fetch table data from the existing PostgreSQL table
export async function fetchTableData(): Promise<{
  success: boolean;
  data?: TableData;
  error?: string;
}> {
  try {
    const data = await getTableDataFromDb();
    return { success: true, data };
  } catch (error) {
    console.error("Fetch table data error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch data",
    };
  }
}

// Import XLSX/CSV and append to existing table
export async function importCsv(
  formData: FormData
): Promise<{
  success: boolean;
  inserted?: number;
  errors?: string[];
  error?: string;
}> {
  try {
    const file = formData.get("file") as File;
    if (!file) {
      return { success: false, error: "No file provided" };
    }

    const fileName = file.name.toLowerCase();
    let rows: Record<string, string>[] = [];

    if (fileName.endsWith(".xlsx") || fileName.endsWith(".xls")) {
      // Parse Excel file
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const workbook = XLSX.read(uint8, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const data = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
        header: 1,
        defval: null,
      });

      if (data.length < 2) {
        return {
          success: false,
          error: "El archivo debe tener encabezados y al menos una fila de datos",
        };
      }

      // Parse headers from first row
      const excelHeaders = (data[0] as (string | number | null)[]).map((h) => String(h ?? "").trim());

      // Map Excel headers to DB column names
      const dbHeaders = excelHeaders.map((header) => {
        return CSV_COLUMN_MAP[header] || header.toLowerCase().replace(/\s+/g, "_");
      });

      // Parse data rows
      for (let i = 1; i < data.length; i++) {
        const values = data[i] as (string | number | null)[];
        if (!values || values.length === 0 || values.every((v) => v === null || v === undefined || v === "")) {
          continue; // Skip empty rows
        }
        const row: Record<string, string> = {};
        for (let j = 0; j < dbHeaders.length; j++) {
          const val = values[j];
          row[dbHeaders[j]] = val !== null && val !== undefined ? String(val) : "";
        }
        rows.push(row);
      }
    } else {
      // Fallback: Parse as CSV
      const content = await file.text();
      const lines = content.split(/\r?\n/).filter((line) => line.trim());

      if (lines.length < 2) {
        return {
          success: false,
          error: "CSV file must have headers and at least one data row",
        };
      }

      const csvHeaders = parseCsvLine(lines[0]);
      const dbHeaders = csvHeaders.map((header) => {
        const trimmed = header.trim();
        return CSV_COLUMN_MAP[trimmed] || trimmed.toLowerCase().replace(/\s+/g, "_");
      });

      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        const row: Record<string, string> = {};
        for (let j = 0; j < dbHeaders.length; j++) {
          row[dbHeaders[j]] = values[j] || "";
        }
        rows.push(row);
      }
    }

    if (rows.length === 0) {
      return { success: false, error: "No se encontraron filas de datos en el archivo" };
    }

    // Insert rows into database
    const result = await insertRows(rows);

    return {
      success: true,
      inserted: result.inserted,
      errors: result.errors.length > 0 ? result.errors : undefined,
    };
  } catch (error) {
    console.error("Import error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to import file",
    };
  }
}

// Helper function to parse CSV line handling quoted values
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
  }

  result.push(current.trim());
  return result;
}

// Update a cell value
export async function updateCell(
  primaryKeyValue: string | number,
  columnName: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateCellFromDb(primaryKeyValue, columnName, value);
    return { success: true };
  } catch (error) {
    console.error("Update cell error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update cell",
    };
  }
}

// Delete a row
export async function deleteRow(
  primaryKeyValue: string | number
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteRowFromDb(primaryKeyValue);
    return { success: true };
  } catch (error) {
    console.error("Delete row error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete row",
    };
  }
}

// Delete all rows
export async function deleteAllRows(): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
  try {
    const result = await deleteAllRowsFromDb();
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error("Delete all rows error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete all rows",
    };
  }
}

// Export table data as XLSX
export async function exportXlsx(): Promise<{
  success: boolean;
  base64?: string;
  filename?: string;
  error?: string;
}> {
  try {
    const data = await getTableDataFromDb();

    // Map DB column names to the fixed export order
    const dbColumnsInOrder = XLSX_EXPORT_ORDER.map(
      (xlsxHeader) => CSV_COLUMN_MAP[xlsxHeader]
    );

    // Build rows for XLSX
    const xlsxRows: (string | number | boolean | null)[][] = [];

    for (const row of data.rows) {
      const values = dbColumnsInOrder.map((dbCol) => {
        const value = row[dbCol];
        if (value === null || value === undefined) return null;
        return value;
      });
      xlsxRows.push(values);
    }

    // Create workbook
    const wb = XLSX.utils.book_new();
    const wsData = [XLSX_EXPORT_ORDER, ...xlsxRows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths for better readability
    const colWidths = XLSX_EXPORT_ORDER.map((header) => {
      if (header === "Descripción e-Shop") return { wch: 80 };
      if (header === "Descripción" || header === "Composición") return { wch: 40 };
      if (header === "Modelo") return { wch: 20 };
      if (header === "Proveedor") return { wch: 12 };
      return { wch: 15 };
    });
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "Hoja1");

    // Write to buffer and convert to base64
    const buffer = XLSX.write(wb, { type: "base64", bookType: "xlsx" });

    return {
      success: true,
      base64: buffer,
      filename: `${data.tableName}-export.xlsx`,
    };
  } catch (error) {
    console.error("Export error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to export XLSX",
    };
  }
}

// Keep old exportCsv for backward compatibility (now exports XLSX)
export async function exportCsv(): Promise<{
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}> {
  // Redirect to XLSX export
  const result = await exportXlsx();
  if (result.success && result.base64) {
    return {
      success: true,
      csv: result.base64,
      filename: result.filename,
    };
  }
  return { success: false, error: result.error };
}
