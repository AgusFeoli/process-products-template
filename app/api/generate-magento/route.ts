import { NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getMagentoProductsByIds,
  getMagentoProducts,
  bulkUpdateMagentoDynamicFieldsByRowId,
  getMaestraProducts,
  getTopKeywordsForContext,
  getSystemPrompt,
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
    const { productIds, mode, columns, preview } = body as {
      productIds?: number[];
      mode: "selected" | "all";
      columns?: ColumnDef[];
      preview?: boolean;
    };

    if (!columns || columns.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se especificaron columnas para generar",
      });
    }

    // Get magento products to process
    let magentoProducts;
    if (mode === "selected" && productIds && productIds.length > 0) {
      magentoProducts = await getMagentoProductsByIds(productIds);
    } else {
      magentoProducts = await getMagentoProducts();
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

    // Build context for AI with maestra product details.
    // Use _row_id (the DB id as a string) as the round-trip identifier to avoid
    // BigInt precision loss — both id and maestra_id exceed JS Number.MAX_SAFE_INTEGER.
    // Passing id as a string preserves full precision through AI JSON round-trip.
    const productsForAi = magentoProducts.map((mp) => {
      const maestra = maestraMap.get(mp.maestra_id);
      return {
        _row_id: String(mp.id),
        sku: mp.sku || "",
        item_description: maestra?.item_description || "",
        familia: maestra?.familia || "",
        sub_familia: maestra?.sub_familia || "",
        marca: maestra?.marca || "",
        color: maestra?.color || "",
        tamano: maestra?.tamano || "",
        composicion: maestra?.composicion || "",
        estilo: maestra?.estilo || "",
        categoria_venta: maestra?.categoria_venta || "",
        rubro: maestra?.rubro || "",
        diseno: maestra?.diseno || "",
      };
    });

    // Build dynamic schema based on the columns the user wants generated
    const productOutputSchema = buildDynamicSchema(columns);

    // Build the column list for the AI prompt
    const columnDescriptions = columns.map((c) => `- ${c.dbColumn} (${c.name})`).join("\n");

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
            // Include maestra context for display
            const maestra = maestraMap.get(mp.maestra_id);
            if (maestra) {
              row._sku = mp.sku;
              row._item_description = maestra.item_description || "";
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
            const updated = await bulkUpdateMagentoDynamicFieldsByRowId(
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
