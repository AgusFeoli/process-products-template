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
    const { productIds, mode, columns } = body as {
      productIds?: number[];
      mode: "selected" | "all";
      columns?: ColumnDef[];
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

    const client = createOpenAI({
      apiKey: process.env.API_KEY,
      baseURL:
        process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    });

    const modelName = process.env.MODEL_NAME || "gpt-4o-mini";
    const dbColumns = columns.map((c) => c.dbColumn);

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
          const updated = await bulkUpdateMagentoDynamicFieldsByRowId(
            object.products as Record<string, unknown>[],
            dbColumns
          );
          totalUpdated += updated;
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
