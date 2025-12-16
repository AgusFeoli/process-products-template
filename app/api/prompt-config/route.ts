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
    const result = await sql`
      SELECT prompt_template, version, updated_at
      FROM ai_prompt_config
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `;

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
    const { promptTemplate } = body;

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

    if (existing.length > 0) {
      // Update existing prompt
      await sql`
        UPDATE ai_prompt_config
        SET prompt_template = ${promptTemplate},
            updated_at = ${now}::timestamptz
        WHERE id = ${existing[0].id}
      `;
    } else {
      // Insert new prompt
      await sql`
        INSERT INTO ai_prompt_config (prompt_template, version, updated_at)
        VALUES (${promptTemplate}, '1.0', ${now}::timestamptz)
      `;
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

    const defaultPrompt = `Eres un especialista experto en redacción de productos para e-commerce. Generá una descripción de producto convincente y atractiva.

IMPORTANTE - IDIOMA Y ESTILO:
- Todo el contenido debe estar en ESPAÑOL LATINO RIOPLATENSE (estilo Argentina/Uruguay - Cono Sur).
- Usá el voseo: "vos" en lugar de "tú" (ej: "llevate", "descubrí", "sumá", "elegí", "no te pierdas").
- Usá expresiones naturales del Río de la Plata.
- Esta es una marca uruguaya que busca atraer clientas con productos **EXCLUSIVOS** y **ORIGINALES**.
- El tono debe ser elegante y aspiracional, destacando la exclusividad y originalidad del producto.
- Los llamados a la acción (CTAs) deben transmitir **urgencia** y **exclusividad**.
{{IMAGE_INSTRUCTIONS}}
DATOS DEL PRODUCTO:  
{{PRODUCT_CONTEXT}}

INSTRUCCIONES:  
1. Escribí una descripción de 2 a 3 **párrafos cortos** (en total máximo 60 palabras).  
2. Empezá captando la atención con un tono elegante y aspiracional, adecuado a una marca exclusiva.  
3. Destacá los **beneficios** y **características principales** del producto – su estilo, diseño y materiales – no solo las especificaciones técnicas frías. Mostrá qué lo hace especial y deseable.  
4. Incluí detalles específicos del diseño y la calidad del producto, tal como se ven en las imágenes o se infieren de los datos (ej.: corte de la prenda, tipo de tela, detalles de terminación, funcionalidad). Usá frases breves y descriptivas para cada aspecto, manteniendo la fluidez del texto.  
5. Si se proporciona información sobre la **composición o materiales**, mencionála de forma clara y atractiva. Podés integrarla al final de la descripción (ej.: "Confeccionado en algodón y lino de alta calidad", o "Composición: 100% cuero genuino").  
6. **No** incluyas información sobre el precio, descuentos ni promociones en la descripción. (Esos datos se muestran por separado en el e-commerce).  
7. Si el producto está en oferta, liquidación u outlet, **no** lo menciones en la descripción. (Evitá frases como "precio rebajado" o similares).  
8. Si el producto es nuevo, de temporada actual o una **edición limitada/exclusiva**, podés mencionarlo sutilmente para generar entusiasmo (ej.: "nueva colección", "edición especial de la temporada"), pero sin exagerar ni distraer de la descripción principal.  
9. **No** uses emojis ni caracteres especiales innecesarios. Mantené un estilo profesional y sofisticado.  
10. **No** incluyas referencias a "imágenes" o comandos; la descripción debe leerse como un texto escrito por un redactor humano, no por una IA siguiendo instrucciones.  
11. **IMPORTANTE**: La descripción DEBE terminar con un **call-to-action (CTA)** atractivo en español rioplatense, que enfatice la **exclusividad** y **urgencia** de adquirir el producto. Por ejemplo: *"¡Llevate el tuyo antes de que se agote!"*, *"Descubrí esta pieza única y exclusiva"*, *"No te lo pierdas, es edición limitada"*, *"Sumalo a tu colección ahora"*, *"Hacelo tuyo, quedan pocas unidades"*.

**DESCRIPCIÓN:**  
*(A continuación, redactá la descripción siguiendo todas las instrucciones anteriores. No incluyas títulos ni etiquetas, solo el texto descriptivo en párrafos.)*`;

    const sql = getSql();
    const now = new Date().toISOString();

    // Check if a prompt already exists
    const existing = await sql`
      SELECT id FROM ai_prompt_config ORDER BY updated_at DESC LIMIT 1
    `;

    if (existing.length > 0) {
      // Update to default
      await sql`
        UPDATE ai_prompt_config
        SET prompt_template = ${defaultPrompt},
            updated_at = ${now}::timestamptz
        WHERE id = ${existing[0].id}
      `;
    } else {
      // Insert default
      await sql`
        INSERT INTO ai_prompt_config (prompt_template, version, updated_at)
        VALUES (${defaultPrompt}, '1.0', ${now}::timestamptz)
      `;
    }

    return NextResponse.json({
      success: true,
      message: "Prompt restaurado al valor por defecto",
      promptTemplate: defaultPrompt,
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
