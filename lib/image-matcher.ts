import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export interface MatchedImage {
  id: number;
  path: string;
  name: string;
  size: number;
  modifyTime: Date | null;
  score: number;
  matchedBy: string;
}

export interface ProductImageMatch {
  productId: number;
  imagePath: string;
  matchScore: number;
  matchedBy: string;
  imageModifyTime: Date | null;
}

/**
 * Find the best matching image for a product based on its modelo (SKU).
 * Uses pg_trgm index for fast ILIKE searches.
 * 
 * Scoring heuristics:
 * - Exact match (filename without extension = modelo): 100
 * - Exact match with _0 suffix: 95
 * - Exact match with _1, _2, etc suffix: 90
 * - Contains match: 50 - penalty based on length difference
 */
export async function findBestImageForModelo(
  modelo: string
): Promise<MatchedImage | null> {
  if (!modelo || modelo.trim() === "") {
    return null;
  }

  const modeloLower = modelo.toLowerCase().trim();
  
  try {
    // Search for images that contain the modelo in their name
    // Using pg_trgm index for fast ILIKE
    const candidates = await sql`
      SELECT 
        id,
        path,
        name,
        name_lower,
        size,
        modify_time
      FROM sftp_images
      WHERE name_lower ILIKE ${"%" + modeloLower + "%"}
      LIMIT 50
    `;

    if (candidates.length === 0) {
      return null;
    }

    // Score each candidate
    let bestMatch: MatchedImage | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const nameLower = candidate.name_lower as string;
      const nameWithoutExt = nameLower.slice(0, nameLower.lastIndexOf("."));
      
      let score = 0;
      let matchedBy = "contains";

      // Exact match (modelo = filename without extension)
      if (nameWithoutExt === modeloLower) {
        score = 100;
        matchedBy = "exact";
      }
      // Exact match with _0 suffix (primary image)
      else if (nameWithoutExt === `${modeloLower}_0`) {
        score = 95;
        matchedBy = "exact_primary";
      }
      // Exact match with other suffixes (_1, _2, etc.)
      else if (/^.+_\d+$/.test(nameWithoutExt) && nameWithoutExt.startsWith(modeloLower + "_")) {
        score = 90;
        matchedBy = "exact_secondary";
      }
      // Contains match - score based on how close the length is
      else {
        const lengthDiff = nameWithoutExt.length - modeloLower.length;
        // Penalize longer filenames (more noise)
        score = Math.max(10, 50 - lengthDiff);
        matchedBy = "contains";
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          id: candidate.id as number,
          path: candidate.path as string,
          name: candidate.name as string,
          size: candidate.size as number,
          modifyTime: candidate.modify_time ? new Date(candidate.modify_time as string) : null,
          score,
          matchedBy,
        };
      }
    }

    return bestMatch;
  } catch (error) {
    console.error(`Error finding image for modelo ${modelo}:`, error);
    return null;
  }
}

/**
 * Get cached image match for a product.
 * Returns null if no cached match exists.
 */
export async function getCachedProductImage(
  productId: number
): Promise<ProductImageMatch | null> {
  try {
    const result = await sql`
      SELECT 
        product_id,
        image_path,
        match_score,
        matched_by,
        image_modify_time
      FROM product_images
      WHERE product_id = ${productId}
        AND is_primary = TRUE
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    return {
      productId: result[0].product_id as number,
      imagePath: result[0].image_path as string,
      matchScore: result[0].match_score as number,
      matchedBy: result[0].matched_by as string,
      imageModifyTime: result[0].image_modify_time 
        ? new Date(result[0].image_modify_time as string) 
        : null,
    };
  } catch (error) {
    console.error(`Error getting cached image for product ${productId}:`, error);
    return null;
  }
}

/**
 * Save image match to cache (product_images table).
 */
export async function saveProductImageMatch(
  productId: number,
  match: MatchedImage
): Promise<void> {
  try {
    await sql`
      INSERT INTO product_images (
        product_id, 
        image_path, 
        match_score, 
        matched_by, 
        image_modify_time,
        is_primary,
        matched_at
      )
      VALUES (
        ${productId}, 
        ${match.path}, 
        ${match.score}, 
        ${match.matchedBy}, 
        ${match.modifyTime?.toISOString() || null}::timestamptz,
        TRUE,
        NOW()
      )
      ON CONFLICT (product_id, image_path) DO UPDATE SET
        match_score = EXCLUDED.match_score,
        matched_by = EXCLUDED.matched_by,
        image_modify_time = EXCLUDED.image_modify_time,
        matched_at = NOW()
    `;
  } catch (error) {
    console.error(`Error saving image match for product ${productId}:`, error);
  }
}

/**
 * Resolve image for a product: use cache if available, otherwise find and cache.
 */
export async function resolveProductImage(
  productId: number,
  modelo: string
): Promise<ProductImageMatch | null> {
  // Check cache first
  const cached = await getCachedProductImage(productId);
  if (cached) {
    return cached;
  }

  // Find best match
  const match = await findBestImageForModelo(modelo);
  if (!match) {
    return null;
  }

  // Cache the result
  await saveProductImageMatch(productId, match);

  return {
    productId,
    imagePath: match.path,
    matchScore: match.score,
    matchedBy: match.matchedBy,
    imageModifyTime: match.modifyTime,
  };
}

/**
 * Clear cached image matches for a product (useful when reprocessing).
 */
export async function clearProductImageCache(productId: number): Promise<void> {
  try {
    await sql`DELETE FROM product_images WHERE product_id = ${productId}`;
  } catch (error) {
    console.error(`Error clearing image cache for product ${productId}:`, error);
  }
}

/**
 * Get stats about image matching.
 */
export async function getImageMatchingStats(): Promise<{
  totalImages: number;
  matchedProducts: number;
  unmatchedProducts: number;
}> {
  try {
    const [imagesResult, matchedResult] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM sftp_images`,
      sql`SELECT COUNT(DISTINCT product_id) as count FROM product_images`,
    ]);

    return {
      totalImages: Number(imagesResult[0]?.count || 0),
      matchedProducts: Number(matchedResult[0]?.count || 0),
      unmatchedProducts: 0, // Would need to join with products table
    };
  } catch (error) {
    console.error("Error getting image matching stats:", error);
    return { totalImages: 0, matchedProducts: 0, unmatchedProducts: 0 };
  }
}

