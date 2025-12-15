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
import { CSV_COLUMN_MAP, CSV_EXPORT_ORDER } from "@/lib/column-mapping";

// Re-export types for components
export type { TableData, TableColumn };

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

// Import CSV and append to existing table
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

    const content = await file.text();
    const lines = content.split(/\r?\n/).filter((line) => line.trim());

    if (lines.length < 2) {
      return {
        success: false,
        error: "CSV file must have headers and at least one data row",
      };
    }

    // Parse headers from CSV
    const csvHeaders = parseCsvLine(lines[0]);

    // Map CSV headers to DB column names
    const dbHeaders = csvHeaders.map((header) => {
      const trimmed = header.trim();
      return CSV_COLUMN_MAP[trimmed] || trimmed.toLowerCase().replace(/\s+/g, "_");
    });

    // Parse data rows with mapped column names
    const rows: Record<string, string>[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = parseCsvLine(lines[i]);
      const row: Record<string, string> = {};
      for (let j = 0; j < dbHeaders.length; j++) {
        row[dbHeaders[j]] = values[j] || "";
      }
      rows.push(row);
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
      error: error instanceof Error ? error.message : "Failed to import CSV",
    };
  }
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

// Export table data as CSV
export async function exportCsv(): Promise<{
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}> {
  try {
    const data = await getTableDataFromDb();

    // Use fixed Spanish column order for export
    const csvLines: string[] = [CSV_EXPORT_ORDER.join(",")];

    // Map DB column names to the fixed export order
    const dbColumnsInOrder = CSV_EXPORT_ORDER.map(
      (csvHeader) => CSV_COLUMN_MAP[csvHeader]
    );

    // Build CSV rows using the fixed column order
    for (const row of data.rows) {
      const values = dbColumnsInOrder.map((dbCol) => {
        const value = row[dbCol];
        if (value === null || value === undefined) return "";
        const strValue = String(value);
        // Escape quotes and wrap in quotes if contains comma or quote
        if (strValue.includes(",") || strValue.includes('"') || strValue.includes("\n")) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return strValue;
      });
      csvLines.push(values.join(","));
    }

    return {
      success: true,
      csv: csvLines.join("\n"),
      filename: `${data.tableName}-export.csv`,
    };
  } catch (error) {
    console.error("Export error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to export CSV",
    };
  }
}
