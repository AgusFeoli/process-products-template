import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { listFtpImages, findImageForSku, clearFtpCache } from "@/lib/ftp-service";
import { generateProductDescription, type ProductData } from "@/lib/ai-service";

const sql = neon(process.env.DATABASE_URL!);
const TARGET_TABLE = process.env.TARGET_TABLE || "products";
const BATCH_SIZE = 50;

// Processing state (in-memory for this instance)
let isProcessing = false;
let processingStats = {
  total: 0,
  processed: 0,
  success: 0,
  errors: 0,
  currentBatch: 0,
  totalBatches: 0,
  lastError: "",
  startTime: 0,
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
    currentBatch: 0,
    totalBatches: 0,
    lastError: "",
    startTime: Date.now(),
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
    // Clear FTP cache to get fresh file list
    clearFtpCache();

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

    // Get FTP images list once
    const ftpImages = await listFtpImages(process.env.FTP_IMAGES_DIR || "/");
    console.log(`Found ${ftpImages.length} images on FTP server`);

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

      console.log(`Processing batch ${batchNumber}: ${batch.length} products`);

      // Process each product in the batch
      for (const product of batch) {
        if (!isProcessing) break;

        try {
          await processProduct(product, ftpImages);
          processingStats.success++;
        } catch (error) {
          processingStats.errors++;
          processingStats.lastError = error instanceof Error ? error.message : "Unknown error";
          console.error(`Error processing product ${product.id}:`, error);
        }

        processingStats.processed++;
      }

      // Small delay between batches to avoid overwhelming the system
      await delay(100);
    }
  } catch (error) {
    console.error("Batch processing error:", error);
    processingStats.lastError = error instanceof Error ? error.message : "Unknown error";
  } finally {
    isProcessing = false;
  }
}

// Process a single product
async function processProduct(
  product: Record<string, unknown>,
  ftpImages: Awaited<ReturnType<typeof listFtpImages>>
) {
  const productId = product.id;
  const sku = String(product.modelo || "");

  // 1. Find matching image
  let imagePath: string | null = null;
  if (sku && ftpImages.length > 0) {
    const matchedImage = findImageForSku(ftpImages, sku);
    if (matchedImage) {
      imagePath = matchedImage.path;
      console.log(`Found image for SKU ${sku}: ${imagePath}`);
    }
  }

  // 2. Generate AI description
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

  const newDescription = await generateProductDescription(productData);

  // 3. Update database
  const now = new Date().toISOString();

  // Build update query based on whether we have an image
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
}

// Utility function
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
