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
        product_context_config,
        cta_instructions_config
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
      ctaInstructionsConfig: result[0].cta_instructions_config || null,
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
      productContextConfig, 
      ctaInstructionsConfig 
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
              cta_instructions_config = ${JSON.stringify(ctaInstructionsConfig)}::jsonb,
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
            product_context_config,
            cta_instructions_config
          )
          VALUES (
            ${promptTemplate}, 
            '1.0', 
            ${now}::timestamptz,
            ${JSON.stringify(imageInstructionsConfig)}::jsonb,
            ${productContextConfig || null},
            ${JSON.stringify(ctaInstructionsConfig)}::jsonb
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
11. **SOBRE EL CALL-TO-ACTION (CTA)**: 
    - El CTA es **OPCIONAL**. Solo incluilo si realmente suma valor y urgencia a la descripción.
    - Si la descripción ya es convincente y completa, podés finalizarla sin CTA.
    - Si decidís incluir un CTA, debe ser creativo y variado.
    - El CTA debe estar en español rioplatense y enfatizar **exclusividad** y **urgencia** cuando sea apropiado.
{{CTA_INSTRUCTIONS}}

**DESCRIPCIÓN:**  
*(A continuación, redactá la descripción siguiendo todas las instrucciones anteriores. No incluyas títulos ni etiquetas, solo el texto descriptivo en párrafos.)*`;

    // Default variable configurations
    const defaultImageInstructions = {
      single: `[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]  
- Analizá la imagen del producto para extraer detalles visuales únicos.  
- Describí el estilo, color, textura y características visibles que hacen al producto especial.  
- Usá la imagen para enriquecer la descripción con detalles que solo se aprecian en la foto (ej: tipo de estampado, forma del cuello, acabados, accesorios incluidos, etc.).`,
      multiple: `[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]  
- Tenés **{{IMAGE_COUNT}}** imágenes del producto para analizar.  
- Analizá **todas** las imágenes para extraer un panorama completo de los detalles visuales.  
- Describí el estilo, color, textura, detalles y características visibles desde diferentes ángulos.  
- Mencioná los distintos aspectos que se aprecian en cada imagen (vista frontal, detalles de primer plano, dorso, interior, etc.) para brindar una descripción rica y completa.`
    };

    const defaultProductContext = `{{MARCA}}
{{MODELO}}
{{DESCRIPCION}}
{{COMPOSICION}}
{{ESTADO}}
{{COLOR}}`;

    const defaultCtaInstructions = {
      nuevo: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **NUEVO**.
- El CTA debe enfatizar **novedad**, **exclusividad**, **estar a la vanguardia** y **ser de los primeros**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"Descubrí esta novedad exclusiva"*
  *"Sé de los primeros en tenerlo"*
  *"Llevate el tuyo, es edición nueva"*
  *"No te pierdas esta pieza única"*
  *"Sumalo a tu colección, es tendencia"*
  *"Está nuevo, descubrilo primero"*
  *"Novedad exclusiva, llevatela ya"*
  *"Sé la primera en tenerlo"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`,
      preventa: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **PREVENTA**.
- El CTA debe enfatizar **reservar**, **asegurar**, **anticiparse** y **ser de los primeros**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"Reservá el tuyo ahora y asegurate de tenerlo"*
  *"Sé de los primeros en llevártelo"*
  *"Anticipate y reservalo ya"*
  *"Asegurá tu pieza, reservalo ahora"*
  *"No te quedes sin el tuyo, reservalo"*
  *"Reservalo antes que se agote"*
  *"Asegurá tu lugar, es preventa"*
  *"Anticipate y llevatelo primero"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`,
      sale: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **SALE** (en oferta).
- El CTA debe enfatizar **oportunidad**, **aprovechar la oferta** y **no perder el momento**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"¡Aprovechá esta oferta especial!"*
  *"No dejes pasar esta oportunidad"*
  *"Sumalo a tu guardarropa, es tu momento"*
  *"Llevatelo ahora, está en oferta"*
  *"Aprovechá el precio especial"*
  *"No te pierdas esta oportunidad única"*
  *"Hacelo tuyo mientras está en oferta"*
  *"Es el momento ideal para sumarlo"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares. El CTA de SALE debe ser diferente al de OUTLET.`,
      outlet: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El producto está marcado como **OUTLET** (liquidación final).
- El CTA debe enfatizar **última oportunidad**, **stock limitado**, **no volver a encontrar** y **liquidación final**.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"¡Última oportunidad! No volverás a encontrarlo"*
  *"Stock limitado, no te quedes sin el tuyo"*
  *"Liquidación final, aprovechá antes de que se agote"*
  *"Últimas unidades, no te lo pierdas"*
  *"Esta es tu última chance, llevatelo ya"*
  *"No volverás a verlo a este precio"*
  *"Aprovechá esta liquidación, quedan pocos"*
  *"Última oportunidad de tenerlo"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`,
      default: `**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
- El CTA debe enfatizar **exclusividad** y **urgencia** de adquirir el producto.
- Ejemplos de CTAs apropiados en rioplatense (usá como inspiración, pero creá el tuyo propio):
  *"¡Llevate el tuyo antes de que se agote!"*
  *"Descubrí esta pieza única y exclusiva"*
  *"No te lo pierdas"*
  *"Sumalo a tu colección ahora"*
  *"Hacelo tuyo, quedan pocas unidades"*
  *"Llevatelo, es exclusivo"*
  *"No dejes pasar esta oportunidad"*
  *"Sumalo a tu guardarropa ya"*
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.`
    };

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
              cta_instructions_config = ${JSON.stringify(defaultCtaInstructions)}::jsonb,
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
            product_context_config,
            cta_instructions_config
          )
          VALUES (
            ${defaultPrompt}, 
            '1.0', 
            ${now}::timestamptz,
            ${JSON.stringify(defaultImageInstructions)}::jsonb,
            ${defaultProductContext},
            ${JSON.stringify(defaultCtaInstructions)}::jsonb
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
      ctaInstructionsConfig: defaultCtaInstructions,
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
