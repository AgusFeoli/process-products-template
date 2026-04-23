"use server";

import {
  initializeMaestraDatabase,
  getMaestraProducts,
  getMaestraProductsByIds,
  updateMaestraCell,
  deleteMaestraRow,
  deleteAllMaestraRows,
  syncViewFromMaestra,
  syncAllViewsFromMaestra,
  getViewProducts,
  getViewProductsByIds,
  updateViewCell,
  dropViewTable,
  getKeywordCount,
  getSystemPrompt,
  saveSystemPrompt,
  getDefaultSystemPrompt,
  loadMaestraColumnMeta,
  loadMaestraIdentifierColumn,
  saveMaestraIdentifierColumn,
  loadMagentoConfig,
  saveMagentoConfig,
  type MaestraProduct,
  type MagentoProduct,
  type SeoKeyword,
  type ColumnMeta,
} from "@/lib/maestra-db";
import { manualDbColumn, type MagentoConfig } from "@/lib/magento-config";
export type { MaestraProduct, MagentoProduct, SeoKeyword, ColumnMeta };
export type {
  MagentoConfig,
  MagentoViewConfig,
  MagentoColumn,
  MagentoColumnSource,
} from "@/lib/magento-config";

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

// Fetch column metadata (dynamic columns from imported file)
export async function fetchColumnMeta(): Promise<ColumnMeta[] | null> {
  try {
    return await loadMaestraColumnMeta();
  } catch {
    return null;
  }
}

// Fetch the chosen identifier column (dbColumn) or null if none set
export async function fetchIdentifierColumn(): Promise<string | null> {
  try {
    return await loadMaestraIdentifierColumn();
  } catch {
    return null;
  }
}

// Save the chosen identifier column (dbColumn) or null to use the internal id
export async function updateIdentifierColumn(
  dbColumn: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    await saveMaestraIdentifierColumn(dbColumn);
    return { success: true };
  } catch (error) {
    console.error("Update identifier column error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save identifier column",
    };
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

// Export as CSV (uses dynamic column metadata from the imported file)
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

    // Load column metadata for export headers
    const columnMeta = await loadMaestraColumnMeta();

    // Escape a CSV field: wrap in quotes if it contains comma, quote, or newline
    const escapeCsvField = (val: string | number | null): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    if (columnMeta && columnMeta.length > 0) {
      // Use dynamic columns from the imported file
      const headerLine = columnMeta.map((m) => escapeCsvField(m.excelHeader)).join(",");
      const dataLines = data.map((row) => {
        return columnMeta
          .map((m) => {
            const value = (row as Record<string, unknown>)[m.dbColumn];
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
    }

    // Fallback: export all columns except system columns
    if (data.length > 0) {
      const allKeys = Object.keys(data[0]).filter(
        (k) => k !== "id" && k !== "created_at" && k !== "updated_at"
      );
      const headerLine = allKeys.map(escapeCsvField).join(",");
      const dataLines = data.map((row) => {
        return allKeys
          .map((k) => escapeCsvField((row as Record<string, unknown>)[k] as string | number | null))
          .join(",");
      });
      const csv = [headerLine, ...dataLines].join("\n");
      return {
        success: true,
        csv,
        filename: `maestra-export-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    }

    return { success: true, csv: "", filename: "maestra-export-empty.csv" };
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

// Sync and fetch magento products for a specific view
export async function fetchMagentoData(viewId: string): Promise<{
  success: boolean;
  data?: MagentoProduct[];
  count?: number;
  error?: string;
}> {
  try {
    await syncViewFromMaestra(viewId);
    const data = await getViewProducts(viewId);
    return { success: true, data, count: data.length };
  } catch (error) {
    console.error("Fetch magento data error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch magento data",
    };
  }
}

// Update a magento cell in a specific view's table
export async function updateMagentoField(
  viewId: string,
  id: number,
  columnName: string,
  value: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await updateViewCell(viewId, id, columnName, value);
    return { success: true };
  } catch (error) {
    console.error("Update magento cell error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update magento cell",
    };
  }
}

// Delete a view and its table
export async function deleteMagentoView(
  viewId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    await dropViewTable(viewId);
    return { success: true };
  } catch (error) {
    console.error("Delete magento view error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete view table",
    };
  }
}

// Fetch the full Magento export config (list of views)
export async function fetchMagentoConfig(): Promise<MagentoConfig> {
  try {
    return await loadMagentoConfig();
  } catch {
    return { views: [] };
  }
}

// Save the full Magento export config (list of views)
export async function updateMagentoConfig(
  config: MagentoConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    await saveMagentoConfig(config);
    return { success: true };
  } catch (error) {
    console.error("Save magento config error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save config",
    };
  }
}

// Export Magento CSV (semicolon-separated) for a given view
export async function exportMagentoCsv(
  viewId: string,
  productIds?: number[]
): Promise<{
  success: boolean;
  csv?: string;
  filename?: string;
  error?: string;
}> {
  try {
    await syncViewFromMaestra(viewId);
    const magentoData = productIds && productIds.length > 0
      ? await getViewProductsByIds(viewId, productIds)
      : await getViewProducts(viewId);
    const maestraData = await getMaestraProducts();
    const maestraMap = new Map(maestraData.map((p) => [p.id, p]));

    const config = await loadMagentoConfig();
    const view = config.views.find((v) => v.id === viewId);
    if (!view) {
      return { success: false, error: "Vista no encontrada" };
    }

    // Escape a CSV field for semicolon-separated format
    const escapeCsvField = (val: string | number | null): string => {
      if (val === null || val === undefined) return "";
      const str = String(val);
      if (str.includes(";") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const safeName = (view.name || "magento").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "magento";

    if (view.columns.length === 0) {
      return {
        success: true,
        csv: "",
        filename: `${safeName}-export-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    }

    const headerLine = view.columns.map((c) => escapeCsvField(c.name)).join(";");

    const dataLines = magentoData.map((mg) => {
      const maestra = maestraMap.get(mg.maestra_id);
      return view.columns
        .map((col) => {
          if (col.source.type === "fixed") {
            return escapeCsvField(col.source.value);
          }
          if (col.source.type === "maestra") {
            const v = maestra
              ? (maestra as unknown as Record<string, unknown>)[col.source.maestraColumn]
              : null;
            return escapeCsvField((v ?? null) as string | number | null);
          }
          // manual: read from magento_products using the per-view namespaced column name
          const dbCol = manualDbColumn(view.id, col.id);
          const v = (mg as unknown as Record<string, unknown>)[dbCol];
          return escapeCsvField((v ?? null) as string | number | null);
        })
        .join(";");
    });

    const csv = [headerLine, ...dataLines].join("\n");

    return {
      success: true,
      csv,
      filename: `${safeName}-export-${new Date().toISOString().slice(0, 10)}.csv`,
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
