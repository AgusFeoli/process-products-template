import { NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getViewProductsByIds,
  getViewProducts,
  bulkUpdateViewFieldsByRowId,
  getMaestraProducts,
  getTopKeywordsForContext,
  getSystemPrompt,
  loadMaestraColumnMeta,
  loadMaestraIdentifierColumn,
} from "@/lib/maestra-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface ColumnDef {
  dbColumn: string;
  name: string;
}

function buildDynamicSchema(columns: ColumnDef[]) {
  const fieldShape: Record<string, z.ZodString> = {};
  for (const col of columns) {
    fieldShape[col.dbColumn] = z.string();
  }
  return z.object({
    products: z.array(
      z.object({
        _row_id: z.string(),
        ...fieldShape,
      })
    ),
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productIds, mode, columns, preview, viewId } = body as {
      productIds?: number[];
      mode: "selected" | "all";
      columns?: ColumnDef[];
      preview?: boolean;
      viewId: string;
    };

    if (!viewId) {
      return NextResponse.json({
        success: false,
        message: "No se especificó la vista (viewId)",
      });
    }

    if (!columns || columns.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se especificaron columnas para generar",
      });
    }

    // Get products from the view's table
    let magentoProducts;
    if (mode === "selected" && productIds && productIds.length > 0) {
      magentoProducts = await getViewProductsByIds(viewId, productIds);
    } else {
      magentoProducts = await getViewProducts(viewId);
    }

    if (magentoProducts.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se encontraron productos para procesar",
      });
    }

    // Get all maestra products to provide context
    const maestraProducts = await getMaestraProducts();
    const maestraMap = new Map(maestraProducts.map((p) => [p.id, p]));

    // Get SEO keywords for context (if available) — top 100 by search volume
    const seoKeywords = await getTopKeywordsForContext(100);
    const hasKeywords = seoKeywords.length > 0;

    // Get system prompt from DB
    const systemPrompt = await getSystemPrompt();

    // Build structured keyword context as JSON for AI prompt
    let keywordContext = "";
    if (hasKeywords) {
      const keywordsJson = seoKeywords.map((kw) => {
        const entry: Record<string, string | number | null> = {
          keyword: kw.keyword,
        };
        if (kw.search_volume != null) entry.search_volume = kw.search_volume;
        if (kw.keyword_difficulty != null) entry.keyword_difficulty = kw.keyword_difficulty;
        if (kw.cpc != null) entry.cpc = kw.cpc;
        if (kw.competitive_density != null) entry.competitive_density = kw.competitive_density;
        if (kw.trend != null) entry.trend = kw.trend;
        if (kw.extra_data) {
          try {
            const extra = typeof kw.extra_data === "string" ? JSON.parse(kw.extra_data) : kw.extra_data;
            for (const [key, value] of Object.entries(extra)) {
              if (value != null && value !== "") {
                entry[key.toLowerCase().replace(/[^a-z0-9]+/g, "_")] = value as string | number;
              }
            }
          } catch {
            // Skip malformed extra_data
          }
        }
        return entry;
      });
      keywordContext = `\n\n## Dataset de Keywords SEO

${JSON.stringify(keywordsJson, null, 2)}`;
    }

    // Load column metadata so we can use the original Excel headers as keys
    // (more semantic for the AI than the normalized db column names).
    const columnMeta = await loadMaestraColumnMeta();
    const dbColumnToHeader = new Map<string, string>();
    if (columnMeta) {
      for (const meta of columnMeta) {
        dbColumnToHeader.set(meta.dbColumn, meta.excelHeader);
      }
    }

    // The user-chosen identifier column (maestra dbColumn). When set, this is
    // what we display next to each product in the AI preview/diff. When null,
    // we fall back to the internal row id.
    const identifierColumn = await loadMaestraIdentifierColumn();

    // Build context for AI dynamically using ALL available maestra columns.
    // Previously this hardcoded a fixed set of fields (item_description, familia, etc.)
    // which meant if the maestra didn't have those exact columns, the AI received
    // almost nothing. Now we pass every non-system column from the maestra row,
    // keyed by the original Excel header when available.
    // Use _row_id (the DB id as a string) as the round-trip identifier to avoid
    // BigInt precision loss.
    const SYSTEM_COLUMNS = new Set(["id", "created_at", "updated_at"]);
    const productsForAi = magentoProducts.map((mp) => {
      const maestra = maestraMap.get(mp.maestra_id);
      const entry: Record<string, string | number> = {
        _row_id: String(mp.id),
        sku: mp.sku || "",
      };
      if (maestra) {
        for (const [key, value] of Object.entries(maestra)) {
          if (SYSTEM_COLUMNS.has(key)) continue;
          if (value === null || value === undefined || value === "") continue;
          const label = dbColumnToHeader.get(key) || key;
          entry[label] = value as string | number;
        }
      }
      return entry;
    });

    // Build dynamic schema based on the columns the user wants generated
    const productOutputSchema = buildDynamicSchema(columns);

    // Build the column list for the AI prompt. Use the human-readable name;
    // the JSON key (dbColumn) is already enforced by the Zod schema.
    const columnDescriptions = columns
      .map((c) => (c.name && c.name !== c.dbColumn ? `- ${c.name} (key: "${c.dbColumn}")` : `- ${c.dbColumn}`))
      .join("\n");

    // Process in batches of 20 to avoid token limits
    const BATCH_SIZE = 20;
    let totalUpdated = 0;
    const errors: string[] = [];
    const allGeneratedProducts: Record<string, unknown>[] = [];

    const client = createOpenAI({
      apiKey: process.env.API_KEY,
      baseURL:
        process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    });

    const modelName = process.env.MODEL_NAME || "gpt-4o-mini";
    const dbColumns = columns.map((c) => c.dbColumn);

    // Build a map of current values for preview diff
    const currentValuesMap = preview
      ? new Map(
          magentoProducts.map((mp) => {
            const row: Record<string, unknown> = { _row_id: String(mp.id), sku: mp.sku };
            for (const col of dbColumns) {
              row[col] = (mp as unknown as Record<string, unknown>)[col] ?? null;
            }
            // Include maestra context for display. If the user chose an
            // identifier column, show that column's value; otherwise fall back
            // to the internal row id.
            const maestra = maestraMap.get(mp.maestra_id);
            if (maestra) {
              row._sku = mp.sku;
              let description = "";
              if (identifierColumn) {
                const value = (maestra as Record<string, unknown>)[identifierColumn];
                if (value !== null && value !== undefined && String(value).trim() !== "") {
                  description = String(value);
                }
              }
              if (!description) {
                description = `#${mp.id}`;
              }
              row._item_description = description;
            } else {
              row._item_description = `#${mp.id}`;
            }
            return [String(mp.id), row];
          })
        )
      : null;

    for (
      let batchStart = 0;
      batchStart < productsForAi.length;
      batchStart += BATCH_SIZE
    ) {
      const batch = productsForAi.slice(batchStart, batchStart + BATCH_SIZE);

      try {
        const { object } = await generateObject({
          model: client.chat(modelName),
          schema: productOutputSchema,
          system: systemPrompt,
          prompt: `Genera los siguientes campos para los productos listados abajo.

## Campos a generar:
${columnDescriptions}

Para cada producto, genera TODOS los campos listados arriba según las instrucciones del system prompt.
${keywordContext}

## Productos a procesar:
${JSON.stringify(batch, null, 2)}

Devuelve un objeto JSON con un array "products". Cada elemento debe tener el mismo "_row_id" del producto de entrada y todos los campos generados.`,
        });

        if (object.products && object.products.length > 0) {
          if (preview) {
            allGeneratedProducts.push(
              ...(object.products as Record<string, unknown>[])
            );
          } else {
            const updated = await bulkUpdateViewFieldsByRowId(
              viewId,
              object.products as Record<string, unknown>[],
              dbColumns
            );
            totalUpdated += updated;
          }
        }
      } catch (batchError) {
        const msg =
          batchError instanceof Error
            ? batchError.message
            : "Unknown AI error";
        errors.push(
          `Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${msg}`
        );
        console.error("AI batch error:", batchError);
      }
    }

    // In preview mode, return the changes for review without saving
    if (preview && currentValuesMap) {
      const changes = allGeneratedProducts.map((generated) => {
        const rowId = generated._row_id as string;
        const current = currentValuesMap.get(rowId) || {};
        const fields: Record<
          string,
          { oldValue: string | null; newValue: string }
        > = {};
        for (const col of dbColumns) {
          fields[col] = {
            oldValue: current[col] != null ? String(current[col]) : null,
            newValue: String(generated[col] ?? ""),
          };
        }
        return {
          _row_id: rowId,
          sku: current._sku || current.sku || "",
          item_description: current._item_description || "",
          fields,
        };
      });

      return NextResponse.json({
        success: true,
        preview: true,
        changes,
        columns: columns.map((c) => ({
          dbColumn: c.dbColumn,
          name: c.name,
        })),
        total: magentoProducts.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    return NextResponse.json({
      success: true,
      message: `Se generaron campos AI para ${totalUpdated} de ${magentoProducts.length} productos`,
      updated: totalUpdated,
      total: magentoProducts.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Generate magento error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error al generar campos con AI",
      },
      { status: 500 }
    );
  }
}
