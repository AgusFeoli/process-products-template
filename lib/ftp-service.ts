import * as SftpClientModule from "ssh2-sftp-client";
const SftpClient = SftpClientModule.default || SftpClientModule;

export interface SftpConfig {
  host: string;
  user: string;
  password: string;
  port: number;
}

export interface ImageFile {
  name: string;
  path: string;
  size: number;
  modifyTime?: Date;
}

// Cache for SFTP file list to avoid repeated connections
let cachedFileList: ImageFile[] | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Get SFTP configuration from environment
export function getSftpConfig(): SftpConfig {
  return {
    host: process.env.FTP_HOST || "",
    user: process.env.FTP_USER || "",
    password: process.env.FTP_PASSWORD || "",
    port: parseInt(process.env.FTP_PORT || "22", 10), // SFTP default port is 22
  };
}

// List all image files from SFTP server
export async function listFtpImages(
  directory: string = "/",
  forceRefresh: boolean = false
): Promise<ImageFile[]> {
  // Return cached list if still valid
  if (!forceRefresh && cachedFileList && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return cachedFileList;
  }

  const config = getSftpConfig();

  if (!config.host || !config.user) {
    console.warn("SFTP configuration incomplete, skipping image retrieval");
    return [];
  }

  const client = new SftpClient();

  try {
    await client.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
    });

    const files = await client.list(directory);

    // Filter only image files
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const imageFiles: ImageFile[] = files
      .filter((file) => {
        if (file.type !== "-") return false; // Only files, not directories
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        return imageExtensions.includes(ext);
      })
      .map((file) => ({
        name: file.name,
        path: `${directory}/${file.name}`.replace(/\/+/g, "/"),
        size: file.size,
        modifyTime: file.modifyTime ? new Date(file.modifyTime) : undefined,
      }));

    // Update cache
    cachedFileList = imageFiles;
    cacheTimestamp = Date.now();

    return imageFiles;
  } catch (error) {
    console.error("SFTP connection error:", error);
    return [];
  } finally {
    await client.end();
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

// Download a single image from SFTP and return as Buffer
export async function downloadImageFromSftp(imagePath: string): Promise<Buffer | null> {
  const config = getSftpConfig();

  if (!config.host || !config.user) {
    console.warn("SFTP configuration incomplete, cannot download image");
    return null;
  }

  const client = new SftpClient();

  try {
    await client.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
    });

    // Download file as buffer
    const buffer = await client.get(imagePath) as Buffer;
    return buffer;
  } catch (error) {
    console.error(`SFTP download error for ${imagePath}:`, error);
    return null;
  } finally {
    await client.end();
  }
}

// List all files (with full metadata) for indexing
export async function listAllSftpImagesForIndexing(
  directory: string = "/"
): Promise<ImageFile[]> {
  const config = getSftpConfig();

  if (!config.host || !config.user) {
    console.warn("SFTP configuration incomplete, skipping image retrieval");
    return [];
  }

  const client = new SftpClient();

  try {
    await client.connect({
      host: config.host,
      port: config.port,
      username: config.user,
      password: config.password,
    });

    const files = await client.list(directory);

    // Filter only image files
    const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
    const imageFiles: ImageFile[] = files
      .filter((file) => {
        if (file.type !== "-") return false;
        const ext = file.name.toLowerCase().slice(file.name.lastIndexOf("."));
        return imageExtensions.includes(ext);
      })
      .map((file) => ({
        name: file.name,
        path: `${directory}/${file.name}`.replace(/\/+/g, "/"),
        size: file.size,
        modifyTime: file.modifyTime ? new Date(file.modifyTime) : undefined,
      }));

    return imageFiles;
  } catch (error) {
    console.error("SFTP connection error:", error);
    return [];
  } finally {
    await client.end();
  }
}
