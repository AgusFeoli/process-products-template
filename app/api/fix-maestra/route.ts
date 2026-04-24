import { NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getMaestraProducts,
  getMaestraProductsByIds,
  bulkUpdateMaestraFieldsByRowId,
  loadMaestraColumnMeta,
  loadMaestraIdentifierColumn,
} from "@/lib/maestra-db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

interface FixColumnDef {
  dbColumn: string;
  name: string;
  prompt: string;
}

function buildDynamicSchema(columns: FixColumnDef[]) {
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
    const { productIds, mode, columns, preview, changes } = body as {
      productIds?: number[];
      mode?: "selected" | "all";
      columns?: FixColumnDef[];
      preview?: boolean;
      // When applying approved changes from the review dialog:
      changes?: { _row_id: string; fields: Record<string, string> }[];
      dbColumns?: string[];
    };

    // Apply path: user approved changes from the review dialog
    if (!preview && Array.isArray(changes)) {
      const dbCols = (body as { dbColumns?: string[] }).dbColumns || [];
      if (dbCols.length === 0) {
        return NextResponse.json({
          success: false,
          message: "No se especificaron columnas para aplicar",
        });
      }
      const updated = await bulkUpdateMaestraFieldsByRowId(changes, dbCols);
      return NextResponse.json({
        success: true,
        updated,
        total: changes.length,
      });
    }

    if (!columns || columns.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se especificaron columnas para corregir",
      });
    }

    // Get maestra products
    let maestraProducts;
    if (mode === "selected" && productIds && productIds.length > 0) {
      maestraProducts = await getMaestraProductsByIds(productIds);
    } else {
      maestraProducts = await getMaestraProducts();
    }

    if (maestraProducts.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se encontraron productos para procesar",
      });
    }

    // Load column metadata so we can use original Excel headers as display labels
    const columnMeta = await loadMaestraColumnMeta();
    const dbColumnToHeader = new Map<string, string>();
    if (columnMeta) {
      for (const meta of columnMeta) {
        dbColumnToHeader.set(meta.dbColumn, meta.excelHeader);
      }
    }

    // Identifier column for display in review dialog
    const identifierColumn = await loadMaestraIdentifierColumn();

    const dbColumns = columns.map((c) => c.dbColumn);

    // Build input for AI: only include the columns being fixed + _row_id
    const productsForAi = maestraProducts.map((mp) => {
      const entry: Record<string, string | number> = {
        _row_id: String(mp.id),
      };
      for (const col of dbColumns) {
        const val = (mp as Record<string, unknown>)[col];
        if (val !== null && val !== undefined) {
          const label = dbColumnToHeader.get(col) || col;
          entry[label] = val as string | number;
        } else {
          const label = dbColumnToHeader.get(col) || col;
          entry[label] = "";
        }
      }
      return entry;
    });

    // Dynamic schema
    const productOutputSchema = buildDynamicSchema(columns);

    // Build the per-column instructions
    const columnInstructions = columns
      .map((c) => {
        const label = c.name || dbColumnToHeader.get(c.dbColumn) || c.dbColumn;
        return `- **${label}** (key: "${c.dbColumn}"): ${c.prompt || "Corregir el valor."}`;
      })
      .join("\n");

    const systemPrompt = `Eres un asistente experto en corrección de datos de productos. Tu tarea es revisar campos específicos de cada producto y devolver el valor corregido según las instrucciones dadas para cada columna.

Reglas estrictas:
- Devuelve ÚNICAMENTE el valor corregido (texto plano), sin explicaciones ni comentarios.
- Si el valor original ya es correcto, devuélvelo tal cual.
- Si el valor original está vacío o nulo, devuélvelo como string vacío.
- Respeta rigurosamente las instrucciones específicas de cada columna.
- No inventes contenido nuevo: solo corrige el valor existente.`;

    const BATCH_SIZE = 20;
    const allGeneratedProducts: Record<string, unknown>[] = [];
    const errors: string[] = [];

    const client = createOpenAI({
      apiKey: process.env.API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
    });

    const modelName = process.env.MODEL_NAME || "gpt-4o-mini";

    for (let batchStart = 0; batchStart < productsForAi.length; batchStart += BATCH_SIZE) {
      const batch = productsForAi.slice(batchStart, batchStart + BATCH_SIZE);

      try {
        const { object } = await generateObject({
          model: client.chat(modelName),
          schema: productOutputSchema,
          system: systemPrompt,
          prompt: `Corrige los valores de los siguientes campos según las instrucciones por campo.

## Instrucciones por campo:
${columnInstructions}

## Productos a procesar:
${JSON.stringify(batch, null, 2)}

Devuelve un objeto JSON con un array "products". Cada elemento debe tener el mismo "_row_id" del producto de entrada y todos los campos corregidos usando las keys indicadas.`,
        });

        if (object.products && object.products.length > 0) {
          allGeneratedProducts.push(...(object.products as Record<string, unknown>[]));
        }
      } catch (batchError) {
        const msg =
          batchError instanceof Error ? batchError.message : "Unknown AI error";
        errors.push(`Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${msg}`);
        console.error("AI fix batch error:", batchError);
      }
    }

    // Build preview changes (only include rows that actually changed)
    const currentValuesMap = new Map(
      maestraProducts.map((mp) => {
        const row: Record<string, unknown> = { _row_id: String(mp.id) };
        for (const col of dbColumns) {
          row[col] = (mp as Record<string, unknown>)[col] ?? null;
        }
        let description = "";
        if (identifierColumn) {
          const value = (mp as Record<string, unknown>)[identifierColumn];
          if (value !== null && value !== undefined && String(value).trim() !== "") {
            description = String(value);
          }
        }
        if (!description) {
          description = `#${mp.id}`;
        }
        row._item_description = description;
        row._sku = identifierColumn
          ? String((mp as Record<string, unknown>)[identifierColumn] ?? "")
          : String(mp.id);
        return [String(mp.id), row];
      })
    );

    const rawChanges = allGeneratedProducts.map((generated) => {
      const rowId = generated._row_id as string;
      const current = currentValuesMap.get(rowId) || {};
      const fields: Record<string, { oldValue: string | null; newValue: string }> = {};
      let hasAnyChange = false;
      for (const col of dbColumns) {
        const oldValRaw = current[col];
        const oldVal = oldValRaw != null ? String(oldValRaw) : null;
        const newVal = String(generated[col] ?? "");
        fields[col] = { oldValue: oldVal, newValue: newVal };
        if ((oldVal ?? "") !== newVal) {
          hasAnyChange = true;
        }
      }
      return {
        _row_id: rowId,
        sku: (current._sku as string) || "",
        item_description: (current._item_description as string) || "",
        fields,
        _hasAnyChange: hasAnyChange,
      };
    });

    // Filter out rows with no actual changes
    const changesOut = rawChanges
      .filter((c) => c._hasAnyChange)
      .map(({ _hasAnyChange: _, ...rest }) => rest);

    return NextResponse.json({
      success: true,
      preview: true,
      changes: changesOut,
      columns: columns.map((c) => ({
        dbColumn: c.dbColumn,
        name: c.name || dbColumnToHeader.get(c.dbColumn) || c.dbColumn,
      })),
      total: maestraProducts.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Fix maestra error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error ? error.message : "Error al corregir campos con AI",
      },
      { status: 500 }
    );
  }
}
