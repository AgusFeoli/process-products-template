import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { downloadImageFromSftp } from "@/lib/ftp-service";
import { resolveProductImage } from "@/lib/image-matcher";
import { generateProductDescription, type ProductData } from "@/lib/ai-service";

// Force dynamic rendering - don't analyze during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Lazy initialization to avoid issues during build
function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(process.env.DATABASE_URL);
}

const TARGET_TABLE = process.env.TARGET_TABLE || "products";
const BATCH_SIZE = 50;
const AI_VERSION = "2.0"; // Increment when prompt/model changes

// Processing state (in-memory for this instance)
let isProcessing = false;
let processingStats = {
  total: 0,
  processed: 0,
  success: 0,
  errors: 0,
  skipped: 0,
  currentBatch: 0,
  totalBatches: 0,
  lastError: "",
  startTime: 0,
  withImage: 0,
  withoutImage: 0,
};

// GET: Check processing status
export async function GET() {
  return NextResponse.json({
    isProcessing,
    stats: processingStats,
  });
}

// POST: Start or continue processing
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const action = body.action || "start";

  if (action === "stop") {
    isProcessing = false;
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
  processingStats = {
    total: 0,
    processed: 0,
    success: 0,
    errors: 0,
    skipped: 0,
    currentBatch: 0,
    totalBatches: 0,
    lastError: "",
    startTime: Date.now(),
    withImage: 0,
    withoutImage: 0,
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

// Main processing function
async function processAllBatches() {
  try {
    const sql = getSql();
    
    // Get total count of products to process (ia = false or ia IS NULL)
    const countResult = await sql(
      `SELECT COUNT(*) as count FROM "${TARGET_TABLE}" WHERE ia IS NULL OR ia = false`
    );
    const totalCount = Number(countResult[0]?.count || 0);

    if (totalCount === 0) {
      processingStats.total = 0;
      processingStats.totalBatches = 0;
      isProcessing = false;
      return;
    }

    processingStats.total = totalCount;
    processingStats.totalBatches = Math.ceil(totalCount / BATCH_SIZE);

    // Check if we have indexed images
    const imageCountResult = await sql`SELECT COUNT(*) as count FROM sftp_images`;
    const indexedImageCount = Number(imageCountResult[0]?.count || 0);

    let batchNumber = 0;

    // Process in batches until all done or stopped
    while (isProcessing) {
      batchNumber++;
      processingStats.currentBatch = batchNumber;

      // Fetch next batch of unprocessed products
      const batch = await sql(
        `SELECT * FROM "${TARGET_TABLE}"
         WHERE ia IS NULL OR ia = false
         ORDER BY id
         LIMIT ${BATCH_SIZE}`
      );

      if (batch.length === 0) {
        // No more products to process
        break;
      }

      // Process each product in the batch
      for (const product of batch) {
        if (!isProcessing) break;

        try {
          const result = await processProduct(product);
          if (result.skipped) {
            processingStats.skipped++;
          } else {
            processingStats.success++;
            if (result.hasImage) {
              processingStats.withImage++;
            } else {
              processingStats.withoutImage++;
            }
          }
        } catch (error) {
          processingStats.errors++;
          processingStats.lastError = error instanceof Error ? error.message : "Unknown error";
          console.error(`[ProcessJob] Error product ${product.id}:`, error);
        }

        processingStats.processed++;
      }

      // Small delay between batches to avoid overwhelming the system
      await delay(100);
    }
  } catch (error) {
    console.error("Fatal error:", error);
    processingStats.lastError = error instanceof Error ? error.message : "Unknown error";
  } finally {
    isProcessing = false;
  }
}

// Process a single product
async function processProduct(
  product: Record<string, unknown>
): Promise<{ skipped: boolean; hasImage: boolean }> {
  const productId = product.id as number;
  const modelo = String(product.modelo || "");
  const productUpdatedAt = product.updated_at as string | null;

  // 1. Check cache to see if we should skip
  const shouldSkip = await checkIfShouldSkip(productId, productUpdatedAt);
  if (shouldSkip) {
    return { skipped: true, hasImage: false };
  }

  // 2. Resolve image using indexed DB (fast trigram search + cache)
  let imagePath: string | null = null;
  let imageBuffer: Buffer | null = null;
  let imageModifyTime: Date | null = null;

  if (modelo) {
      const imageMatch = await resolveProductImage(productId, modelo);
      if (imageMatch) {
        imagePath = imageMatch.imagePath;
        imageModifyTime = imageMatch.imageModifyTime;

        // 3. Download image for multimodal AI
        imageBuffer = await downloadImageFromSftp(imagePath);
      }
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
    imagen: imagePath,
  };

  // 5. Generate AI description (with image if available)
  const newDescription = await generateProductDescription(productData, imageBuffer);

  // 6. Update product in database
  const now = new Date().toISOString();
  const sql = getSql();

  if (imagePath) {
    await sql(
      `UPDATE "${TARGET_TABLE}"
       SET descripcion_eshop = $1,
           imagen = $2,
           ia = true,
           updated_at = $3
       WHERE id = $4`,
      [newDescription, imagePath, now, productId]
    );
  } else {
    await sql(
      `UPDATE "${TARGET_TABLE}"
       SET descripcion_eshop = $1,
           ia = true,
           updated_at = $2
       WHERE id = $3`,
      [newDescription, now, productId]
    );
  }

  // 7. Update AI cache/version tracking
  await updateAiCache(productId, productUpdatedAt, imagePath, imageModifyTime);

  return { skipped: false, hasImage: !!imageBuffer };
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
  imageModifyTime: Date | null
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

// Utility function
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
