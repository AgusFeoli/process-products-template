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

// Background processing function — runs after the response is sent
async function processAiJob(
  jobId: string,
  productsForAi: Array<Record<string, string | number>>,
  keywordContext: string,
  systemPrompt: string
) {
  const BATCH_SIZE = 20;
  let totalProcessed = 0;
  let totalSuccessful = 0;
  let totalFailed = 0;
  const errors: string[] = [];

  const client = createOpenAI({
    apiKey: process.env.API_KEY,
    baseURL:
      process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });

  const modelName = process.env.MODEL_NAME || "gpt-4o-mini";

  await updateAiJobProgress(jobId, { status: "processing" });

  for (
    let batchStart = 0;
    batchStart < productsForAi.length;
    batchStart += BATCH_SIZE
  ) {
    // Check if job was cancelled before processing next batch
    try {
      const currentJob = await getAiJob(jobId);
      if (currentJob && currentJob.status === "cancelled") {
        console.log(`AI job ${jobId} was cancelled. Stopping processing.`);
        return; // Exit immediately — job already marked as cancelled in DB
      }
    } catch (checkErr) {
      console.error("Failed to check job cancellation status:", checkErr);
    }

    const batch = productsForAi.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;

    try {
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
        totalSuccessful += updated;
      }
    } catch (batchError) {
      const msg =
        batchError instanceof Error
          ? batchError.message
          : "Unknown AI error";
      errors.push(`Batch ${batchNumber}: ${msg}`);
      totalFailed += batch.length;
      console.error(`AI batch ${batchNumber} error:`, batchError);
    }

    totalProcessed += batch.length;

    // Update progress in DB after each batch
    try {
      await updateAiJobProgress(jobId, {
        processed_products: totalProcessed,
        successful_products: totalSuccessful,
        failed_products: totalFailed,
        errors: errors.length > 0 ? JSON.stringify(errors) : undefined,
      });
    } catch (progressError) {
      console.error("Failed to update job progress:", progressError);
    }
  }

  // Check if job was cancelled before setting final status
  try {
    const finalJob = await getAiJob(jobId);
    if (finalJob && finalJob.status === "cancelled") {
      return; // Already cancelled, don't overwrite status
    }
  } catch {
    // Continue to set final status
  }

  // Mark job as completed or failed
  const finalStatus = totalSuccessful > 0 ? "completed" : "failed";
  try {
    await updateAiJobProgress(jobId, {
      status: finalStatus,
      processed_products: totalProcessed,
      successful_products: totalSuccessful,
      failed_products: totalFailed,
      errors: errors.length > 0 ? JSON.stringify(errors) : undefined,
    });
  } catch (err) {
    console.error("Failed to update final job status:", err);
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
