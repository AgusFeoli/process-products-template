import { neon } from "@neondatabase/serverless";
import {
  MAESTRA_TABLE_COLUMN_ORDER,
  type MaestraProduct,
} from "./maestra-columns";
import type { MagentoProduct } from "./magento-columns";

// Re-export everything from maestra-columns for server-side convenience
export {
  MAESTRA_COLUMN_MAP,
  MAESTRA_DB_TO_EXCEL,
  MAESTRA_TABLE_COLUMN_ORDER,
  MAESTRA_EXPORT_ORDER,
  getMaestraDisplayName,
  type MaestraProduct,
} from "./maestra-columns";

export type { MagentoProduct } from "./magento-columns";

function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }
  return neon(url);
}

const MAESTRA_TABLE = "maestra_products";

// Columns that are numeric (DOUBLE PRECISION in PostgreSQL)
const NUMERIC_COLUMNS = new Set([
  "inner_qty",
  "sub_inner",
  "length_sales_unit",
  "width_sales_unit",
  "height_sales_unit",
  "weight_sales_unit",
  "volume_sales_unit",
  "profundidad",
  "ancho_unidad",
  "alto_unidad",
  "peso_neto_unidad",
  "unidades_por_pallet",
]);

// Create or ensure the maestra table exists
export async function ensureMaestraTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS maestra_products (
      id SERIAL PRIMARY KEY,
      item_no TEXT,
      item_description TEXT,
      super_familia TEXT,
      familia TEXT,
      sub_familia TEXT,
      sub_agrupacion TEXT,
      temporalidad TEXT,
      clasificacion_abc TEXT,
      estado_articulo TEXT,
      tipo_articulo TEXT,
      pais_origen TEXT,
      procedencia TEXT,
      coleccion TEXT,
      calidad TEXT,
      composicion TEXT,
      rubro TEXT,
      diseno TEXT,
      color TEXT,
      color_homologado TEXT,
      estilo TEXT,
      marca TEXT,
      categoria_venta TEXT,
      exclusivo TEXT,
      shipping_type TEXT,
      inner_qty DOUBLE PRECISION,
      sub_inner DOUBLE PRECISION,
      length_sales_unit DOUBLE PRECISION,
      width_sales_unit DOUBLE PRECISION,
      height_sales_unit DOUBLE PRECISION,
      weight_sales_unit DOUBLE PRECISION,
      volume_sales_unit DOUBLE PRECISION,
      profundidad DOUBLE PRECISION,
      ancho_unidad DOUBLE PRECISION,
      alto_unidad DOUBLE PRECISION,
      tamano TEXT,
      peso_neto_unidad DOUBLE PRECISION,
      unidades_por_pallet DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
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

// Get total count
export async function getMaestraCount(): Promise<number> {
  const sql = getSql();
  await ensureMaestraTable();
  const result = await sql`SELECT COUNT(*) as count FROM maestra_products`;
  return Number(result[0].count);
}

// Insert rows in bulk
export async function insertMaestraRows(
  rows: Record<string, string | number | null>[]
): Promise<{ inserted: number; errors: string[] }> {
  if (rows.length === 0) {
    return { inserted: 0, errors: [] };
  }

  const sql = getSql();
  await ensureMaestraTable();
  const columns = MAESTRA_TABLE_COLUMN_ORDER;
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
        let finalVal: string | number | null = null;
        if (val !== null && val !== undefined && val !== "") {
          if (NUMERIC_COLUMNS.has(col)) {
            const num = Number(val);
            finalVal = isNaN(num) ? null : num;
          } else {
            finalVal = String(val);
          }
        }
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
            let finalVal: string | number | null = null;
            if (val !== null && val !== undefined && val !== "") {
              if (NUMERIC_COLUMNS.has(col)) {
                const num = Number(val);
                finalVal = isNaN(num) ? null : num;
              } else {
                finalVal = String(val);
              }
            }
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

  let finalValue: string | number | null = value;
  if (value !== null && NUMERIC_COLUMNS.has(columnName)) {
    const num = Number(value);
    finalValue = isNaN(num) ? null : num;
  }

  // Use parameterized query with dynamic column name (column name is from our own column list, safe)
  const query = `UPDATE ${MAESTRA_TABLE} SET "${columnName}" = $1, "updated_at" = $2 WHERE "id" = $3`;
  await sql(query, [finalValue, now, id]);
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

// Test connection and check table
export async function initializeMaestraDatabase(): Promise<{
  connected: boolean;
  tableExists: boolean;
}> {
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    await ensureMaestraTable();
    await ensureMagentoTable();
    await ensureKeywordsTable();
    await ensureSettingsTable();
    return { connected: true, tableExists: true };
  } catch {
    return { connected: false, tableExists: false };
  }
}

// ============================================
// Magento Products table
// ============================================

export async function ensureMagentoTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS magento_products (
      id SERIAL PRIMARY KEY,
      maestra_id INTEGER NOT NULL,
      sku TEXT,
      name TEXT,
      url_key TEXT,
      meta_title TEXT,
      meta_keywords TEXT,
      meta_description TEXT,
      short_description TEXT,
      long_description TEXT,
      price DOUBLE PRECISION,
      weight DOUBLE PRECISION,
      shipping_type TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Add new columns if they don't exist (for existing tables)
  for (const col of ["meta_description", "short_description", "long_description"]) {
    try {
      await sql(`ALTER TABLE magento_products ADD COLUMN IF NOT EXISTS "${col}" TEXT`);
    } catch {
      // Column already exists
    }
  }
}

// Sync magento_products from maestra_products (insert missing, remove orphans)
export async function syncMagentoFromMaestra(): Promise<{ added: number; removed: number }> {
  const sql = getSql();
  await ensureMagentoTable();

  // Remove magento rows whose maestra_id no longer exists
  const removeResult = await sql`
    DELETE FROM magento_products
    WHERE maestra_id NOT IN (SELECT id FROM maestra_products)
  `;
  const removed = removeResult.length ?? 0;

  // Insert magento rows for maestra products that don't have one yet
  const newRows = await sql`
    INSERT INTO magento_products (maestra_id, sku, weight, shipping_type)
    SELECT mp.id, mp.item_no, mp.weight_sales_unit, mp.shipping_type
    FROM maestra_products mp
    WHERE mp.id NOT IN (SELECT maestra_id FROM magento_products)
    RETURNING id
  `;

  return { added: newRows.length, removed };
}

// Get all magento products joined with key maestra fields
export async function getMagentoProducts(): Promise<MagentoProduct[]> {
  const sql = getSql();
  await ensureMagentoTable();
  const rows = await sql`
    SELECT mg.*
    FROM magento_products mg
    ORDER BY mg.id
  `;
  return rows as unknown as MagentoProduct[];
}

// Get magento products by IDs
export async function getMagentoProductsByIds(ids: number[]): Promise<MagentoProduct[]> {
  if (ids.length === 0) return [];
  const sql = getSql();
  // Build parameterized query for IN clause
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
  const query = `SELECT * FROM magento_products WHERE id IN (${placeholders}) ORDER BY id`;
  const rows = await sql(query, ids);
  return rows as unknown as MagentoProduct[];
}

// Update a single magento cell
export async function updateMagentoCell(
  id: number,
  columnName: string,
  value: string | null
): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();

  const numericCols = new Set(["price", "weight"]);
  let finalValue: string | number | null = value;
  if (value !== null && numericCols.has(columnName)) {
    const num = Number(value);
    finalValue = isNaN(num) ? null : num;
  }

  const query = `UPDATE magento_products SET "${columnName}" = $1, "updated_at" = $2 WHERE "id" = $3`;
  await sql(query, [finalValue, now, id]);
}

// Bulk update AI-generated fields for multiple products
export async function bulkUpdateMagentoAiFields(
  updates: {
    id: number;
    name: string | null;
    url_key: string | null;
    meta_title: string | null;
    meta_keywords: string | null;
    meta_description: string | null;
    short_description: string | null;
    long_description: string | null;
  }[]
): Promise<number> {
  if (updates.length === 0) return 0;
  const sql = getSql();
  const now = new Date().toISOString();
  let updated = 0;

  for (const u of updates) {
    try {
      await sql`
        UPDATE magento_products
        SET name = ${u.name}, url_key = ${u.url_key}, meta_title = ${u.meta_title},
            meta_keywords = ${u.meta_keywords}, meta_description = ${u.meta_description},
            short_description = ${u.short_description}, long_description = ${u.long_description},
            updated_at = ${now}
        WHERE id = ${u.id}
      `;
      updated++;
    } catch (err) {
      console.error(`Failed to update magento product ${u.id}:`, err);
    }
  }

  return updated;
}

// Get magento count
export async function getMagentoCount(): Promise<number> {
  const sql = getSql();
  await ensureMagentoTable();
  const result = await sql`SELECT COUNT(*) as count FROM magento_products`;
  return Number(result[0].count);
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

export async function getKeywords(): Promise<SeoKeyword[]> {
  const sql = getSql();
  await ensureKeywordsTable();
  const rows = await sql`SELECT * FROM seo_keywords ORDER BY search_volume DESC NULLS LAST, id`;
  return rows as unknown as SeoKeyword[];
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

export async function ensureSettingsTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

const DEFAULT_SYSTEM_PROMPT = `Eres un especialista en SEO y e-commerce para Cannon Home (cannonhome.cl), una marca chilena de textiles para el hogar y decoración.

## Objetivo
Tu tarea es generar contenido SEO optimizado para productos de Cannon Home en su tienda Magento. Todo el contenido debe estar en español (Chile).

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
- No uses keywords navegacionales de marca propia (ej: "cannon home", "sabanas cannon"). Estas solo alcanzan a quien ya te conoce y no atraen clientes nuevos.
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
- Incluir información sobre la calidad y respaldo de Cannon Home
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

export async function ensureAiJobsTable(): Promise<void> {
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
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'ai_jobs' AND column_name = 'batch_metrics'
      ) THEN
        ALTER TABLE ai_jobs ADD COLUMN batch_metrics TEXT;
      END IF;
    END $$;
  `;
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
