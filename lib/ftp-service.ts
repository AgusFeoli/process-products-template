import * as ftp from "basic-ftp";

export interface FtpConfig {
  host: string;
  user: string;
  password: string;
  port?: number;
  secure?: boolean;
}

export interface ImageFile {
  name: string;
  path: string;
  size: number;
}

// Cache for FTP file list to avoid repeated connections
let cachedFileList: ImageFile[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Get FTP configuration from environment
export function getFtpConfig(): FtpConfig {
  return {
    host: process.env.FTP_HOST || "",
    user: process.env.FTP_USER || "",
    password: process.env.FTP_PASSWORD || "",
    port: parseInt(process.env.FTP_PORT || "21", 10),
    secure: process.env.FTP_SECURE === "true",
  };
}

// List all image files from FTP server
export async function listFtpImages(
  directory: string = "/",
  forceRefresh: boolean = false
): Promise<ImageFile[]> {
  // Return cached list if still valid
  if (!forceRefresh && cachedFileList && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedFileList;
  }

  const config = getFtpConfig();

  if (!config.host || !config.user) {
    console.warn("FTP configuration incomplete, skipping image retrieval");
    return [];
  }

  const client = new ftp.Client();
  client.ftp.verbose = false;

  try {
    await client.access({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port,
      secure: config.secure,
    });

    const files = await client.list(directory);

    // Filter only image files
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const imageFiles: ImageFile[] = files
      .filter((file) => {
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        return file.isFile && imageExtensions.includes(ext);
      })
      .map((file) => ({
        name: file.name,
        path: `${directory}/${file.name}`.replace(/\/+/g, "/"),
        size: file.size,
      }));

    // Update cache
    cachedFileList = imageFiles;
    cacheTimestamp = Date.now();

    return imageFiles;
  } catch (error) {
    console.error("FTP connection error:", error);
    return [];
  } finally {
    client.close();
  }
}

// Find image matching a SKU (modelo)
export function findImageForSku(
  images: ImageFile[],
  sku: string
): ImageFile | null {
  if (!sku || !images.length) return null;

  const normalizedSku = sku.toLowerCase().trim();

  // Try exact match first (filename without extension equals SKU)
  for (const img of images) {
    const nameWithoutExt = img.name.toLowerCase().slice(0, img.name.lastIndexOf("."));
    if (nameWithoutExt === normalizedSku) {
      return img;
    }
  }

  // Try partial match (SKU contained in filename)
  for (const img of images) {
    const nameLower = img.name.toLowerCase();
    if (nameLower.includes(normalizedSku)) {
      return img;
    }
  }

  // Try match with SKU variations (underscores, hyphens)
  const skuVariations = [
    normalizedSku.replace(/[-_]/g, ""),
    normalizedSku.replace(/\s+/g, "-"),
    normalizedSku.replace(/\s+/g, "_"),
  ];

  for (const img of images) {
    const nameNormalized = img.name.toLowerCase().replace(/[-_]/g, "");
    for (const variation of skuVariations) {
      if (nameNormalized.includes(variation)) {
        return img;
      }
    }
  }

  return null;
}

// Clear the cache (useful when needing fresh data)
export function clearFtpCache(): void {
  cachedFileList = null;
  cacheTimestamp = 0;
}
