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
  createAiJob,
  updateAiJobProgress,
  cleanupOldAiJobs,
  getAiJob,
  loadMaestraColumnMeta,
} from "@/lib/maestra-db";
import {
  BatchEngine,
  defaultTransientClassifier,
  type BatchProgress,
} from "@/lib/batch-engine";
import { setActiveEngine, deleteActiveEngine } from "@/lib/active-engines";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

/** Split an array into chunks of a given size */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// Background processing function — runs after the response is sent
// Uses BatchEngine for controlled parallelism with circuit breaker and adaptive throttling
async function processAiJob(
  jobId: string,
  viewId: string,
  productsForAi: Array<Record<string, string | number>>,
  keywordContext: string,
  systemPrompt: string,
  columns: ColumnDef[]
) {
  const errors: string[] = [];

  const client = createOpenAI({
    apiKey: process.env.API_KEY,
    baseURL:
      process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const modelName = process.env.MODEL_NAME || "gpt-4o-mini";

  // Build dynamic schema and prompt based on the columns
  const productOutputSchema = buildDynamicSchema(columns);
  // Use only the human-readable name in the description. The JSON key (dbColumn)
  // is already enforced by the Zod schema, so there's no need to expose the
  // internal identifier to the AI.
  const columnDescriptions = columns
    .map((c) => (c.name && c.name !== c.dbColumn ? `- ${c.name} (key: "${c.dbColumn}")` : `- ${c.dbColumn}`))
    .join("\n");
  const dbColumns = columns.map((c) => c.dbColumn);

  // Split products into batches of 20 — each batch = one AI request
  const PRODUCTS_PER_BATCH = 20;
  const productBatches = chunkArray(productsForAi, PRODUCTS_PER_BATCH);

  // Throttled progress updates — avoid flooding the DB
  let lastProgressUpdate = 0;
  const PROGRESS_UPDATE_INTERVAL_MS = 2_000;
  let lastCancellationCheck = 0;
  const CANCELLATION_CHECK_INTERVAL_MS = 5_000;

  const totalProducts = productsForAi.length;
  const totalBatchItems = productBatches.length;

  const engine = new BatchEngine<Record<string, string | number>[], number>(
    {
      minBatchSize: 1,
      maxBatchSize: productBatches.length,
      maxConcurrentBatches: 5,
      maxConcurrencyPerBatch: 5,
      globalMaxConcurrency: 5,
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 30_000,
      maxRetries: 3,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 30_000,
      throttleErrorThreshold: 0.05,
      throttleRecoveryStreak: 10,
      interBatchDelayMs: 100,
    },
    defaultTransientClassifier,
    (progress: BatchProgress) => {
      const now = Date.now();

      if (now - lastCancellationCheck >= CANCELLATION_CHECK_INTERVAL_MS) {
        lastCancellationCheck = now;
        getAiJob(jobId)
          .then((job) => {
            if (job && job.status === "cancelled") {
              engine.stop();
            }
          })
          .catch(() => {});
      }

      if (now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL_MS) {
        return;
      }
      lastProgressUpdate = now;

      const completedBatchItems = progress.success + progress.errors;
      const productsProcessed = Math.min(
        totalProducts,
        Math.round((completedBatchItems / totalBatchItems) * totalProducts)
      );
      const successRatio = progress.success / Math.max(1, completedBatchItems);
      const productsSuccessful = completedBatchItems > 0
        ? Math.round(productsProcessed * successRatio)
        : 0;
      const productsFailed = productsProcessed - productsSuccessful;

      updateAiJobProgress(jobId, {
        processed_products: productsProcessed,
        successful_products: productsSuccessful,
        failed_products: productsFailed,
        batch_metrics: JSON.stringify({
          currentBatch: progress.currentBatch,
          totalBatches: progress.totalBatches,
          activeWorkers: progress.activeWorkers,
          currentConcurrency: progress.currentConcurrency,
          circuitState: progress.circuitState,
          throughput: progress.throughput,
          lastError: progress.lastError,
        }),
      }).catch(() => {});
    }
  );

  setActiveEngine(jobId, engine);
  await updateAiJobProgress(jobId, { status: "processing" });

  try {
    const results = await engine.process(
      productBatches,
      async (batch, signal) => {
        if (signal.aborted) {
          throw new Error("Aborted");
        }

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
          const updated = await bulkUpdateViewFieldsByRowId(
            viewId,
            object.products as Record<string, unknown>[],
            dbColumns
          );
          return updated;
        }

        return 0;
      }
    );

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    results.forEach((result, index) => {
      const batchProductCount = productBatches[index].length;
      totalProcessed += batchProductCount;

      if (result.success && result.result !== undefined) {
        totalSuccessful += result.result;
      } else {
        totalFailed += batchProductCount;
        if (result.error) {
          errors.push(`Batch ${index + 1}: ${result.error.message}`);
        }
      }
    });

    try {
      const finalJob = await getAiJob(jobId);
      if (finalJob && finalJob.status === "cancelled") {
        return;
      }
    } catch {
      // Continue to set final status
    }

    const finalStatus = totalSuccessful > 0 ? "completed" : "failed";
    const finalProgress = engine.getProgress();

    await updateAiJobProgress(jobId, {
      status: finalStatus,
      processed_products: totalProcessed,
      successful_products: totalSuccessful,
      failed_products: totalFailed,
      errors: errors.length > 0 ? JSON.stringify(errors) : undefined,
      batch_metrics: JSON.stringify({
        currentBatch: finalProgress.totalBatches,
        totalBatches: finalProgress.totalBatches,
        activeWorkers: 0,
        currentConcurrency: finalProgress.currentConcurrency,
        circuitState: finalProgress.circuitState,
        throughput: finalProgress.throughput,
        lastError: finalProgress.lastError,
      }),
    });
  } catch (err) {
    console.error("BatchEngine processing error:", err);

    try {
      const currentJob = await getAiJob(jobId);
      if (currentJob && currentJob.status === "cancelled") {
        return;
      }
    } catch {
      // Continue
    }

    await updateAiJobProgress(jobId, {
      status: "failed",
      errors: JSON.stringify([
        err instanceof Error ? err.message : "Unknown error",
      ]),
    });
  } finally {
    deleteActiveEngine(jobId);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productIds, mode, columns, viewId } = body as {
      productIds?: number[];
      mode: "selected" | "all";
      columns?: ColumnDef[];
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

    // Get SEO keywords for context
    const seoKeywords = await getTopKeywordsForContext(100);
    const hasKeywords = seoKeywords.length > 0;

    // Get system prompt from DB
    const systemPrompt = await getSystemPrompt();

    // Build keyword context
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

    // Clean up old jobs
    await cleanupOldAiJobs();

    // Create job record
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createAiJob(jobId, productsForAi.length);

    // Fire and forget: start background processing
    processAiJob(jobId, viewId, productsForAi, keywordContext, systemPrompt, columns).catch(
      (err) => {
        console.error("Background AI job failed:", err);
        updateAiJobProgress(jobId, {
          status: "failed",
          errors: JSON.stringify([err instanceof Error ? err.message : "Unknown error"]),
        }).catch(console.error);
      }
    );

    // Return immediately with the job ID
    return NextResponse.json({
      success: true,
      jobId,
      totalProducts: productsForAi.length,
      message: `Procesamiento AI iniciado para ${productsForAi.length} productos`,
    });
  } catch (error) {
    console.error("Start AI job error:", error);
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Error al iniciar procesamiento AI",
      },
      { status: 500 }
    );
  }
}
