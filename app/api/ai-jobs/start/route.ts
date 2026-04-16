import { NextResponse } from "next/server";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getMagentoProductsByIds,
  getMagentoProducts,
  bulkUpdateMagentoAiFields,
  getMaestraProducts,
  getTopKeywordsForContext,
  getSystemPrompt,
  createAiJob,
  updateAiJobProgress,
  cleanupOldAiJobs,
  getAiJob,
} from "@/lib/maestra-db";
import {
  BatchEngine,
  defaultTransientClassifier,
  type BatchProgress,
} from "@/lib/batch-engine";
import { setActiveEngine, deleteActiveEngine } from "@/lib/active-engines";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const productOutputSchema = z.object({
  products: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      url_key: z.string(),
      meta_title: z.string(),
      meta_keywords: z.string(),
      meta_description: z.string(),
      short_description: z.string(),
      long_description: z.string(),
    })
  ),
});

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
  productsForAi: Array<Record<string, string | number>>,
  keywordContext: string,
  systemPrompt: string
) {
  const errors: string[] = [];

  const client = createOpenAI({
    apiKey: process.env.API_KEY,
    baseURL:
      process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const modelName = process.env.MODEL_NAME || "gpt-4o-mini";

  // Split products into batches of 20 — each batch = one AI request
  const PRODUCTS_PER_BATCH = 20;
  const productBatches = chunkArray(productsForAi, PRODUCTS_PER_BATCH);

  // Throttled progress updates — avoid flooding the DB
  let lastProgressUpdate = 0;
  const PROGRESS_UPDATE_INTERVAL_MS = 2_000; // Update DB at most every 2s
  let lastCancellationCheck = 0;
  const CANCELLATION_CHECK_INTERVAL_MS = 5_000; // Check cancellation every 5s

  // Track product-level counts (BatchEngine counts batch-items, not individual products)
  // Each batch-item contains PRODUCTS_PER_BATCH products (except possibly the last batch)
  const totalProducts = productsForAi.length;
  const totalBatchItems = productBatches.length;

  // Configure BatchEngine:
  // - Each "item" is a batch of 20 products (one AI request)
  // - Max 5 concurrent batches running simultaneously
  // - Circuit breaker opens after 5 consecutive failures
  // - Adaptive throttling triggers at 5% error rate
  // - Recovery after 10 consecutive successes
  const engine = new BatchEngine<Record<string, string | number>[], number>(
    {
      // Since each "item" is already a batch of 20 products,
      // we set batch size to 1 so BatchEngine processes each chunk individually
      minBatchSize: 1,
      maxBatchSize: productBatches.length,
      // Max 5 concurrent AI requests (5 batches of 20 products)
      maxConcurrentBatches: 5,
      maxConcurrencyPerBatch: 5,
      globalMaxConcurrency: 5,
      // Circuit breaker: open after 5 consecutive failures, wait 30s before retry
      circuitBreakerThreshold: 5,
      circuitBreakerResetMs: 30_000,
      // Retry transient errors up to 3 times with exponential backoff
      maxRetries: 3,
      retryBaseDelayMs: 2_000,
      retryMaxDelayMs: 30_000,
      // Adaptive throttling: reduce concurrency when error rate > 5%
      throttleErrorThreshold: 0.05,
      // Recover concurrency after 10 consecutive successful batches
      throttleRecoveryStreak: 10,
      // Small delay between batches to prevent burst pressure
      interBatchDelayMs: 100,
    },
    defaultTransientClassifier,
    // Progress callback — throttled DB updates
    (progress: BatchProgress) => {
      const now = Date.now();

      // Check cancellation periodically (fire-and-forget)
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

      // Throttle DB progress writes
      if (now - lastProgressUpdate < PROGRESS_UPDATE_INTERVAL_MS) {
        return;
      }
      lastProgressUpdate = now;

      // Convert batch-item counts → product counts
      // BatchEngine counts batch-items (each = ~20 products), not individual products.
      // Scale proportionally: (completedBatchItems / totalBatchItems) * totalProducts
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

      // Fire-and-forget DB update
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

  // Store engine reference for cancellation support
  setActiveEngine(jobId, engine);

  await updateAiJobProgress(jobId, { status: "processing" });

  try {
    // Process all batches with controlled parallelism
    const results = await engine.process(
      productBatches,
      async (batch, signal) => {
        // Check abort signal
        if (signal.aborted) {
          throw new Error("Aborted");
        }

        const { object } = await generateObject({
          model: client.chat(modelName),
          schema: productOutputSchema,
          system: systemPrompt,
          prompt: `Genera los campos SEO para los siguientes productos de Cannon Home.

Para cada producto, genera todos los campos requeridos según las instrucciones del system prompt:
- name, url_key, meta_title, meta_keywords, meta_description, short_description, long_description
${keywordContext}

## Productos a procesar:
${JSON.stringify(batch, null, 2)}

Devuelve un objeto JSON con un array "products". Cada elemento debe tener el mismo "id" del producto de entrada y todos los campos generados.`,
        });

        if (object.products && object.products.length > 0) {
          const updated = await bulkUpdateMagentoAiFields(object.products);
          return updated;
        }

        return 0;
      }
    );

    // Aggregate results
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

    // Check if job was cancelled before setting final status
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

    // Check cancellation before overwriting status
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
    const { productIds, mode } = body as {
      productIds?: number[];
      mode: "selected" | "all";
    };

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

    // Build context for AI with maestra product details
    const productsForAi = magentoProducts
      .filter((mp) => mp.id != null)
      .map((mp) => {
        const maestra = maestraMap.get(mp.maestra_id);
        return {
          id: mp.id as number,
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

    // Clean up old jobs
    await cleanupOldAiJobs();

    // Create job record
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createAiJob(jobId, productsForAi.length);

    // Fire and forget: start background processing
    // This runs AFTER the response is sent back to the client
    processAiJob(jobId, productsForAi, keywordContext, systemPrompt).catch(
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
