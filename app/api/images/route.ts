import { NextRequest, NextResponse } from "next/server";
import { downloadImageFromSftp } from "@/lib/ftp-service";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const imagePath = searchParams.get("path");

    if (!imagePath) {
      return new NextResponse("Missing path parameter", { status: 400 });
    }

    // Security: Validate the path to prevent directory traversal
    if (imagePath.includes("..") || !imagePath.startsWith("/")) {
      return new NextResponse("Invalid path", { status: 400 });
    }

    // Download image from SFTP
    const imageBuffer = await downloadImageFromSftp(imagePath);

    if (!imageBuffer) {
      return new NextResponse("Image not found", { status: 404 });
    }

    // Determine content type based on file extension
    const extension = imagePath.toLowerCase().split(".").pop();
    const contentTypes: Record<string, string> = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
    };

    const contentType = contentTypes[extension || ""] || "image/jpeg";

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600", // Cache for 1 hour
      },
    });
  } catch (error) {
    console.error("Error serving image:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}
