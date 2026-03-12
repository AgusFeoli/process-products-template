"use server";

import {
  initializeMaestraDatabase,
  getMaestraProducts,
  getMaestraProductsByIds,
  getMaestraCount,
  updateMaestraCell,
  deleteMaestraRow,
  deleteAllMaestraRows,
  syncMagentoFromMaestra,
  getMagentoProducts,
  getMagentoProductsByIds,
  updateMagentoCell,
  getKeywordCount,
  getSystemPrompt,
  saveSystemPrompt,
  getDefaultSystemPrompt,
  type MaestraProduct,
  type MagentoProduct,
  type SeoKeyword,
  MAESTRA_COLUMN_MAP,
  MAESTRA_EXPORT_ORDER,
} from "@/lib/maestra-db";
import {
  MAGENTO_CSV_COLUMNS,
  MAGENTO_FIXED_VALUES,
  MAGENTO_MAESTRA_MAPPED_FIELDS,
} from "@/lib/magento-columns";
export type { MaestraProduct, MagentoProduct, SeoKeyword };

// Check database connection
export async function checkConnection(): Promise<{
  connected: boolean;
  tableExists: boolean;
}> {
  try {
    return await initializeMaestraDatabase();
  } catch (error) {
    console.error("Connection check error:", error);
    return { connected: false, tableExists: false };
  }
}

// Fetch all maestra products
export async function fetchMaestraData(): Promise<{
  success: boolean;
  data?: MaestraProduct[];
  count?: number;
  error?: string;
}> {
  try {
    const data = await getMaestraProducts();
    return { success: true, data, count: data.length };
  } catch (error) {
    console.error("Fetch maestra data error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch data",
    };
  }
}

// Get row count
export async function fetchMaestraCount(): Promise<number> {
  try {
    return await getMaestraCount();
  } catch {
    return 0;
  }
}

// Update a cell
export async function updateCell(
  id: number,
  columnName: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateMaestraCell(id, columnName, value);
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
  id: number
): Promise<{ success: boolean; error?: string }> {
  try {
    await deleteMaestraRow(id);
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
export async function deleteAllRows(): Promise<{
  success: boolean;
  deletedCount?: number;
  error?: string;
}> {
  try {
    const result = await deleteAllMaestraRows();
    return { success: true, deletedCount: result.deletedCount };
  } catch (error) {
    console.error("Delete all rows error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete all rows",
    };
  }
}

// Export as CSV
export async function exportCsv(productIds?: number[]): Promise<{
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}> {
  try {
    const data = productIds && productIds.length > 0
      ? await getMaestraProductsByIds(productIds)
      : await getMaestraProducts();

    // Map DB columns to export order
    const dbColumnsInOrder = MAESTRA_EXPORT_ORDER.map(
      (xlsxHeader) => MAESTRA_COLUMN_MAP[xlsxHeader]
    );

    // Escape a CSV field: wrap in quotes if it contains comma, quote, or newline
    const escapeCsvField = (val: string | number | null): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Build CSV string
    const headerLine = MAESTRA_EXPORT_ORDER.map(escapeCsvField).join(",");
    const dataLines = data.map((row) => {
      return dbColumnsInOrder
        .map((dbCol) => {
          const value = (row as unknown as Record<string, unknown>)[dbCol];
          return escapeCsvField(value as string | number | null);
        })
        .join(",");
    });

    const csv = [headerLine, ...dataLines].join("\n");

    return {
      success: true,
      csv,
      filename: `maestra-export-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  } catch (error) {
    console.error("Export error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to export CSV",
    };
  }
}

// ============================================
// Magento actions
// ============================================

// Sync magento products from maestra and fetch them
export async function fetchMagentoData(): Promise<{
  success: boolean;
  data?: MagentoProduct[];
  count?: number;
  error?: string;
}> {
  try {
    await syncMagentoFromMaestra();
    const data = await getMagentoProducts();
    return { success: true, data, count: data.length };
  } catch (error) {
    console.error("Fetch magento data error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch magento data",
    };
  }
}

// Update a magento cell
export async function updateMagentoField(
  id: number,
  columnName: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateMagentoCell(id, columnName, value);
    return { success: true };
  } catch (error) {
    console.error("Update magento cell error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update magento cell",
    };
  }
}

// Export Magento CSV (semicolon-separated)
export async function exportMagentoCsv(productIds?: number[]): Promise<{
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}> {
  try {
    await syncMagentoFromMaestra();
    const magentoData = productIds && productIds.length > 0
      ? await getMagentoProductsByIds(productIds)
      : await getMagentoProducts();
    const maestraData = await getMaestraProducts();
    const maestraMap = new Map(maestraData.map((p) => [p.id, p]));

    // Escape a CSV field for semicolon-separated format
    const escapeCsvField = (val: string | number | null): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(";") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Header line
    const headerLine = MAGENTO_CSV_COLUMNS.join(";");

    // Data lines
    const dataLines = magentoData.map((mg) => {
      const maestra = maestraMap.get(mg.maestra_id);
      const row: Record<string, string | number | null> = {};

      for (const col of MAGENTO_CSV_COLUMNS) {
        // Fixed values
        if (col in MAGENTO_FIXED_VALUES) {
          row[col] = MAGENTO_FIXED_VALUES[col];
        }
        // Mapped from maestra
        else if (col in MAGENTO_MAESTRA_MAPPED_FIELDS && maestra) {
          const maestraCol = MAGENTO_MAESTRA_MAPPED_FIELDS[col];
          row[col] = (maestra as unknown as Record<string, unknown>)[maestraCol] as string | number | null;
        }
        // From magento table (AI-generated or user-edited)
        else {
          row[col] = ((mg as unknown as Record<string, unknown>)[col] as string | number | null) ?? null;
        }
      }

      return MAGENTO_CSV_COLUMNS.map((col) => escapeCsvField(row[col] ?? null)).join(";");
    });

    const csv = [headerLine, ...dataLines].join("\n");

    return {
      success: true,
      csv,
      filename: `magento-export-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  } catch (error) {
    console.error("Export magento error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to export Magento CSV",
    };
  }
}

// ============================================
// Keywords actions
// ============================================

export async function fetchKeywordStatus(): Promise<{
  loaded: boolean;
  count: number;
}> {
  try {
    const count = await getKeywordCount();
    return { loaded: count > 0, count };
  } catch {
    return { loaded: false, count: 0 };
  }
}

// ============================================
// System Prompt actions
// ============================================

export async function fetchSystemPrompt(): Promise<string> {
  try {
    return await getSystemPrompt();
  } catch {
    return getDefaultSystemPrompt();
  }
}

export async function updateSystemPrompt(
  prompt: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await saveSystemPrompt(prompt);
    return { success: true };
  } catch (error) {
    console.error("Update system prompt error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save prompt",
    };
  }
}

export async function resetSystemPrompt(): Promise<{
  success: boolean;
  prompt: string;
  error?: string;
}> {
  try {
    const defaultPrompt = getDefaultSystemPrompt();
    await saveSystemPrompt(defaultPrompt);
    return { success: true, prompt: defaultPrompt };
  } catch (error) {
    console.error("Reset system prompt error:", error);
    return {
      success: false,
      prompt: getDefaultSystemPrompt(),
      error: error instanceof Error ? error.message : "Failed to reset prompt",
    };
  }
}
