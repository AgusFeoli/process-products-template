// Configurable Magento-style export schema.
// The user can create multiple export "views" (each with its own columns),
// rename each view's button, and associate columns with maestra columns,
// fixed values, or leave them as manual (editable per row).

export type MagentoColumnSource =
  | { type: "maestra"; maestraColumn: string }
  | { type: "fixed"; value: string }
  | { type: "manual" };

export interface MagentoColumn {
  /** Stable ID used (via sanitizeColumnId) as the DB column name for "manual" columns */
  id: string;
  /** Header label used in the CSV export and UI */
  name: string;
  /** Where the value comes from */
  source: MagentoColumnSource;
}

export interface MagentoViewConfig {
  /** Stable view id (also used to namespace DB columns for manual sources) */
  id: string;
  /** User-facing name for the view/tab */
  name: string;
  /** Label shown on the export button */
  buttonLabel: string;
  /** Ordered list of columns */
  columns: MagentoColumn[];
}

export interface MagentoConfig {
  /** Ordered list of export views */
  views: MagentoViewConfig[];
}

export const DEFAULT_MAGENTO_CONFIG: MagentoConfig = {
  views: [],
};

/** Build a default view with a unique id. */
export function createDefaultView(index = 1): MagentoViewConfig {
  return {
    id: generateViewId(),
    name: `Magento ${index}`,
    buttonLabel: "Exportar Magento",
    columns: [],
  };
}

/** Generate a stable, DB-safe identifier for a column. */
export function generateColumnId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `col_${ts}_${rand}`;
}

/** Generate a stable, DB-safe identifier for a view. */
export function generateViewId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString(36);
  return `view_${ts}_${rand}`;
}

/** Sanitize an identifier to be a safe SQL identifier (lowercase a-z0-9_, max 63). */
export function sanitizeColumnId(id: string): string {
  const safe = id
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 63);
  return safe || "col";
}

/**
 * Build the DB column name for a manual column inside a given view.
 * Each view now has its own table, so we no longer need the viewId prefix.
 * The column name is simply `c_{sanitized_colId}`.
 * For backwards-compat the function still accepts viewId but ignores it.
 */
export function manualDbColumn(_viewId: string, columnId: string): string {
  const c = sanitizeColumnId(columnId);
  const combined = `c_${c}`;
  if (combined.length <= 63) return combined;
  return combined.substring(0, 63);
}

/**
 * Legacy column name format used when all views shared a single table.
 * Used during migration to read old data from `magento_products`.
 */
export function legacyManualDbColumn(viewId: string, columnId: string): string {
  const v = sanitizeColumnId(viewId);
  const c = sanitizeColumnId(columnId);
  const combined = `v_${v}_${c}`;
  if (combined.length <= 63) return combined;
  return combined.substring(0, 63);
}

/** PostgreSQL table name for a given view. */
export function viewTableName(viewId: string): string {
  const safe = sanitizeColumnId(viewId);
  return `magento_${safe}`;
}
