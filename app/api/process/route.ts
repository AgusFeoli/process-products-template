import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/pg-client";
import { downloadImageFromSftp } from "@/lib/ftp-service";
import { resolveProductImages } from "@/lib/image-matcher";
import { generateProductDescription, type ProductData } from "@/lib/ai-service";
import { getSkipAiProveedorIdentifiers } from "@/lib/proveedores-db";
import { BatchEngine, defaultTransientClassifier, type BatchProgress } from "@/lib/batch-engine";

// Force dynamic rendering - don't analyze during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TARGET_TABLE = process.env.TARGET_TABLE || "products";
const AI_VERSION = "2.0"; // Increment when prompt/model changes

// Skipped products tracking
interface SkippedProduct {
  id: number;
  modelo: string;
  proveedor: string;
  descripcion: string;
  descripcionEshop: string | null;
}

// Products skipped because no image was found
interface SkippedNoImage {
  id: number;
  modelo: string;
  proveedor: string;
  descripcion: string;
}

// Pending change for review
export interface PendingChange {
  id: number;
  modelo: string;
  proveedor: string;
  descripcion: string;
  oldDescripcionEshop: string | null;
  newDescripcionEshop: string;
  oldImagen: string | null;
  newImagen: string | null;
  hasImage: boolean;
  // Data needed for cache update after apply
  productUpdatedAt: string | null;
  primaryImagePath: string | null;
  imageModifyTime: string | null;
  allImagesJson: string | null;
}

// Processing state (in-memory for this instance)
let isProcessing = false;
let skippedByProviderList: SkippedProduct[] = [];
let skippedNoImageList: SkippedNoImage[] = [];
let pendingChanges: PendingChange[] = [];
let currentBatchEngine: BatchEngine<Record<string, unknown>> | null = null;
let processingStats = {
  total: 0,
  processed: 0,
  success: 0,
  errors: 0,
  skipped: 0,
  skippedByProvider: 0,
  skippedNoImage: 0,
  currentBatch: 0,
  totalBatches: 0,
  lastError: "",
  startTime: 0,
  withImage: 0,
  withoutImage: 0,
  // Batch engine stats
  activeWorkers: 0,
  currentConcurrency: 0,
  circuitState: "closed" as string,
  throughput: 0,
};

// GET: Check processing status
export async function GET() {
  // If engine is running, sync its progress into processingStats
  if (currentBatchEngine && isProcessing) {
    const ep = currentBatchEngine.getProgress();
    processingStats.activeWorkers = ep.activeWorkers;
    processingStats.currentConcurrency = ep.currentConcurrency;
    processingStats.circuitState = ep.circuitState;
    processingStats.throughput = ep.throughput;
  }

  return NextResponse.json({
    isProcessing,
    stats: processingStats,
    skippedByProviderList: !isProcessing ? skippedByProviderList : undefined,
    skippedNoImageList: !isProcessing ? skippedNoImageList : undefined,
    pendingChanges: !isProcessing ? pendingChanges : undefined,
  });
}

// POST: Start or continue processing
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || "start";

  if (action === "stop") {
    isProcessing = false;
    if (currentBatchEngine) {
      currentBatchEngine.stop();
    }
    return NextResponse.json({
      success: true,
      message: "Procesamiento detenido",
      stats: processingStats,
    });
  }

  if (action === "status") {
    return NextResponse.json({
      isProcessing,
      stats: processingStats,
    });
  }

  // Apply selected changes
  if (action === "apply") {
    const selectedIds: number[] = body.selectedIds || [];
    // Accept changes from client as fallback when in-memory state is lost (hot-reload)
    const clientChanges: PendingChange[] = body.changes || [];
    // Accept edited descriptions from the review dialog
    const editedDescriptions: Record<string, string> = body.editedDescriptions || {};

    if (selectedIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No se seleccionaron cambios para aplicar",
      });
    }

    // Use in-memory pendingChanges if available, otherwise use client-sent data
    const changesToApply = pendingChanges.length > 0 ? pendingChanges : clientChanges;

    if (changesToApply.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No hay cambios pendientes para aplicar. Volvé a procesar con IA.",
      });
    }

    try {
      const sql = getSql();
      const now = new Date().toISOString();
      let applied = 0;

      for (const change of changesToApply) {
        if (!selectedIds.includes(change.id)) continue;

        // Use edited description if available, otherwise use AI-generated
        const descToApply = String(change.id) in editedDescriptions
          ? editedDescriptions[String(change.id)]
          : change.newDescripcionEshop;

        // Apply the change to the database
        if (change.newImagen) {
          await sql(
            `UPDATE "${TARGET_TABLE}"
             SET descripcion_eshop = $1,
                 imagen = $2,
                 ia = true,
                 updated_at = $3
             WHERE id = $4`,
            [descToApply, change.newImagen, now, change.id]
          );
        } else {
          await sql(
            `UPDATE "${TARGET_TABLE}"
             SET descripcion_eshop = $1,
                 ia = true,
                 updated_at = $2
             WHERE id = $3`,
            [descToApply, now, change.id]
          );
        }

        // Update AI cache
        await updateAiCache(
          change.id,
          change.productUpdatedAt,
          change.primaryImagePath,
          change.imageModifyTime ? new Date(change.imageModifyTime) : null,
          change.allImagesJson
        );

        applied++;
      }

      // Clear pending changes after apply
      pendingChanges = [];
      skippedByProviderList = [];
      skippedNoImageList = [];

      return NextResponse.json({
        success: true,
        message: `Se aplicaron ${applied} cambios exitosamente`,
        applied,
      });
    } catch (error) {
      console.error("Error applying changes:", error);
      return NextResponse.json({
        success: false,
        message: error instanceof Error ? error.message : "Error al aplicar cambios",
      });
    }
  }

  // Save manually edited descriptions (for skipped products or manual edits)
  if (action === "save-descriptions") {
    const descriptions: Record<string, string> = body.descriptions || {};
    const ids = Object.keys(descriptions);

    if (ids.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No hay descripciones para guardar",
      });
    }

    try {
      const sql = getSql();
      const now = new Date().toISOString();
      let saved = 0;

      for (const idStr of ids) {
        const id = Number(idStr);
        const desc = descriptions[idStr];
        if (!id || desc === undefined) continue;

        await sql(
          `UPDATE "${TARGET_TABLE}"
           SET descripcion_eshop = $1,
               updated_at = $2
           WHERE id = $3`,
          [desc, now, id]
        );
        saved++;
      }

      return NextResponse.json({
        success: true,
        message: `Se guardaron ${saved} descripciones`,
        saved,
      });
    } catch (error) {
      console.error("Error saving descriptions:", error);
      return NextResponse.json({
        success: false,
        message: error instanceof Error ? error.message : "Error al guardar descripciones",
      });
    }
  }

  // Discard all pending changes
  if (action === "discard") {
    pendingChanges = [];
    skippedByProviderList = [];
    skippedNoImageList = [];
    return NextResponse.json({
      success: true,
      message: "Cambios descartados",
    });
  }

  // Start processing
  if (isProcessing) {
    return NextResponse.json({
      success: false,
      message: "Ya hay un proceso en ejecucion",
      stats: processingStats,
    });
  }

  // Start background processing
  isProcessing = true;
  skippedByProviderList = [];
  skippedNoImageList = [];
  pendingChanges = [];
  processingStats = {
    total: 0,
    processed: 0,
    success: 0,
    errors: 0,
    skipped: 0,
    skippedByProvider: 0,
    skippedNoImage: 0,
    currentBatch: 0,
    totalBatches: 0,
    lastError: "",
    startTime: Date.now(),
    withImage: 0,
    withoutImage: 0,
    activeWorkers: 0,
    currentConcurrency: 0,
    circuitState: "closed",
    throughput: 0,
  };

  // Run processing in background (non-blocking)
  processAllBatches().catch((error) => {
    console.error("Background processing error:", error);
    processingStats.lastError = error instanceof Error ? error.message : "Unknown error";
    isProcessing = false;
  });

  return NextResponse.json({
    success: true,
    message: "Procesamiento iniciado",
    keepAlive: true,
  });
}

// Get fresh skip_ai provider identifiers (called per-product for real-time accuracy)
async function getFreshSkipAiProviders(): Promise<Set<string>> {
  try {
    const identifiers = await getSkipAiProveedorIdentifiers();
    return new Set(identifiers);
  } catch (err) {
    console.warn("Could not load skip_ai providers:", err);
    return new Set();
  }
}

// Main processing function — uses BatchEngine for parallel execution
async function processAllBatches() {
  try {
    const sql = getSql();

    // Get prompt template once at the start (will be passed to each product)
    const promptTemplate = await getPromptTemplate();

    // Get skip_ai provider identifiers for initial filtering
    // Note: We'll re-check at process time for accuracy
    let initialSkipAiProviders: Set<string> = await getFreshSkipAiProviders();

    // Fetch ALL unprocessed products upfront so BatchEngine can size batches
    const allProducts = await sql(
      `SELECT * FROM "${TARGET_TABLE}"
       WHERE ia IS NULL OR ia = false
       ORDER BY id`
    );

    if (allProducts.length === 0) {
      processingStats.total = 0;
      processingStats.totalBatches = 0;
      isProcessing = false;
      return;
    }

    // Separate provider-skipped products before sending to engine
    // This is an initial pass - we'll re-check in processProduct for accuracy
    const productsToProcess: Record<string, unknown>[] = [];
    for (const product of allProducts) {
      const productProveedor = String(product.proveedor || "").toLowerCase().trim();
      if (productProveedor && initialSkipAiProviders.has(productProveedor)) {
        // Mark as processed in DB and track as skipped
        const now = new Date().toISOString();
        await sql(
          `UPDATE "${TARGET_TABLE}" SET ia = true, updated_at = $1 WHERE id = $2`,
          [now, product.id]
        );
        skippedByProviderList.push({
          id: product.id as number,
          modelo: String(product.modelo || ""),
          proveedor: String(product.proveedor || ""),
          descripcion: String(product.descripcion || ""),
          descripcionEshop: (product.descripcion_eshop as string) || null,
        });
        processingStats.skippedByProvider++;
        processingStats.processed++;
      } else {
        productsToProcess.push(product);
      }
    }

    processingStats.total = allProducts.length;

    if (productsToProcess.length === 0) {
      isProcessing = false;
      return;
    }

    // Configure and create BatchEngine
    // Concurrency tuned for AI API calls (~1-5s each) + SFTP downloads
    const engine = new BatchEngine<Record<string, unknown>>(
      {
        minBatchSize: 5,
        maxBatchSize: 50,
        maxConcurrentBatches: 3,
        maxConcurrencyPerBatch: 5,
        globalMaxConcurrency: 8,       // 8 parallel AI calls max
        circuitBreakerThreshold: 10,   // Open after 10 consecutive failures
        circuitBreakerResetMs: 30000,  // Wait 30s before half-open probe
        maxRetries: 3,
        retryBaseDelayMs: 1000,
        retryMaxDelayMs: 30000,
        throttleErrorThreshold: 0.3,   // Throttle down at 30% error rate
        throttleRecoveryStreak: 15,    // Throttle up after 15 consecutive successes
        interBatchDelayMs: 50,
      },
      defaultTransientClassifier,
      // Progress callback — sync engine stats into processingStats
      (progress: BatchProgress) => {
        processingStats.currentBatch = progress.currentBatch;
        processingStats.totalBatches = progress.totalBatches;
        processingStats.activeWorkers = progress.activeWorkers;
        processingStats.currentConcurrency = progress.currentConcurrency;
        processingStats.circuitState = progress.circuitState;
        processingStats.throughput = progress.throughput;
        if (progress.lastError) {
          processingStats.lastError = progress.lastError;
        }
      }
    );

    currentBatchEngine = engine;

    // Run the engine
    const results = await engine.process(
      productsToProcess,
      // processItem: the actual per-product work
      async (product, _signal) => {
        return processProduct(product, promptTemplate);
      },
      // shouldProcess: cache-based skip check
      async (product) => {
        const productId = product.id as number;
        const productUpdatedAt = product.updated_at as string | null;
        const shouldSkip = await checkIfShouldSkip(productId, productUpdatedAt);
        return !shouldSkip;
      }
    );

    // Aggregate results into processingStats
    for (const result of results) {
      if (!result) continue;
      if (result.success && result.result) {
        const r = result.result as { skipped: boolean; hasImage: boolean };
        if (r.skipped) {
          processingStats.skipped++;
        } else {
          processingStats.success++;
          if (r.hasImage) {
            processingStats.withImage++;
          } else {
            processingStats.withoutImage++;
          }
        }
        processingStats.processed++;
      } else if (!result.success) {
        // Only count as error if it wasn't a skip (skips are tracked by engine)
        if (result.error?.message !== "Aborted") {
          processingStats.errors++;
          processingStats.processed++;
          if (result.error) {
            processingStats.lastError = result.error.message;
            console.error(`[ProcessJob] Error:`, result.error.message);
          }
        }
      }
    }
  } catch (error) {
    console.error("Fatal error:", error);
    processingStats.lastError = error instanceof Error ? error.message : "Unknown error";
  } finally {
    isProcessing = false;
    currentBatchEngine = null;
  }
}

// Get prompt template from database
async function getPromptTemplate(): Promise<string | undefined> {
  try {
    const sql = getSql();
    const result = await sql`
      SELECT prompt_template
      FROM ai_prompt_config
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `;

    if (result.length > 0 && result[0].prompt_template) {
      return result[0].prompt_template as string;
    }
    return undefined; // Will use default from ai-service
  } catch (error) {
    console.error("Error fetching prompt template:", error);
    return undefined; // Will use default from ai-service
  }
}

// Process a single product - generates description but stores as pending change
// Cache check is handled by BatchEngine's shouldProcess predicate
async function processProduct(
  product: Record<string, unknown>,
  promptTemplate?: string
): Promise<{ skipped: boolean; hasImage: boolean }> {
  const productId = product.id as number;
  const modelo = String(product.modelo || "");
  const productUpdatedAt = product.updated_at as string | null;
  const productProveedor = String(product.proveedor || "").toLowerCase().trim();

  // REAL-TIME CHECK: Re-verify skip_ai status before processing
  // This catches cases where skip_ai was toggled after the initial batch filtering
  if (productProveedor) {
    const currentSkipAiProviders = await getFreshSkipAiProviders();
    if (currentSkipAiProviders.has(productProveedor)) {
      // Provider was marked as skip_ai after initial filtering - skip now
      const sql = getSql();
      const now = new Date().toISOString();
      await sql(
        `UPDATE "${TARGET_TABLE}" SET ia = true, updated_at = $1 WHERE id = $2`,
        [now, productId]
      );
      skippedByProviderList.push({
        id: productId,
        modelo: modelo,
        proveedor: String(product.proveedor || ""),
        descripcion: String(product.descripcion || ""),
        descripcionEshop: (product.descripcion_eshop as string) || null,
      });
      processingStats.skippedByProvider++;
      return { skipped: true, hasImage: false };
    }
  }

  let imagePaths: string[] = [];
  let imageBuffers: Buffer[] = [];
  let primaryImagePath: string | null = null;
  let imageModifyTime: Date | null = null;

  if (modelo) {
    const imageMatches = await resolveProductImages(productId, modelo, 5);
    if (imageMatches.length > 0) {
      primaryImagePath = imageMatches[0].imagePath;
      imagePaths = imageMatches.map(m => m.imagePath);
      imageModifyTime = imageMatches[0].imageModifyTime;

      // Download ALL matched images so the AI can classify the product
      // based on complete visual evidence, not just a partial view
      for (const match of imageMatches) {
        const buffer = await downloadImageFromSftp(match.imagePath);
        if (buffer) {
          imageBuffers.push(buffer);
        }
      }
    }
  }

  if (imageBuffers.length === 0) {
    skippedNoImageList.push({
      id: productId,
      modelo: String(product.modelo || ""),
      proveedor: String(product.proveedor || ""),
      descripcion: String(product.descripcion || ""),
    });
    processingStats.skippedNoImage++;
    return { skipped: true, hasImage: false };
  }

  // 4. Build product data for AI
  const productData: ProductData = {
    proveedor: product.proveedor as string | null,
    modelo: product.modelo as string | null,
    descripcion: product.descripcion as string | null,
    composicion: product.composicion as string | null,
    nuevo: product.nuevo as string | boolean | null,
    preventa: product.preventa as string | boolean | null,
    sale: product.sale as string | boolean | null,
    outlet: product.outlet as string | boolean | null,
    repite_color: product.repite_color as string | null,
    prioridad: product.prioridad as string | number | null,
    video: product.video as string | null,
    imagen: primaryImagePath, // Store primary image path
  };

  // 5. Generate AI description (with images)
  const newDescription = await generateProductDescription(
    productData,
    imageBuffers,
    promptTemplate
  );

  // 6. Compute imagen value
  let imagenValue: string | null = null;
  if (imagePaths.length > 0) {
    if (imagePaths.length === 1) {
      imagenValue = imagePaths[0];
    } else {
      imagenValue = JSON.stringify(imagePaths);
    }
  }

  const allImagesJson = imagePaths.length > 0 ? JSON.stringify(imagePaths) : null;

  // 7. Store as pending change instead of writing to DB
  pendingChanges.push({
    id: productId,
    modelo: String(product.modelo || ""),
    proveedor: String(product.proveedor || ""),
    descripcion: String(product.descripcion || ""),
    oldDescripcionEshop: product.descripcion_eshop as string | null,
    newDescripcionEshop: newDescription,
    oldImagen: product.imagen as string | null,
    newImagen: imagenValue,
    hasImage: imageBuffers.length > 0,
    productUpdatedAt,
    primaryImagePath,
    imageModifyTime: imageModifyTime?.toISOString() || null,
    allImagesJson,
  });

  return { skipped: false, hasImage: imageBuffers.length > 0 };
}

// Check if product should be skipped based on cache
async function checkIfShouldSkip(
  productId: number,
  productUpdatedAt: string | null
): Promise<boolean> {
  try {
    const sql = getSql();
    const cached = await sql`
      SELECT
        ai_version,
        product_updated_at,
        image_modify_time
      FROM product_ai
      WHERE product_id = ${productId}
    `;

    if (cached.length === 0) {
      return false; // No cache, need to process
    }

    const cache = cached[0];

    // If AI version changed, need to reprocess
    if (cache.ai_version !== AI_VERSION) {
      return false;
    }

    // If product was updated since last AI generation, reprocess
    if (productUpdatedAt && cache.product_updated_at) {
      const productDate = new Date(productUpdatedAt);
      const cachedDate = new Date(cache.product_updated_at as string);
      if (productDate > cachedDate) {
        return false;
      }
    }

    // Cache is valid, skip
    return true;
  } catch {
    // If cache check fails, don't skip
    return false;
  }
}

// Update AI cache after processing
async function updateAiCache(
  productId: number,
  productUpdatedAt: string | null,
  imagePath: string | null,
  imageModifyTime: Date | null,
  allImagesJson: string | null = null
): Promise<void> {
  try {
    const sql = getSql();
    const now = new Date().toISOString();

    await sql`
      INSERT INTO product_ai (
        product_id,
        ai_version,
        ai_generated_at,
        product_updated_at,
        image_path,
        image_modify_time,
        updated_at
      )
      VALUES (
        ${productId},
        ${AI_VERSION},
        ${now}::timestamptz,
        ${productUpdatedAt}::timestamptz,
        ${imagePath},
        ${imageModifyTime?.toISOString() || null}::timestamptz,
        ${now}::timestamptz
      )
      ON CONFLICT (product_id) DO UPDATE SET
        ai_version = EXCLUDED.ai_version,
        ai_generated_at = EXCLUDED.ai_generated_at,
        product_updated_at = EXCLUDED.product_updated_at,
        image_path = EXCLUDED.image_path,
        image_modify_time = EXCLUDED.image_modify_time,
        updated_at = EXCLUDED.updated_at
    `;
  } catch (error) {
    console.error(`Failed to update AI cache for product ${productId}:`, error);
  }
}

