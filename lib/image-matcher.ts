import { neon } from "@neondatabase/serverless";

// Lazy initialization to avoid issues during build
function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(process.env.DATABASE_URL);
}

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
 * Find all matching images for a product based on its modelo (SKU).
 * Uses pg_trgm index for fast ILIKE searches.
 * Returns images sorted by score (best first).
 * 
 * If modelo has a color suffix (e.g., "51701_9"), also searches for base modelo ("51701").
 * 
 * Scoring heuristics:
 * - Exact match (filename without extension = modelo): 100
 * - Exact match with _0 suffix: 95
 * - Exact match with _1, _2, etc suffix: 90
 * - Base modelo match (when searching with color suffix): 85
 * - Contains match: 50 - penalty based on length difference
 */
export async function findAllImagesForModelo(
  modelo: string,
  maxImages: number = 10
): Promise<MatchedImage[]> {
  if (!modelo || modelo.trim() === "") {
    return [];
  }

  const modeloLower = modelo.toLowerCase().trim().replace(/%+$/, '');
  if (!modeloLower) {
    return [];
  }

  const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&');
  const modeloEscaped = escapeLike(modeloLower);

  // Extract base modelo if it has a color suffix (format: modelo_color, e.g., "51701_9")
  // Pattern: ends with _ followed by digits
  const colorSuffixMatch = modeloLower.match(/^(.+)_(\d+)$/);
  const baseModelo = colorSuffixMatch ? colorSuffixMatch[1] : null;
  const isColorVariant = baseModelo !== null;

  try {
    const sql = getSql();

    const searchPatterns: string[] = [`%${modeloEscaped}%`];
    if (isColorVariant && baseModelo) {
      searchPatterns.push(`%${escapeLike(baseModelo)}%`);
    }
    
    // Search for images that contain any of the search patterns
    // Using pg_trgm index for fast ILIKE
    // Build OR conditions for each pattern
    let candidates;
    if (searchPatterns.length === 1) {
      candidates = await sql`
        SELECT DISTINCT
          id,
          path,
          name,
          name_lower,
          size,
          modify_time
        FROM sftp_images
        WHERE name_lower ILIKE ${searchPatterns[0]}
        LIMIT 100
      `;
    } else {
      // Multiple patterns: use OR
      candidates = await sql`
        SELECT DISTINCT
          id,
          path,
          name,
          name_lower,
          size,
          modify_time
        FROM sftp_images
        WHERE name_lower ILIKE ${searchPatterns[0]}
           OR name_lower ILIKE ${searchPatterns[1]}
        LIMIT 100
      `;
    }

    if (candidates.length === 0) {
      return [];
    }

    // Score all candidates
    const scoredMatches: MatchedImage[] = [];
    const seenPaths = new Set<string>(); // Avoid duplicates

    for (const candidate of candidates) {
      const nameLower = candidate.name_lower as string;
      const nameWithoutExt = nameLower.slice(0, nameLower.lastIndexOf("."));
      const path = candidate.path as string;
      
      // Skip if we've already processed this path
      if (seenPaths.has(path)) {
        continue;
      }
      seenPaths.add(path);
      
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
      // Exact match with other suffixes (_1, _2, etc.) for full modelo
      else if (/^.+_\d+$/.test(nameWithoutExt) && nameWithoutExt.startsWith(modeloLower + "_")) {
        score = 90;
        matchedBy = "exact_secondary";
      }
      // Base modelo match (when searching with color variant)
      // e.g., modelo is "51701_9" and image is "51701_0.jpg" or "51701_1.jpg"
      else if (isColorVariant && baseModelo && nameWithoutExt.startsWith(baseModelo + "_")) {
        // Check if it's a numbered suffix (like _0, _1, _2)
        const baseMatch = nameWithoutExt.match(new RegExp(`^${baseModelo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(\\d+)$`));
        if (baseMatch) {
          score = 85;
          matchedBy = "base_modelo";
        } else {
          // Base modelo but not with numbered suffix
          score = 70;
          matchedBy = "base_modelo_contains";
        }
      }
      // Contains match - score based on how close the length is
      else {
        const lengthDiff = nameWithoutExt.length - modeloLower.length;
        // Penalize longer filenames (more noise)
        score = Math.max(10, 50 - lengthDiff);
        matchedBy = "contains";
      }

      // Only include matches with score >= 30 (filter out very weak matches)
      if (score >= 30) {
        scoredMatches.push({
          id: candidate.id as number,
          path: candidate.path as string,
          name: candidate.name as string,
          size: candidate.size as number,
          modifyTime: candidate.modify_time ? new Date(candidate.modify_time as string) : null,
          score,
          matchedBy,
        });
      }
    }

    // Sort by score (descending), but prioritize _0 (primary) images as the first result
    // This ensures the main product image (_0) is shown in the dialog even if other images score higher
    scoredMatches.sort((a, b) => {
      // First, prioritize images ending with _0 (primary product image)
      const aIsPrimary = a.name.toLowerCase().match(/_0\.[^.]+$/);
      const bIsPrimary = b.name.toLowerCase().match(/_0\.[^.]+$/);

      if (aIsPrimary && !bIsPrimary) return -1;
      if (!aIsPrimary && bIsPrimary) return 1;

      // Then sort by score
      return b.score - a.score;
    });
    return scoredMatches.slice(0, maxImages);
  } catch (error) {
    console.error(`Error finding images for modelo ${modelo}:`, error);
    return [];
  }
}

/**
 * Find the best matching image for a product (backward compatibility).
 */
export async function findBestImageForModelo(
  modelo: string
): Promise<MatchedImage | null> {
  const matches = await findAllImagesForModelo(modelo, 1);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Get all cached image matches for a product.
 * Returns empty array if no cached matches exist.
 */
export async function getCachedProductImages(
  productId: number
): Promise<ProductImageMatch[]> {
  try {
    const sql = getSql();
    const result = await sql`
      SELECT 
        product_id,
        image_path,
        match_score,
        matched_by,
        image_modify_time,
        is_primary
      FROM product_images
      WHERE product_id = ${productId}
      ORDER BY is_primary DESC, match_score DESC
    `;

    return result.map((row) => ({
      productId: row.product_id as number,
      imagePath: row.image_path as string,
      matchScore: row.match_score as number,
      matchedBy: row.matched_by as string,
      imageModifyTime: row.image_modify_time 
        ? new Date(row.image_modify_time as string) 
        : null,
    }));
  } catch (error) {
    console.error(`Error getting cached images for product ${productId}:`, error);
    return [];
  }
}

/**
 * Get cached primary image match for a product (backward compatibility).
 */
export async function getCachedProductImage(
  productId: number
): Promise<ProductImageMatch | null> {
  const images = await getCachedProductImages(productId);
  return images.length > 0 ? images[0] : null;
}

/**
 * Save multiple image matches to cache (product_images table).
 * The first image (highest score) is marked as primary.
 */
export async function saveProductImageMatches(
  productId: number,
  matches: MatchedImage[]
): Promise<void> {
  if (matches.length === 0) return;

  try {
    const sql = getSql();
    
    // First, delete existing matches for this product
    await sql`DELETE FROM product_images WHERE product_id = ${productId}`;

    // Insert all matches, marking the first one as primary
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
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
          ${i === 0}, -- First image is primary
          NOW()
        )
      `;
    }
  } catch (error) {
    console.error(`Error saving image matches for product ${productId}:`, error);
  }
}

/**
 * Save single image match (backward compatibility).
 */
export async function saveProductImageMatch(
  productId: number,
  match: MatchedImage
): Promise<void> {
  await saveProductImageMatches(productId, [match]);
}

/**
 * Resolve all images for a product: use cache if available, otherwise find and cache.
 * Returns array of images sorted by score (best first).
 */
export async function resolveProductImages(
  productId: number,
  modelo: string,
  maxImages: number = 5
): Promise<ProductImageMatch[]> {
  // Check cache first
  const cached = await getCachedProductImages(productId);
  if (cached.length > 0) {
    return cached;
  }

  // Find all matches
  const matches = await findAllImagesForModelo(modelo, maxImages);
  if (matches.length === 0) {
    return [];
  }

  // Cache all results
  await saveProductImageMatches(productId, matches);

  return matches.map((match) => ({
    productId,
    imagePath: match.path,
    matchScore: match.score,
    matchedBy: match.matchedBy,
    imageModifyTime: match.modifyTime,
  }));
}

/**
 * Resolve single image for a product (backward compatibility).
 */
export async function resolveProductImage(
  productId: number,
  modelo: string
): Promise<ProductImageMatch | null> {
  const images = await resolveProductImages(productId, modelo, 1);
  return images.length > 0 ? images[0] : null;
}

/**
 * Clear cached image matches for a product (useful when reprocessing).
 */
export async function clearProductImageCache(productId: number): Promise<void> {
  try {
    const sql = getSql();
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
    const sql = getSql();
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

