import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Lazy initialization
function getSql() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  return neon(process.env.DATABASE_URL);
}

// GET: Retrieve the current prompt template
export async function GET() {
  try {
    const sql = getSql();
    
    // Get the latest prompt (by updated_at or id)
    // Try to get all columns, but handle case where new columns don't exist yet
    const result = await sql`
      SELECT
        prompt_template,
        version,
        updated_at,
        image_instructions_config,
        product_context_config
      FROM ai_prompt_config
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `.catch(async () => {
      // If new columns don't exist, try without them
      return await sql`
        SELECT prompt_template, version, updated_at
        FROM ai_prompt_config
        ORDER BY updated_at DESC, id DESC
        LIMIT 1
      `;
    });

    if (result.length === 0) {
      // Return default prompt if none exists
      return NextResponse.json({
        success: true,
        promptTemplate: null,
        message: "No prompt found, using default",
      });
    }

    return NextResponse.json({
      success: true,
      promptTemplate: result[0].prompt_template,
      version: result[0].version,
      updatedAt: result[0].updated_at,
      imageInstructionsConfig: result[0].image_instructions_config || null,
      productContextConfig: result[0].product_context_config || null,
    });
  } catch (error) {
    console.error("Error fetching prompt:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// POST: Save or update the prompt template
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      promptTemplate,
      imageInstructionsConfig,
      productContextConfig
    } = body;

    if (!promptTemplate || typeof promptTemplate !== "string") {
      return NextResponse.json(
        {
          success: false,
          error: "promptTemplate is required and must be a string",
        },
        { status: 400 }
      );
    }

    const sql = getSql();
    const now = new Date().toISOString();

    // Check if a prompt already exists
    const existing = await sql`
      SELECT id FROM ai_prompt_config ORDER BY updated_at DESC LIMIT 1
    `;

    // Try to update with new columns, fallback to old structure if columns don't exist
    try {
      if (existing.length > 0) {
        // Try to update with all columns
        await sql`
          UPDATE ai_prompt_config
          SET prompt_template = ${promptTemplate},
              image_instructions_config = ${JSON.stringify(imageInstructionsConfig)}::jsonb,
              product_context_config = ${productContextConfig || null},
              updated_at = ${now}::timestamptz
          WHERE id = ${existing[0].id}
        `;
      } else {
        // Insert new prompt with all columns
        await sql`
          INSERT INTO ai_prompt_config (
            prompt_template,
            version,
            updated_at,
            image_instructions_config,
            product_context_config
          )
          VALUES (
            ${promptTemplate},
            '1.0',
            ${now}::timestamptz,
            ${JSON.stringify(imageInstructionsConfig)}::jsonb,
            ${productContextConfig || null}
          )
        `;
      }
    } catch (updateError: any) {
      // If new columns don't exist, update only prompt_template
      console.warn("New columns don't exist, updating only prompt_template:", updateError.message);
      if (existing.length > 0) {
        await sql`
          UPDATE ai_prompt_config
          SET prompt_template = ${promptTemplate},
              updated_at = ${now}::timestamptz
          WHERE id = ${existing[0].id}
        `;
      } else {
        await sql`
          INSERT INTO ai_prompt_config (prompt_template, version, updated_at)
          VALUES (${promptTemplate}, '1.0', ${now}::timestamptz)
        `;
      }
    }

    return NextResponse.json({
      success: true,
      message: "Prompt guardado exitosamente",
    });
  } catch (error) {
    console.error("Error saving prompt:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// PUT: Reset to default prompt
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { action } = body;

    if (action !== "reset") {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid action. Use { action: 'reset' }",
        },
        { status: 400 }
      );
    }

    const defaultPrompt = `Eres un redactor técnico especializado en fichas de producto para e-commerce. Tu trabajo es crear descripciones objetivas, informativas y elegantes.

IDIOMA Y TONO:
- Escribí en ESPAÑOL RIOPLATENSE (Argentina/Uruguay).
- Tono: Elegante, profesional, informativo.
- Estilo: Objetivo y descriptivo, como una ficha técnica refinada.
{{IMAGE_INSTRUCTIONS}}
DATOS DEL PRODUCTO:
{{PRODUCT_CONTEXT}}

INSTRUCCIONES:
1. Escribí una descripción en texto continuo, sin párrafos separados (máximo 60 palabras).
2. Describí el producto de forma objetiva: diseño, estilo, materiales, características.
3. Incluí detalles específicos visibles en las imágenes: corte, texturas, terminaciones.
4. Si hay información de composición o materiales, mencionála claramente.
5. NO menciones precios, descuentos, promociones u ofertas.
6. NO describas colores - la descripción se usa para todas las variantes.
7. NO uses emojis ni caracteres especiales.
8. La descripción debe ser puramente informativa, similar a una especificación técnica elegante.

FORMATO DE SALIDA:
Texto continuo descriptivo del producto. Sin títulos, sin etiquetas, sin párrafos separados.`;

    // Default variable configurations
    const defaultImageInstructions = {
      single: `[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]
- Analizá la imagen del producto para extraer detalles visuales únicos.
- Describí el estilo, textura y características visibles que hacen al producto especial.
- **NO describas el color del producto.** La misma descripción se usa para todas las variantes de color.
- Usá la imagen para enriquecer la descripción con detalles que solo se aprecian en la foto (ej: tipo de estampado, forma del cuello, acabados, accesorios incluidos, etc.).`,
      multiple: `[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]
- Tenés **{{IMAGE_COUNT}}** imágenes del producto para analizar.
- Analizá **todas** las imágenes para extraer un panorama completo de los detalles visuales.
- Describí el estilo, textura, detalles y características visibles desde diferentes ángulos.
- **NO describas el color del producto.** La misma descripción se usa para todas las variantes de color.
- Mencioná los distintos aspectos que se aprecian en cada imagen (vista frontal, detalles de primer plano, dorso, interior, etc.) para brindar una descripción rica y completa.`
    };

    const defaultProductContext = `{{MARCA}}
{{MODELO}}
{{DESCRIPCION}}
{{COMPOSICION}}
{{ESTADO}}
{{COLOR}}`;

    const sql = getSql();
    const now = new Date().toISOString();

    // Check if a prompt already exists
    const existing = await sql`
      SELECT id FROM ai_prompt_config ORDER BY updated_at DESC LIMIT 1
    `;

    try {
      if (existing.length > 0) {
        // Try to update with all columns
        await sql`
          UPDATE ai_prompt_config
          SET prompt_template = ${defaultPrompt},
              image_instructions_config = ${JSON.stringify(defaultImageInstructions)}::jsonb,
              product_context_config = ${defaultProductContext},
              updated_at = ${now}::timestamptz
          WHERE id = ${existing[0].id}
        `;
      } else {
        // Insert default with all columns
        await sql`
          INSERT INTO ai_prompt_config (
            prompt_template,
            version,
            updated_at,
            image_instructions_config,
            product_context_config
          )
          VALUES (
            ${defaultPrompt},
            '1.0',
            ${now}::timestamptz,
            ${JSON.stringify(defaultImageInstructions)}::jsonb,
            ${defaultProductContext}
          )
        `;
      }
    } catch (updateError: any) {
      // If new columns don't exist, update only prompt_template
      console.warn("New columns don't exist, updating only prompt_template:", updateError.message);
      if (existing.length > 0) {
        await sql`
          UPDATE ai_prompt_config
          SET prompt_template = ${defaultPrompt},
              updated_at = ${now}::timestamptz
          WHERE id = ${existing[0].id}
        `;
      } else {
        await sql`
          INSERT INTO ai_prompt_config (prompt_template, version, updated_at)
          VALUES (${defaultPrompt}, '1.0', ${now}::timestamptz)
        `;
      }
    }

    return NextResponse.json({
      success: true,
      message: "Prompt restaurado al valor por defecto",
      promptTemplate: defaultPrompt,
      imageInstructionsConfig: defaultImageInstructions,
      productContextConfig: defaultProductContext,
    });
  } catch (error) {
    console.error("Error resetting prompt:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
