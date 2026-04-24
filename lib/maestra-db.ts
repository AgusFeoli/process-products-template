import { getSql } from "./pg-client";
import {
  type ColumnMeta,
  type MaestraProduct,
  buildColumnMeta,
  MAESTRA_COLUMN_MAP,
} from "./maestra-columns";
import type { MagentoProduct } from "./magento-columns";
import {
  type MagentoConfig,
  type MagentoViewConfig,
  DEFAULT_MAGENTO_CONFIG,
  manualDbColumn,
  legacyManualDbColumn,
  viewTableName,
} from "./magento-config";

// Re-export from maestra-columns for server-side convenience
export {
  MAESTRA_COLUMN_MAP,
  getMaestraDisplayName,
  buildColumnMeta,
  type ColumnMeta,
  type MaestraProduct,
} from "./maestra-columns";

export type { MagentoProduct } from "./magento-columns";

const MAESTRA_TABLE = "maestra_products";

// ============================================
// Column Metadata persistence (app_settings)
// ============================================

/** Save column metadata to app_settings */
export async function saveMaestraColumnMeta(meta: ColumnMeta[]): Promise<void> {
  const sql = getSql();
  await ensureSettingsTable();
  const now = new Date().toISOString();
  const value = JSON.stringify(meta);
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('maestra_column_meta', ${value}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = ${now}
  `;
}

/** Load column metadata from app_settings. Returns null if no metadata stored yet. */
export async function loadMaestraColumnMeta(): Promise<ColumnMeta[] | null> {
  const sql = getSql();
  await ensureSettingsTable();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'maestra_column_meta'`;
  if (rows.length === 0) return null;
  try {
    return JSON.parse(rows[0].value as string) as ColumnMeta[];
  } catch {
    return null;
  }
}

/**
 * Save the chosen identifier column (dbColumn name) to app_settings.
 * Passing null clears the setting, which means the internal id will be used.
 */
export async function saveMaestraIdentifierColumn(dbColumn: string | null): Promise<void> {
  const sql = getSql();
  await ensureSettingsTable();
  const now = new Date().toISOString();
  if (dbColumn === null) {
    await sql`DELETE FROM app_settings WHERE key = 'maestra_identifier_column'`;
    return;
  }
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('maestra_identifier_column', ${dbColumn}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = ${dbColumn}, updated_at = ${now}
  `;
}

/**
 * Load the chosen identifier column (dbColumn name) from app_settings.
 * Returns null when the user explicitly chose "none" or never picked one —
 * callers should fall back to the internal row id in that case.
 */
export async function loadMaestraIdentifierColumn(): Promise<string | null> {
  const sql = getSql();
  await ensureSettingsTable();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'maestra_identifier_column'`;
  if (rows.length === 0) return null;
  const value = rows[0].value;
  if (typeof value !== "string" || value.trim() === "") return null;
  return value;
}

// Create or ensure the maestra table exists with base columns (id, created_at, updated_at).
// Data columns are added dynamically when importing.
export async function ensureMaestraTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS maestra_products (
      id SERIAL PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

/** Ensure all columns from the metadata exist in the table. Adds missing columns as TEXT. */
export async function ensureMaestraColumns(meta: ColumnMeta[]): Promise<void> {
  const sql = getSql();
  await ensureMaestraTable();
  for (const col of meta) {
    try {
      await sql(`ALTER TABLE ${MAESTRA_TABLE} ADD COLUMN IF NOT EXISTS "${col.dbColumn}" TEXT`);
    } catch (err) {
      // Only ignore "column already exists" type errors; propagate anything else
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("already exists")) {
        // Column already exists — safe to ignore
      } else {
        console.error(`Failed to add column "${col.dbColumn}" to ${MAESTRA_TABLE}:`, err);
        throw err;
      }
    }
  }
}

// Get all maestra products
export async function getMaestraProducts(): Promise<MaestraProduct[]> {
  const sql = getSql();
  await ensureMaestraTable();
  const rows = await sql`SELECT * FROM maestra_products ORDER BY id`;
  return rows as unknown as MaestraProduct[];
}

// Get maestra products by IDs
export async function getMaestraProductsByIds(ids: number[]): Promise<MaestraProduct[]> {
  if (ids.length === 0) return [];
  const sql = getSql();
  await ensureMaestraTable();
  const rows = await sql`SELECT * FROM maestra_products WHERE id = ANY(${ids}) ORDER BY id`;
  return rows as unknown as MaestraProduct[];
}

// Insert rows in bulk (dynamic columns from row keys)
export async function insertMaestraRows(
  rows: Record<string, string | number | null>[],
  columnMeta?: ColumnMeta[]
): Promise<{ inserted: number; errors: string[] }> {
  if (rows.length === 0) {
    return { inserted: 0, errors: [] };
  }

  const sql = getSql();
  await ensureMaestraTable();

  // Determine column order: use columnMeta if provided, otherwise derive from row keys
  const columns = columnMeta
    ? columnMeta.map((m) => m.dbColumn)
    : Object.keys(rows[0]).filter((k) => k !== "id" && k !== "created_at" && k !== "updated_at");

  const now = new Date().toISOString();

  let inserted = 0;
  const errors: string[] = [];

  // Process in batches of 100 rows using multi-row INSERT
  const BATCH_SIZE = 100;
  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);

    // Build a multi-row INSERT using parameterized values
    const allCols = [...columns, "created_at", "updated_at"];

    const valuePlaceholders: string[] = [];
    const params: (string | number | null)[] = [];

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const rowPlaceholders: string[] = [];
      for (let j = 0; j < columns.length; j++) {
        const col = columns[j];
        const val = row[col];
        const finalVal: string | number | null =
          val !== null && val !== undefined && val !== "" ? val : null;
        params.push(finalVal);
        rowPlaceholders.push(`$${params.length}`);
      }
      // created_at
      params.push(now);
      rowPlaceholders.push(`$${params.length}`);
      // updated_at
      params.push(now);
      rowPlaceholders.push(`$${params.length}`);

      valuePlaceholders.push(`(${rowPlaceholders.join(", ")})`);
    }

    const quotedCols = allCols.map((c) => `"${c}"`).join(", ");
    const query = `INSERT INTO ${MAESTRA_TABLE} (${quotedCols}) VALUES ${valuePlaceholders.join(", ")}`;

    try {
      await sql(query, params);
      inserted += batch.length;
    } catch (error) {
      // If batch insert fails, try individual rows
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        try {
          const rowParams: (string | number | null)[] = [];
          const rowPlaceholders: string[] = [];
          for (let j = 0; j < columns.length; j++) {
            const col = columns[j];
            const val = row[col];
            const finalVal: string | number | null =
              val !== null && val !== undefined && val !== "" ? val : null;
            rowParams.push(finalVal);
            rowPlaceholders.push(`$${rowParams.length}`);
          }
          rowParams.push(now);
          rowPlaceholders.push(`$${rowParams.length}`);
          rowParams.push(now);
          rowPlaceholders.push(`$${rowParams.length}`);

          const singleQuery = `INSERT INTO ${MAESTRA_TABLE} (${quotedCols}) VALUES (${rowPlaceholders.join(", ")})`;
          await sql(singleQuery, rowParams);
          inserted++;
        } catch (rowError) {
          const errorMessage =
            rowError instanceof Error ? rowError.message : "Unknown error";
          errors.push(`Row ${batchStart + i + 1}: ${errorMessage}`);
        }
      }
    }
  }

  return { inserted, errors };
}

// Update a single cell
export async function updateMaestraCell(
  id: number,
  columnName: string,
  value: string | null
): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();

  // Use parameterized query with dynamic column name (column name is from our own column list, safe)
  const query = `UPDATE ${MAESTRA_TABLE} SET "${columnName}" = $1, "updated_at" = $2 WHERE "id" = $3`;
  await sql(query, [value, now, id]);
}

// Delete a single row
export async function deleteMaestraRow(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM maestra_products WHERE id = ${id}`;
}

// Delete all rows
export async function deleteAllMaestraRows(): Promise<{ deletedCount: number }> {
  const sql = getSql();
  const countResult =
    await sql`SELECT COUNT(*) as count FROM maestra_products`;
  const count = Number(countResult[0].count);
  await sql`DELETE FROM maestra_products`;
  return { deletedCount: count };
}

/**
 * Drop and recreate the maestra table from scratch.
 * This removes ALL data AND all dynamic columns (ghost columns from previous imports).
 * Also cleans up all per-view magento tables.
 */
export async function recreateMaestraTable(): Promise<void> {
  const sql = getSql();
  // Drop all per-view magento tables
  try {
    const config = await loadMagentoConfig();
    for (const view of config.views) {
      const tbl = viewTableName(view.id);
      await sql(`DROP TABLE IF EXISTS "${tbl}"`);
    }
  } catch {
    // config may not exist yet — safe to ignore
  }
  // Also drop the legacy shared table if it still exists
  try {
    await sql`DROP TABLE IF EXISTS magento_products`;
  } catch {
    // safe to ignore
  }
  await sql`DROP TABLE IF EXISTS maestra_products`;
  await ensureMaestraTable();
}

// Test connection and check table
export async function initializeMaestraDatabase(): Promise<{
  connected: boolean;
  tableExists: boolean;
}> {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    await ensureMaestraTable();
    await ensureKeywordsTable();
    await ensureSettingsTable();
    // Migrate legacy shared table → per-view tables if needed
    await migrateSharedMagentoTable();
    // Ensure per-view tables exist for every configured view
    const config = await loadMagentoConfig();
    for (const view of config.views) {
      await ensureViewTable(view);
    }
    return { connected: true, tableExists: true };
  } catch {
    return { connected: false, tableExists: false };
  }
}

// ============================================
// Per-view Magento tables
// ============================================

/** Create the table for a single view if it doesn't exist, and ensure manual columns are present. */
async function ensureViewTable(view: MagentoViewConfig): Promise<void> {
  const sql = getSql();
  const tbl = viewTableName(view.id);
  await sql(`
    CREATE TABLE IF NOT EXISTS "${tbl}" (
      id SERIAL PRIMARY KEY,
      maestra_id INTEGER NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Ensure every manual column exists
  for (const col of view.columns) {
    if (col.source.type === "manual") {
      const dbCol = manualDbColumn(view.id, col.id);
      try {
        await sql(`ALTER TABLE "${tbl}" ADD COLUMN IF NOT EXISTS "${dbCol}" TEXT`);
      } catch {
        // column already exists
      }
    }
  }
}

/**
 * Migrate legacy shared `magento_products` table to per-view tables.
 * Only runs once: if `magento_products` exists, data is copied to each view's table,
 * then the legacy table is dropped.
 */
async function migrateSharedMagentoTable(): Promise<void> {
  const sql = getSql();
  // Check if legacy table exists
  const exists = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'magento_products'
  `;
  if (exists.length === 0) return;

  const config = await loadMagentoConfig();
  if (config.views.length === 0) {
    // No views configured — just drop the legacy table
    await sql`DROP TABLE IF EXISTS magento_products`;
    return;
  }

  for (const view of config.views) {
    await ensureViewTable(view);
    const tbl = viewTableName(view.id);

    // Copy maestra_id rows that don't exist yet in the new table
    await sql(`
      INSERT INTO "${tbl}" (maestra_id)
      SELECT mp.maestra_id FROM magento_products mp
      WHERE mp.maestra_id NOT IN (SELECT maestra_id FROM "${tbl}")
    `);

    // Copy manual column data from legacy namespaced columns
    for (const col of view.columns) {
      if (col.source.type === "manual") {
        const newCol = manualDbColumn(view.id, col.id);
        const legacyCol = legacyManualDbColumn(view.id, col.id);
        // Check if legacy column exists
        const colExists = await sql(`
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'magento_products' AND column_name = $1
        `, [legacyCol]);
        if (colExists.length > 0) {
          await sql(`
            UPDATE "${tbl}" t
            SET "${newCol}" = mp."${legacyCol}"
            FROM magento_products mp
            WHERE t.maestra_id = mp.maestra_id
              AND mp."${legacyCol}" IS NOT NULL
              AND (t."${newCol}" IS NULL OR t."${newCol}" = '')
          `);
        }
      }
    }
  }

  // Drop the legacy table
  await sql`DROP TABLE IF EXISTS magento_products`;
}

// Sync a single view's table from maestra_products (insert missing, remove orphans)
export async function syncViewFromMaestra(viewId: string): Promise<{ added: number; removed: number }> {
  const sql = getSql();
  const tbl = viewTableName(viewId);

  // Ensure the per-view table exists before running any sync SQL
  const config = await loadMagentoConfig();
  const view = config.views.find((v) => v.id === viewId);
  if (view) await ensureViewTable(view);

  // Remove rows whose maestra_id no longer exists
  const removeResult = await sql(`
    DELETE FROM "${tbl}"
    WHERE maestra_id NOT IN (SELECT id FROM maestra_products)
  `);
  const removed = removeResult.length ?? 0;

  // Insert rows for maestra products that don't have one yet
  const newRows = await sql(`
    INSERT INTO "${tbl}" (maestra_id)
    SELECT mp.id
    FROM maestra_products mp
    WHERE mp.id NOT IN (SELECT maestra_id FROM "${tbl}")
    RETURNING id
  `);

  return { added: newRows.length, removed };
}

// Sync all configured views from maestra
export async function syncAllViewsFromMaestra(): Promise<void> {
  const config = await loadMagentoConfig();
  for (const view of config.views) {
    await ensureViewTable(view);
    await syncViewFromMaestra(view.id);
  }
}

// Get all products for a specific view
export async function getViewProducts(viewId: string): Promise<MagentoProduct[]> {
  const sql = getSql();
  const tbl = viewTableName(viewId);
  // Ensure table exists
  const config = await loadMagentoConfig();
  const view = config.views.find((v) => v.id === viewId);
  if (view) await ensureViewTable(view);
  const rows = await sql(`SELECT * FROM "${tbl}" ORDER BY id`);
  return rows as unknown as MagentoProduct[];
}

// Get view products by IDs
export async function getViewProductsByIds(viewId: string, ids: number[]): Promise<MagentoProduct[]> {
  if (ids.length === 0) return [];
  const sql = getSql();
  const tbl = viewTableName(viewId);
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const query = `SELECT * FROM "${tbl}" WHERE id IN (${placeholders}) ORDER BY id`;
  const rows = await sql(query, ids);
  return rows as unknown as MagentoProduct[];
}

// Update a single cell in a view's table
export async function updateViewCell(
  viewId: string,
  id: number,
  columnName: string,
  value: string | null
): Promise<void> {
  const sql = getSql();
  const tbl = viewTableName(viewId);
  const now = new Date().toISOString();

  const numericCols = new Set(["price", "weight"]);
  let finalValue: string | number | null = value;
  if (value !== null && numericCols.has(columnName)) {
    const num = Number(value);
    finalValue = isNaN(num) ? null : num;
  }

  const query = `UPDATE "${tbl}" SET "${columnName}" = $1, "updated_at" = $2 WHERE "id" = $3`;
  await sql(query, [finalValue, now, id]);
}

/**
 * Bulk update fields in a view's table using _row_id (the DB id as a string).
 */
export async function bulkUpdateViewFieldsByRowId(
  viewId: string,
  updates: Record<string, unknown>[],
  dbColumns: string[]
): Promise<number> {
  if (updates.length === 0 || dbColumns.length === 0) return 0;
  const sql = getSql();
  const tbl = viewTableName(viewId);
  const now = new Date().toISOString();
  let updated = 0;

  for (const row of updates) {
    const rowId = row._row_id as string;
    if (!rowId) continue;

    const setClauses: string[] = [];
    const params: (string | number | null)[] = [];
    let paramIndex = 1;

    const numericCols = new Set(["price", "weight"]);
    for (const col of dbColumns) {
      const val = row[col];
      setClauses.push(`"${col}" = $${paramIndex}`);
      if (val != null && numericCols.has(col)) {
        const num = Number(val);
        params.push(isNaN(num) ? null : num);
      } else {
        params.push(val != null ? String(val) : null);
      }
      paramIndex++;
    }

    setClauses.push(`"updated_at" = $${paramIndex}`);
    params.push(now);
    paramIndex++;

    params.push(rowId);

    const query = `UPDATE "${tbl}" SET ${setClauses.join(", ")} WHERE id::text = $${paramIndex}`;

    try {
      await sql(query, params);
      updated++;
    } catch (err) {
      console.error(`Failed to update view ${viewId} product with id ${rowId}:`, err);
    }
  }

  return updated;
}

/** Drop the table for a view (when the view is deleted). */
export async function dropViewTable(viewId: string): Promise<void> {
  const sql = getSql();
  const tbl = viewTableName(viewId);
  await sql(`DROP TABLE IF EXISTS "${tbl}"`);
}

// ============================================
// Magento Export Config (configurable columns)
// ============================================

/**
 * Load the Magento export config (list of views). Returns defaults if none saved.
 * Transparently migrates legacy single-config shape ({ buttonLabel, columns }) into a
 * single-view array.
 */
export async function loadMagentoConfig(): Promise<MagentoConfig> {
  const sql = getSql();
  await ensureSettingsTable();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'magento_config'`;
  if (rows.length === 0) return DEFAULT_MAGENTO_CONFIG;
  try {
    const parsed = JSON.parse(rows[0].value as string) as unknown;
    if (!parsed || typeof parsed !== "object") return DEFAULT_MAGENTO_CONFIG;
    const obj = parsed as Record<string, unknown>;

    // New shape: { views: MagentoViewConfig[] }
    if (Array.isArray(obj.views)) {
      return {
        views: (obj.views as MagentoViewConfig[]).map((v) => ({
          id: String(v.id ?? ""),
          name: v.name || "Magento",
          buttonLabel: v.buttonLabel || "Exportar Magento",
          columns: Array.isArray(v.columns) ? v.columns : [],
        })).filter((v) => v.id),
      };
    }

    // Legacy shape: { buttonLabel, columns } — migrate to a single view
    if (Array.isArray(obj.columns)) {
      const legacyView: MagentoViewConfig = {
        id: `view_legacy_${Date.now().toString(36)}`,
        name: "Magento",
        buttonLabel: (obj.buttonLabel as string) || "Exportar Magento",
        columns: obj.columns as MagentoViewConfig["columns"],
      };
      return { views: [legacyView] };
    }

    return DEFAULT_MAGENTO_CONFIG;
  } catch {
    return DEFAULT_MAGENTO_CONFIG;
  }
}

/**
 * Save the Magento export config. Ensures per-view tables and their manual columns exist.
 */
export async function saveMagentoConfig(config: MagentoConfig): Promise<void> {
  const sql = getSql();
  await ensureSettingsTable();

  // Ensure each view has its own table with the right columns
  for (const view of config.views) {
    await ensureViewTable(view);
  }

  const value = JSON.stringify(config);
  const now = new Date().toISOString();
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('magento_config', ${value}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = ${now}
  `;
}

// ============================================
// SEO Keywords table (from SEMrush or similar)
// ============================================

export interface SeoKeyword {
  id?: number;
  keyword: string;
  search_volume: number | null;
  keyword_difficulty: number | null;
  cpc: number | null;
  competitive_density: number | null;
  trend: string | null;
  extra_data: string | null;
  created_at?: string;
}

export async function ensureKeywordsTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS seo_keywords (
      id SERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      search_volume INTEGER,
      keyword_difficulty DOUBLE PRECISION,
      cpc DOUBLE PRECISION,
      competitive_density DOUBLE PRECISION,
      trend TEXT,
      extra_data TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export async function deleteAllKeywords(): Promise<number> {
  const sql = getSql();
  const countResult = await sql`SELECT COUNT(*) as count FROM seo_keywords`;
  const count = Number(countResult[0].count);
  await sql`DELETE FROM seo_keywords`;
  return count;
}

export async function insertKeywords(
  rows: Record<string, string | number | null>[]
): Promise<{ inserted: number; errors: string[] }> {
  if (rows.length === 0) return { inserted: 0, errors: [] };

  const sql = getSql();
  await ensureKeywordsTable();
  let inserted = 0;
  const errors: string[] = [];

  const BATCH_SIZE = 100;
  for (let batchStart = 0; batchStart < rows.length; batchStart += BATCH_SIZE) {
    const batch = rows.slice(batchStart, batchStart + BATCH_SIZE);

    const valuePlaceholders: string[] = [];
    const params: (string | number | null)[] = [];

    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      const keyword = row.keyword != null ? String(row.keyword) : "";
      const searchVolume = row.search_volume != null ? Number(row.search_volume) : null;
      const kd = row.keyword_difficulty != null ? Number(row.keyword_difficulty) : null;
      const cpc = row.cpc != null ? Number(row.cpc) : null;
      const cd = row.competitive_density != null ? Number(row.competitive_density) : null;
      const trend = row.trend != null ? String(row.trend) : null;
      const extra = row.extra_data != null ? String(row.extra_data) : null;

      params.push(keyword, isNaN(searchVolume as number) ? null : searchVolume, isNaN(kd as number) ? null : kd, isNaN(cpc as number) ? null : cpc, isNaN(cd as number) ? null : cd, trend, extra);
      const offset = i * 7;
      valuePlaceholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`);
    }

    const query = `INSERT INTO seo_keywords (keyword, search_volume, keyword_difficulty, cpc, competitive_density, trend, extra_data) VALUES ${valuePlaceholders.join(", ")}`;

    try {
      await sql(query, params);
      inserted += batch.length;
    } catch (error) {
      // Fallback to individual inserts
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        try {
          const keyword = row.keyword != null ? String(row.keyword) : "";
          const sv = row.search_volume != null ? Number(row.search_volume) : null;
          const kd = row.keyword_difficulty != null ? Number(row.keyword_difficulty) : null;
          const cpcVal = row.cpc != null ? Number(row.cpc) : null;
          const cd = row.competitive_density != null ? Number(row.competitive_density) : null;
          const trend = row.trend != null ? String(row.trend) : null;
          const extra = row.extra_data != null ? String(row.extra_data) : null;
          await sql`INSERT INTO seo_keywords (keyword, search_volume, keyword_difficulty, cpc, competitive_density, trend, extra_data) VALUES (${keyword}, ${isNaN(sv as number) ? null : sv}, ${isNaN(kd as number) ? null : kd}, ${isNaN(cpcVal as number) ? null : cpcVal}, ${isNaN(cd as number) ? null : cd}, ${trend}, ${extra})`;
          inserted++;
        } catch (rowError) {
          errors.push(`Keyword row ${batchStart + i + 1}: ${rowError instanceof Error ? rowError.message : "Unknown error"}`);
        }
      }
    }
  }

  return { inserted, errors };
}

export async function getKeywordCount(): Promise<number> {
  const sql = getSql();
  await ensureKeywordsTable();
  const result = await sql`SELECT COUNT(*) as count FROM seo_keywords`;
  return Number(result[0].count);
}

// Get top keywords relevant to a product (by matching against product text)
export async function getTopKeywordsForContext(limit: number = 100): Promise<SeoKeyword[]> {
  const sql = getSql();
  await ensureKeywordsTable();
  const rows = await sql`
    SELECT keyword, search_volume, keyword_difficulty, cpc, competitive_density, trend, extra_data
    FROM seo_keywords
    WHERE search_volume IS NOT NULL
    ORDER BY search_volume DESC NULLS LAST
    LIMIT ${limit}
  `;
  return rows as unknown as SeoKeyword[];
}

// ============================================
// System Prompt settings
// ============================================

async function ensureSettingsTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

const DEFAULT_SYSTEM_PROMPT = `Eres un especialista en SEO y e-commerce para GoPersonal (gopersonal.ai), una marca de textiles para el hogar y decoración.

## Objetivo
Tu tarea es generar contenido SEO optimizado para productos de GoPersonal en su tienda Magento. Todo el contenido debe estar en español (Chile).

## Principios SEO
- Usa keywords relevantes de forma natural, sin keyword stuffing
- Prioriza keywords con alto volumen de búsqueda y baja dificultad
- Cada campo tiene un propósito SEO específico: respétalo
- El contenido debe ser único para cada producto
- Usa un tono profesional, cálido y orientado al hogar/confort

## Reglas de Keywords
- Prioriza siempre keywords del dataset SEO que sean relevantes para el producto. 
- Si el dataset tiene keywords aplicables, deben aparecer en el resultado final.
- Si el dataset no tiene keywords relevantes para el producto, genera variantes naturales de las keywords originales combinando: tamaño, material, uso o tipo de producto. Nunca inventes términos que no reflejen cómo un cliente real buscaría este producto.
- Las keywords deben reflejar cómo el cliente busca, no cómo está descrito el producto internamente. Evita lenguaje técnico de ficha de producto (ej: "mezcla poliéster algodón" → mal; "sábanas algodón 2 plazas" → bien).
- No uses keywords genéricas que correspondan a una categoría entera sin especificidad (ej: "ropa de cama", "sábanas", "plumones" solos no son válidos).
- No uses keywords navegacionales de marca propia (ej: "gopersonal", "sabanas gopersonal"). Estas solo alcanzan a quien ya te conoce y no atraen clientes nuevos.
- Prioriza keywords con intención comercial o transaccional por sobre informacionales.

## Campos a generar

### name (nombre del producto)
- Nombre comercial conciso y SEO-friendly
- Incluir marca, tipo de producto, tamaño/medida si aplica
- Incorporar keywords relevantes de alto volumen cuando encajen naturalmente

### url_key (slug URL)
- Slug URL-safe: minúsculas, guiones en vez de espacios, sin caracteres especiales
- Basado en el nombre del producto
- Incluir SKU al final para unicidad

### meta_title (título SEO)
- Máximo 60 caracteres
- Incluir nombre del producto y marca
- Incorporar keywords de alto volumen de búsqueda

### meta_keywords (keywords SEO)
- 5-8 keywords separadas por comas
- Incluir tipo de producto, marca, material, estilo, categoría
- SOLO keywords directamente relevantes al producto
- Priorizar keywords del dataset SEO con alto volumen y baja dificultad

### meta_description (descripción SEO)
- Máximo 155 caracteres
- Descripción concisa optimizada para resultados de búsqueda
- Debe incitar al clic e incluir keywords principales
- Usar un tono atractivo y descriptivo

### short_description (descripción corta)
- Texto de 2-4 oraciones rico en keywords
- Describe el producto de forma natural y atractiva
- Debe ayudar a los motores de búsqueda a entender el producto
- Mencionar beneficios clave, materiales, y características distintivas
- Tono profesional pero cálido

### long_description (descripción larga)
- Descripción detallada de 3-5 párrafos
- Explicar beneficios, confort, materiales, uso y valor del producto
- Incluir información sobre la calidad y respaldo de GoPersonal
- Usar subtítulos o estructura clara cuando sea apropiado
- Incorporar keywords de forma natural a lo largo del texto

## Dataset de Keywords SEO — Definición de Columnas

IMPORTANTE: El único campo que debe usarse como keyword es "keyword". Todos los demás campos son métricas para evaluar y priorizar keywords — NUNCA deben usarse como keywords en sí mismos.

- **keyword** → La consulta de búsqueda real utilizada por los usuarios. Este es el ÚNICO campo que debe usarse como keyword al generar metadatos SEO (meta_keywords, meta_title, etc.).
- **search_volume** → Volumen de búsqueda mensual estimado. Valores más altos indican keywords más populares — úsalo para priorizar qué keywords incluir.
- **keyword_difficulty** → Puntuación de dificultad SEO (0–100). Valores más altos significan que es más difícil posicionar. Prefiere keywords con menor dificultad cuando sea posible.
- **cpc** → Costo promedio por clic en anuncios pagados. Indica el valor comercial de la keyword.
- **competitive_density** → Nivel de competencia en publicidad pagada.
- **trend** → Tendencia de búsqueda a lo largo del tiempo, útil para identificar keywords en crecimiento o declive.
- **position** → Posición actual en el ranking de Google. Esto es solo una métrica de rendimiento, NO una keyword.
- **previous_position** → Posición anterior en el ranking. Se usa para entender cambios de posicionamiento, NO es una keyword.
- **keyword_intents** → Intención de búsqueda (informacional, transaccional, comercial, navegacional). Ayuda a determinar si la keyword coincide con una página de producto.
- **url** → La URL que actualmente posiciona para la keyword. Esto NO es una keyword y NUNCA debe usarse para generar keywords.
- **traffic_change** → Cambio en el tráfico de esta keyword. Solo indicador de rendimiento.
- **traffic_percent** → Porcentaje de tráfico de esta keyword. Solo indicador de rendimiento.
- **traffic_cost** → Costo estimado del tráfico si se adquiriera mediante anuncios. Solo indicador de rendimiento.
- **number_of_results** → Número total de resultados de búsqueda en Google, indica la competitividad de la consulta.
- **trends** → Datos históricos de tendencia de búsqueda.
- **timestamp** → Fecha en que se registraron los datos. NO es una keyword.
- **position_type** → Tipo de posicionamiento (orgánico, featured snippet, etc). NO es una keyword.

Al generar campos SEO (meta_keywords, meta_title, meta_description, etc.), usa ÚNICAMENTE valores de la columna "keyword". Usa las demás columnas como métricas de apoyo para decidir CUÁLES keywords son más valiosas para incluir.`;

export async function getSystemPrompt(): Promise<string> {
  const sql = getSql();
  await ensureSettingsTable();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'system_prompt'`;
  if (rows.length > 0) {
    return rows[0].value as string;
  }
  return DEFAULT_SYSTEM_PROMPT;
}

export async function saveSystemPrompt(prompt: string): Promise<void> {
  const sql = getSql();
  await ensureSettingsTable();
  const now = new Date().toISOString();
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('system_prompt', ${prompt}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = ${prompt}, updated_at = ${now}
  `;
}

export function getDefaultSystemPrompt(): string {
  return DEFAULT_SYSTEM_PROMPT;
}

// ============================================
// AI Jobs table (background processing)
// ============================================

export interface AiJob {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  total_products: number;
  processed_products: number;
  successful_products: number;
  failed_products: number;
  errors: string | null;
  created_at: string;
  updated_at: string;
  /** JSON-serialized batch engine metrics for live progress */
  batch_metrics: string | null;
}

async function ensureAiJobsTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS ai_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'pending',
      total_products INTEGER NOT NULL DEFAULT 0,
      processed_products INTEGER NOT NULL DEFAULT 0,
      successful_products INTEGER NOT NULL DEFAULT 0,
      failed_products INTEGER NOT NULL DEFAULT 0,
      errors TEXT,
      batch_metrics TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Add batch_metrics column if it doesn't exist (for existing tables)
  try {
    await sql`ALTER TABLE ai_jobs ADD COLUMN IF NOT EXISTS batch_metrics TEXT`;
  } catch {
    // Column already exists, ignore
  }
}

export async function createAiJob(id: string, totalProducts: number): Promise<AiJob> {
  const sql = getSql();
  await ensureAiJobsTable();
  const now = new Date().toISOString();
  await sql`
    INSERT INTO ai_jobs (id, status, total_products, created_at, updated_at)
    VALUES (${id}, 'pending', ${totalProducts}, ${now}, ${now})
  `;
  return {
    id,
    status: "pending",
    total_products: totalProducts,
    processed_products: 0,
    successful_products: 0,
    failed_products: 0,
    errors: null,
    batch_metrics: null,
    created_at: now,
    updated_at: now,
  };
}

export async function updateAiJobProgress(
  id: string,
  update: {
    status?: AiJob["status"];
    processed_products?: number;
    successful_products?: number;
    failed_products?: number;
    errors?: string;
    batch_metrics?: string;
  }
): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();

  // Build dynamic SET clause
  const sets: string[] = [`"updated_at" = '${now}'`];
  const values: (string | number)[] = [];
  let paramIndex = 1;

  if (update.status !== undefined) {
    sets.push(`"status" = $${paramIndex++}`);
    values.push(update.status);
  }
  if (update.processed_products !== undefined) {
    sets.push(`"processed_products" = $${paramIndex++}`);
    values.push(update.processed_products);
  }
  if (update.successful_products !== undefined) {
    sets.push(`"successful_products" = $${paramIndex++}`);
    values.push(update.successful_products);
  }
  if (update.failed_products !== undefined) {
    sets.push(`"failed_products" = $${paramIndex++}`);
    values.push(update.failed_products);
  }
  if (update.errors !== undefined) {
    sets.push(`"errors" = $${paramIndex++}`);
    values.push(update.errors);
  }
  if (update.batch_metrics !== undefined) {
    sets.push(`"batch_metrics" = $${paramIndex++}`);
    values.push(update.batch_metrics);
  }

  values.push(id);
  const query = `UPDATE ai_jobs SET ${sets.join(", ")} WHERE id = $${paramIndex}`;
  await sql(query, values);
}

export async function getAiJob(id: string): Promise<AiJob | null> {
  const sql = getSql();
  await ensureAiJobsTable();
  const rows = await sql`SELECT * FROM ai_jobs WHERE id = ${id}`;
  if (rows.length === 0) return null;
  return rows[0] as unknown as AiJob;
}

export async function cleanupOldAiJobs(): Promise<void> {
  const sql = getSql();
  await ensureAiJobsTable();
  // Remove jobs older than 24 hours
  await sql`DELETE FROM ai_jobs WHERE created_at < NOW() - INTERVAL '24 hours'`;
}

// ============================================
// Maestra AI Fix — per-column correction config + bulk update
// ============================================

export interface MaestraFixColumnConfig {
  dbColumn: string;
  enabled: boolean;
  prompt: string;
}

export interface MaestraFixConfig {
  globalPrompt?: string;
  columns: MaestraFixColumnConfig[];
}

export async function getMaestraFixConfig(): Promise<MaestraFixConfig> {
  const sql = getSql();
  await ensureSettingsTable();
  const rows = await sql`SELECT value FROM app_settings WHERE key = 'maestra_fix_config'`;
  if (rows.length === 0) return { columns: [] };
  try {
    const parsed = JSON.parse(rows[0].value as string) as unknown;
    if (!parsed || typeof parsed !== "object") return { columns: [] };
    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.columns)) return { columns: [] };
    return {
      globalPrompt: typeof obj.globalPrompt === "string" ? obj.globalPrompt : "",
      columns: (obj.columns as MaestraFixColumnConfig[]).map((c) => ({
        dbColumn: String(c.dbColumn ?? ""),
        enabled: Boolean(c.enabled),
        prompt: typeof c.prompt === "string" ? c.prompt : "",
      })).filter((c) => c.dbColumn),
    };
  } catch {
    return { columns: [] };
  }
}

export async function saveMaestraFixConfig(cfg: MaestraFixConfig): Promise<void> {
  const sql = getSql();
  await ensureSettingsTable();
  const now = new Date().toISOString();
  const value = JSON.stringify(cfg);
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES ('maestra_fix_config', ${value}, ${now})
    ON CONFLICT (key) DO UPDATE SET value = ${value}, updated_at = ${now}
  `;
}

/**
 * Bulk update maestra_products cells using _row_id (the DB id as a string).
 * Only updates the provided dbColumns for each row.
 */
export async function bulkUpdateMaestraFieldsByRowId(
  updates: { _row_id: string; fields: Record<string, string> }[],
  dbColumns: string[]
): Promise<number> {
  if (updates.length === 0 || dbColumns.length === 0) return 0;
  const sql = getSql();
  const now = new Date().toISOString();
  let updated = 0;

  for (const row of updates) {
    const rowId = row._row_id;
    if (!rowId) continue;

    const setClauses: string[] = [];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    for (const col of dbColumns) {
      if (!(col in row.fields)) continue;
      setClauses.push(`"${col}" = $${paramIndex}`);
      const val = row.fields[col];
      params.push(val != null ? String(val) : null);
      paramIndex++;
    }

    if (setClauses.length === 0) continue;

    setClauses.push(`"updated_at" = $${paramIndex}`);
    params.push(now);
    paramIndex++;

    params.push(rowId);

    const query = `UPDATE ${MAESTRA_TABLE} SET ${setClauses.join(", ")} WHERE "id"::text = $${paramIndex}`;

    try {
      await sql(query, params);
      updated++;
    } catch (err) {
      console.error(`Failed to update maestra product with id ${rowId}:`, err);
    }
  }

  return updated;
}
