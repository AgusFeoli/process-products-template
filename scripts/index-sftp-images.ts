import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";
import { listAllSftpImagesForIndexing, type ImageFile } from "../lib/ftp-service";

// Load environment variables
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);
const BATCH_SIZE = 1000; // Insert 1000 images per query

interface IndexStats {
  total: number;
  processed: number;
  errors: number;
  startTime: number;
}

async function indexSftpImages() {
  const stats: IndexStats = {
    total: 0,
    processed: 0,
    errors: 0,
    startTime: Date.now(),
  };

  try {
    const imagesDir = process.env.FTP_IMAGES_DIR || "/";
    const images = await listAllSftpImagesForIndexing(imagesDir);
    stats.total = images.length;

    if (images.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const totalBatches = Math.ceil(images.length / BATCH_SIZE);

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);

      try {
        await upsertBatchOptimized(batch, now);
        stats.processed += batch.length;
      } catch (error) {
        stats.errors += batch.length;
        console.error(`Error en lote:`, error instanceof Error ? error.message : error);
      }
    }

  } catch (error) {
    console.error("Error en indexado:", error instanceof Error ? error.message : error);
    process.exit(1);
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

// Run the indexer
indexSftpImages();
