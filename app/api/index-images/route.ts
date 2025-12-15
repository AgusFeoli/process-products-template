import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { listAllSftpImagesForIndexing, type ImageFile } from "@/lib/ftp-service";

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = 1000; // Insert 1000 images per query

// State for tracking indexing progress
let isIndexing = false;
let indexingStats = {
  total: 0,
  processed: 0,
  errors: 0,
  currentBatch: 0,
  totalBatches: 0,
  startTime: 0,
};

// GET: Check indexing status
export async function GET() {
  // Also get current DB count
  let dbCount = 0;
  try {
    const result = await sql`SELECT COUNT(*) as count FROM sftp_images`;
    dbCount = Number(result[0]?.count || 0);
  } catch {
    // Table might not exist yet
  }

  return NextResponse.json({
    isIndexing,
    stats: indexingStats,
    dbCount,
  });
}

// POST: Start indexing or get status
export async function POST() {
  if (isIndexing) {
    return NextResponse.json({
      success: false,
      message: "Ya hay un proceso de indexado en ejecución",
      stats: indexingStats,
    });
  }

  // Start indexing in background
  isIndexing = true;
  indexingStats = {
    total: 0,
    processed: 0,
    errors: 0,
    currentBatch: 0,
    totalBatches: 0,
    startTime: Date.now(),
  };

  // Run in background
  runIndexing().catch((error) => {
    console.error("Indexing error:", error);
    indexingStats.errors++;
    isIndexing = false;
  });

  return NextResponse.json({
    success: true,
    message: "Indexado iniciado",
  });
}

async function runIndexing() {
  try {
    const imagesDir = process.env.FTP_IMAGES_DIR || "/";
    const images = await listAllSftpImagesForIndexing(imagesDir);
    indexingStats.total = images.length;
    indexingStats.totalBatches = Math.ceil(images.length / BATCH_SIZE);

    if (images.length === 0) {
      isIndexing = false;
      return;
    }

    const now = new Date().toISOString();

    // Process in batches
    for (let i = 0; i < images.length && isIndexing; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      indexingStats.currentBatch = Math.floor(i / BATCH_SIZE) + 1;

      try {
        await upsertBatchOptimized(batch, now);
        indexingStats.processed += batch.length;
      } catch (error) {
        indexingStats.errors += batch.length;
        console.error("Batch error:", error);
      }
    }
  } catch (error) {
    console.error("Fatal error:", error);
    indexingStats.errors++;
  } finally {
    isIndexing = false;
  }
}

/**
 * Batch upsert using a single query with UNNEST arrays.
 * This is ~100x faster than individual inserts.
 */
async function upsertBatchOptimized(
  images: ImageFile[],
  seenAt: string
): Promise<void> {
  // Prepare arrays for batch insert
  const paths: string[] = [];
  const names: string[] = [];
  const namesLower: string[] = [];
  const sizes: number[] = [];
  const modifyTimes: (string | null)[] = [];
  const seenAts: string[] = [];

  for (const img of images) {
    paths.push(img.path);
    names.push(img.name);
    namesLower.push(img.name.toLowerCase());
    sizes.push(img.size);
    modifyTimes.push(img.modifyTime?.toISOString() || null);
    seenAts.push(seenAt);
  }

  // Single query to upsert all images in the batch
  await sql`
    INSERT INTO sftp_images (path, name, name_lower, size, modify_time, seen_at)
    SELECT * FROM UNNEST(
      ${paths}::text[],
      ${names}::text[],
      ${namesLower}::text[],
      ${sizes}::bigint[],
      ${modifyTimes}::timestamptz[],
      ${seenAts}::timestamptz[]
    )
    ON CONFLICT (path) DO UPDATE SET
      name = EXCLUDED.name,
      name_lower = EXCLUDED.name_lower,
      size = EXCLUDED.size,
      modify_time = EXCLUDED.modify_time,
      seen_at = EXCLUDED.seen_at
  `;
}
