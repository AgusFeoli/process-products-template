import { NextRequest, NextResponse } from "next/server";
import { generateDescriptionVariants, type ProductData } from "@/lib/ai-service";

// Force dynamic rendering - don't analyze during build
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { originalDescription, productData } = body;

    if (!originalDescription || typeof originalDescription !== 'string') {
      return NextResponse.json({
        success: false,
        error: "Se requiere una descripción original válida"
      }, { status: 400 });
    }

    if (!productData || typeof productData !== 'object') {
      return NextResponse.json({
        success: false,
        error: "Se requieren datos del producto válidos"
      }, { status: 400 });
    }

    // Generate variants using AI
    const variants = await generateDescriptionVariants(
      originalDescription.trim(),
      productData as ProductData,
      3
    );

    return NextResponse.json({
      success: true,
      variants
    });

  } catch (error) {
    console.error("Error generando variantes:", error);

    const errorMessage = error instanceof Error
      ? error.message
      : "Error desconocido al generar variantes";

    return NextResponse.json({
      success: false,
      error: errorMessage
    }, { status: 500 });
  }
}