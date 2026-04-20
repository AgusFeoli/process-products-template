import * as SftpClientModule from "ssh2-sftp-client";
const SftpClient = SftpClientModule.default || SftpClientModule;

export interface ImageFile {
  name: string;
  path: string;
  size: number;
  modifyTime?: Date;
}

interface SftpConfig {
  host: string;
  user: string;
  password: string;
  port: number;
}

// Get SFTP configuration from environment
function getSftpConfig(): SftpConfig {
  return {
    host: process.env.FTP_HOST || "",
    user: process.env.FTP_USER || "",
    password: process.env.FTP_PASSWORD || "",
    port: parseInt(process.env.FTP_PORT || "22", 10), // SFTP default port is 22
  };
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
