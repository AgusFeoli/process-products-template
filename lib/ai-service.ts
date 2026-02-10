import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { neon } from "@neondatabase/serverless";

// Variable configuration interfaces
interface ImageInstructionsConfig {
  single: string;
  multiple: string;
}

interface CTAInstructionsConfig {
  nuevo: string;
  preventa: string;
  sale: string;
  outlet: string;
  default: string;
}

// Cache for variable configurations
let configCache: {
  imageInstructions?: ImageInstructionsConfig;
  productContext?: string;
  ctaInstructions?: CTAInstructionsConfig;
  lastFetch?: number;
} = {};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Load variable configurations from database
async function loadVariableConfigs(): Promise<{
  imageInstructions?: ImageInstructionsConfig;
  productContext?: string;
  ctaInstructions?: CTAInstructionsConfig;
}> {
  // Check cache first
  if (configCache.lastFetch && Date.now() - configCache.lastFetch < CACHE_TTL) {
    return {
      imageInstructions: configCache.imageInstructions,
      productContext: configCache.productContext,
      ctaInstructions: configCache.ctaInstructions,
    };
  }

  try {
    if (!process.env.DATABASE_URL) {
      return {};
    }

    const sql = neon(process.env.DATABASE_URL);
    
    const result = await sql`
      SELECT 
        image_instructions_config,
        product_context_config,
        cta_instructions_config
      FROM ai_prompt_config
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `.catch(() => {
      // If columns don't exist, return empty
      return [];
    });

    if (result.length > 0 && result[0]) {
      const configs = {
        imageInstructions: result[0].image_instructions_config as ImageInstructionsConfig | null,
        productContext: result[0].product_context_config as string | null,
        ctaInstructions: result[0].cta_instructions_config as CTAInstructionsConfig | null,
      };

      // Update cache
      configCache = {
        imageInstructions: configs.imageInstructions || undefined,
        productContext: configs.productContext || undefined,
        ctaInstructions: configs.ctaInstructions || undefined,
        lastFetch: Date.now(),
      };

      return {
        imageInstructions: configs.imageInstructions || undefined,
        productContext: configs.productContext || undefined,
        ctaInstructions: configs.ctaInstructions || undefined,
      };
    }
  } catch (error) {
    console.warn("Error loading variable configs:", error);
  }

  return {};
}

// Product data interface
export interface ProductData {
  proveedor?: string | null;
  modelo?: string | null;
  descripcion?: string | null;
  composicion?: string | null;
  nuevo?: string | boolean | null;
  preventa?: string | boolean | null;
  sale?: string | boolean | null;
  outlet?: string | boolean | null;
  repite_color?: string | null;
  prioridad?: string | number | null;
  video?: string | null;
  imagen?: string | null;
}

// Initialize OpenAI client with environment configuration
function getAIClient() {
  const apiKey = process.env.API_KEY || process.env.OPENROUTER_API_KEY;
  
  if (!apiKey || apiKey === "not-required") {
    throw new Error(
      "API_KEY or OPENROUTER_API_KEY environment variable is required. " +
      "Please set it in your .env file or environment variables."
    );
  }

  return createOpenAI({
    apiKey: apiKey,
    baseURL: process.env.OPENAI_BASE_URL || "https://openrouter.ai/api/v1",
  });
}

// Get model name from environment
function getModelName(): string {
  const model = process.env.MODEL_NAME || "auto";
  return model === "auto" ? "gpt-4o-mini" : model;
}

// Get vision model name (may differ from text model)
function getVisionModelName(): string {
  const model = process.env.VISION_MODEL_NAME || process.env.MODEL_NAME || "auto";
  return model === "auto" ? "gpt-4o-mini" : model;
}

// Build the product context string
function buildProductContext(
  product: ProductData,
  customTemplate?: string
): string {
  // Use custom template if provided
  if (customTemplate) {
    let context = customTemplate;
    
    // Replace placeholders
    if (product.proveedor) {
      context = context.replace(/\{\{MARCA\}\}/g, `Marca/Proveedor: **${product.proveedor}**`);
    } else {
      context = context.replace(/\{\{MARCA\}\}/g, "");
    }
    
    if (product.modelo) {
      context = context.replace(/\{\{MODELO\}\}/g, `Modelo/SKU: **${product.modelo}**`);
    } else {
      context = context.replace(/\{\{MODELO\}\}/g, "");
    }
    
    if (product.descripcion) {
      context = context.replace(/\{\{DESCRIPCION\}\}/g, `Descripción original: **${product.descripcion}** *(Este es el nombre/título del producto)*`);
    } else {
      context = context.replace(/\{\{DESCRIPCION\}\}/g, "");
    }
    
    if (product.composicion) {
      context = context.replace(/\{\{COMPOSICION\}\}/g, `Composición/Materiales: **${product.composicion}**`);
    } else {
      context = context.replace(/\{\{COMPOSICION\}\}/g, "");
    }
    
    // Status flags
    const flags: string[] = [];
    if (isTrue(product.nuevo)) flags.push("Producto Nuevo");
    if (isTrue(product.preventa)) flags.push("Preventa");
    if (isTrue(product.sale)) flags.push("En Oferta/Sale");
    if (isTrue(product.outlet)) flags.push("Producto Outlet");
    
    const estadoText = flags.length > 0
      ? `Estado: **${flags.join(", ")}** *(Por ej.: Producto Nuevo, Preventa, Edición Limitada, En Outlet, etc.)*`
      : "";
    context = context.replace(/\{\{ESTADO\}\}/g, estadoText);
    
    // Remove color from context - descriptions must be color-agnostic
    context = context.replace(/\{\{COLOR\}\}/g, "");
    
    // Remove empty lines
    return context.split("\n").filter(line => line.trim()).join("\n");
  }
  
  // Default behavior
  const productInfo: string[] = [];

  if (product.proveedor) {
    productInfo.push(`Marca/Proveedor: **${product.proveedor}**`);
  }
  if (product.modelo) {
    productInfo.push(`Modelo/SKU: **${product.modelo}**`);
  }
  if (product.descripcion) {
    productInfo.push(`Descripción original: **${product.descripcion}** *(Este es el nombre/título del producto)*`);
  }
  if (product.composicion) {
    productInfo.push(`Composición/Materiales: **${product.composicion}**`);
  }

  // Status flags
  const flags: string[] = [];
  if (isTrue(product.nuevo)) flags.push("Producto Nuevo");
  if (isTrue(product.preventa)) flags.push("Preventa");
  if (isTrue(product.sale)) flags.push("En Oferta/Sale");
  if (isTrue(product.outlet)) flags.push("Producto Outlet");

  if (flags.length > 0) {
    productInfo.push(`Estado: **${flags.join(", ")}** *(Por ej.: Producto Nuevo, Preventa, Edición Limitada, En Outlet, etc.)*`);
  }

  // Color intentionally omitted - descriptions must be color-agnostic

  return productInfo.join("\n");
}

// Default prompt template
const DEFAULT_PROMPT_TEMPLATE = `Eres un especialista experto en redacción de productos para e-commerce. Generá una descripción de producto convincente y atractiva.

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
1. Escribí una descripción en **texto continuo sin párrafos separados** (máximo 60 palabras). El texto debe fluir de forma continua, sin saltos de línea ni párrafos.  
2. Empezá captando la atención con un tono elegante y aspiracional, adecuado a una marca exclusiva.  
3. Destacá los **beneficios** y **características principales** del producto – su estilo, diseño y materiales – no solo las especificaciones técnicas frías. Mostrá qué lo hace especial y deseable.  
4. Incluí detalles específicos del diseño y la calidad del producto, tal como se ven en las imágenes o se infieren de los datos (ej.: corte de la prenda, tipo de tela, detalles de terminación, funcionalidad). Usá frases breves y descriptivas para cada aspecto, manteniendo la fluidez del texto.  
5. Si se proporciona información sobre la **composición o materiales**, mencionála de forma clara y atractiva. Podés integrarla al final de la descripción (ej.: "Confeccionado en algodón y lino de alta calidad", o "Composición: 100% cuero genuino").  
6. **No** incluyas información sobre el precio, descuentos ni promociones en la descripción. (Esos datos se muestran por separado en el e-commerce).  
7. Si el producto está en oferta, liquidación u outlet, **no** lo menciones en la descripción. (Evitá frases como "precio rebajado" o similares).  
8. Si el producto es nuevo, de temporada actual o una **edición limitada/exclusiva**, podés mencionarlo sutilmente para generar entusiasmo (ej.: "nueva colección", "edición especial de la temporada"), pero sin exagerar ni distraer de la descripción principal.  
9. **No** uses emojis ni caracteres especiales innecesarios. Mantené un estilo profesional y sofisticado.
10. **No** incluyas referencias a "imágenes" o comandos; la descripción debe leerse como un texto escrito por un redactor humano, no por una IA siguiendo instrucciones.
11. **NUNCA describas el color del producto.** La misma descripción se usa para todas las variantes de color del producto, por lo que no debe mencionar ningún color específico. Evitá frases como "en color negro", "tono blanco", "azul marino", etc. Si ves colores en las imágenes, ignoralos completamente en la descripción.
12. **SOBRE EL CALL-TO-ACTION (CTA)**:
    - El CTA es **OPCIONAL**. Solo incluilo si realmente suma valor y urgencia a la descripción.
    - Si la descripción ya es convincente y completa, podés finalizarla sin CTA.
    - Si decidís incluir un CTA, debe ser creativo y variado.
    - El CTA debe estar en español rioplatense y enfatizar **exclusividad** y **urgencia** cuando sea apropiado.
{{CTA_INSTRUCTIONS}}

**DESCRIPCIÓN:**  
*(A continuación, redactá la descripción siguiendo todas las instrucciones anteriores. No incluyas títulos ni etiquetas, solo el texto descriptivo en texto continuo sin párrafos separados ni saltos de línea.)*`;

// Build CTA instructions based on product attributes
function buildCTAInstructions(
  product: ProductData,
  customConfig?: CTAInstructionsConfig
): string {
  // Use custom config if provided
  if (customConfig) {
    const isNuevo = isTrue(product.nuevo);
    const isPreventa = isTrue(product.preventa);
    const isSale = isTrue(product.sale);
    const isOutlet = isTrue(product.outlet);

    // Priority order: Outlet > Sale > Preventa > Nuevo
    if (isOutlet) return customConfig.outlet;
    if (isSale) return customConfig.sale;
    if (isPreventa) return customConfig.preventa;
    if (isNuevo) return customConfig.nuevo;
    return customConfig.default;
  }
  
  // Default behavior
  const isNuevo = isTrue(product.nuevo);
  const isPreventa = isTrue(product.preventa);
  const isSale = isTrue(product.sale);
  const isOutlet = isTrue(product.outlet);

  // Priority order: Outlet > Sale > Preventa > Nuevo
  // If multiple attributes, use the highest priority one
  
  if (isOutlet) {
    return `
**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
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
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.
`;
  }

  if (isSale) {
    return `
**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
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
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares. El CTA de SALE debe ser diferente al de OUTLET.
`;
  }

  if (isPreventa) {
    return `
**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
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
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.
`;
  }

  if (isNuevo) {
    return `
**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
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
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.
`;
  }

  // Default CTA if no specific attributes
  return `
**INSTRUCCIONES ESPECÍFICAS PARA EL CTA (Call to Action):**
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
- Variá completamente el CTA. Sé creativo y evita repetir estructuras similares.
`;
  }

// Build image instruction text
function buildImageInstruction(
  imageCount: number,
  customConfig?: ImageInstructionsConfig
): string {
  if (imageCount === 0) return "";
  
  // Use custom config if provided
  if (customConfig) {
    if (imageCount === 1) {
      return customConfig.single.replace(/\{\{IMAGE_COUNT\}\}/g, "1");
    }
    return customConfig.multiple.replace(/\{\{IMAGE_COUNT\}\}/g, imageCount.toString());
  }
  
  // Default behavior
  if (imageCount === 1) {
    return `
[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]
- Analizá la imagen del producto para extraer detalles visuales únicos.
- Describí el estilo, textura y características visibles que hacen al producto especial.
- **NO describas el color del producto.** La misma descripción se usa para todas las variantes de color.
- Usá la imagen para enriquecer la descripción con detalles que solo se aprecian en la foto (ej: tipo de estampado, forma del cuello, acabados, accesorios incluidos, etc.).
`;
  }

  return `
[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]
- Tenés **${imageCount}** imágenes del producto para analizar.
- Analizá **todas** las imágenes para extraer un panorama completo de los detalles visuales.
- Describí el estilo, textura, detalles y características visibles desde diferentes ángulos.
- **NO describas el color del producto.** La misma descripción se usa para todas las variantes de color.
- Mencioná los distintos aspectos que se aprecian en cada imagen (vista frontal, detalles de primer plano, dorso, interior, etc.) para brindar una descripción rica y completa.
`;
}

// Build the final prompt from template
async function buildPrompt(
  productContext: string,
  imageCount: number,
  product: ProductData,
  customTemplate?: string
): Promise<string> {
  const template = customTemplate || DEFAULT_PROMPT_TEMPLATE;
  
  // Load variable configs
  const configs = await loadVariableConfigs();
  
  const imageInstruction = buildImageInstruction(imageCount, configs.imageInstructions);
  const ctaInstructions = buildCTAInstructions(product, configs.ctaInstructions);
  
  // Replace placeholders
  return template
    .replace(/\{\{IMAGE_INSTRUCTIONS\}\}/g, imageInstruction)
    .replace(/\{\{PRODUCT_CONTEXT\}\}/g, productContext)
    .replace(/\{\{CTA_INSTRUCTIONS\}\}/g, ctaInstructions);
}

// Generate e-commerce product description using AI (text only or with images)
export async function generateProductDescription(
  product: ProductData,
  imageBuffers?: Buffer[] | Buffer | null,
  customPromptTemplate?: string
): Promise<string> {
  const client = getAIClient();
  
  // Load variable configs to get custom product context template
  const configs = await loadVariableConfigs();
  const productContext = buildProductContext(product, configs.productContext);
  
  // Normalize to array
  const images = Array.isArray(imageBuffers) 
    ? imageBuffers.filter(img => img && img.length > 0)
    : imageBuffers && imageBuffers.length > 0 
      ? [imageBuffers] 
      : [];
  
  // If we have images, use multimodal generation
  if (images.length > 0) {
    return generateMultimodalDescription(client, productContext, images, product, customPromptTemplate);
  }

  // Text-only generation
  const model = client.chat(getModelName());
  const prompt = await buildPrompt(productContext, 0, product, customPromptTemplate);

  try {
    const result = await generateText({
      model,
      prompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    // Remove line breaks and replace with spaces, then fix punctuation
    const cleanedText = result.text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    return fixSpanishPunctuation(cleanedText);
  } catch (error) {
    console.error("AI generation error:", error);
    throw new Error(
      `Failed to generate description: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

// Generate description with images (multimodal)
async function generateMultimodalDescription(
  client: ReturnType<typeof createOpenAI>,
  productContext: string,
  imageBuffers: Buffer[],
  product: ProductData,
  customPromptTemplate?: string
): Promise<string> {
  const model = client.chat(getVisionModelName());
  const prompt = await buildPrompt(productContext, imageBuffers.length, product, customPromptTemplate);

  // Convert buffers to base64 data URLs
  const imageContents = imageBuffers.map(buffer => {
    const base64Image = buffer.toString("base64");
    const mimeType = detectImageMimeType(buffer);
    return {
      type: "image" as const,
      image: `data:${mimeType};base64,${base64Image}`,
    };
  });

  try {
    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            ...imageContents, // Add all images
            {
              type: "text",
              text: prompt,
            },
          ],
        },
      ],
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    // Remove line breaks and replace with spaces, then fix punctuation
    const cleanedText = result.text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    return fixSpanishPunctuation(cleanedText);
  } catch (error) {
    // If multimodal fails, fall back to text-only
    console.warn("Multimodal generation failed, falling back to text-only:", error);
    
    const textModel = client.chat(getModelName());
    const textPrompt = await buildPrompt(productContext, 0, product, customPromptTemplate);
    
    const result = await generateText({
      model: textModel,
      prompt: textPrompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    // Remove line breaks and replace with spaces, then fix punctuation
    const cleanedText = result.text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    return fixSpanishPunctuation(cleanedText);
  }
}

// Detect MIME type from image buffer magic bytes
function detectImageMimeType(buffer: Buffer): string {
  // Check magic bytes
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return "image/gif";
  }
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46
  ) {
    return "image/webp";
  }
  // Default to JPEG
  return "image/jpeg";
}

// Fix Spanish punctuation: ensure ¡/¿ are paired with !/?
// This function ensures that:
// 1. If a sentence starts with ¡, it must end with !
// 2. If a sentence starts with ¿, it must end with ?
// 3. If a sentence ends with !, it should start with ¡ (if it's a new sentence)
// 4. If a sentence ends with ?, it should start with ¿ (if it's a new sentence)
function fixSpanishPunctuation(text: string): string {
  let result = text;
  
  // FIRST: Fix sentences that START with ¡ or ¿ but don't have the closing mark
  
  // Pattern 1: Fix sentences that start with ¡ but don't end with ! (at end of text)
  // Example: "¡Hacelas tuyas hoy mismo" -> "¡Hacelas tuyas hoy mismo!"
  result = result.replace(/(¡[^!?.]*?)(\s*)$/gm, (match, sentence, trailing) => {
    const trimmed = sentence.trim();
    // If it starts with ¡ and doesn't end with !, ?, or ., add !
    if (trimmed.startsWith('¡') && !trimmed.endsWith('!') && !trimmed.endsWith('?') && !trimmed.endsWith('.')) {
      return sentence + '!' + trailing;
    }
    return match;
  });
  
  // Pattern 2: Fix sentences that start with ¿ but don't end with ? (at end of text)
  result = result.replace(/(¿[^!?.]*?)(\s*)$/gm, (match, sentence, trailing) => {
    const trimmed = sentence.trim();
    if (trimmed.startsWith('¿') && !trimmed.endsWith('?') && !trimmed.endsWith('!') && !trimmed.endsWith('.')) {
      return sentence + '?' + trailing;
    }
    return match;
  });
  
  // Pattern 3: Fix sentences that start with ¡ but don't end with ! (before a period)
  // Example: "¡Hacelas tuyas hoy mismo." -> "¡Hacelas tuyas hoy mismo!."
  result = result.replace(/(¡[^!?.]*?)(\s*)(\.)/g, (match, sentence, space, period) => {
    const trimmed = sentence.trim();
    // If it starts with ¡ and doesn't end with !, add ! before the period
    if (trimmed.startsWith('¡') && !trimmed.endsWith('!') && !trimmed.endsWith('?')) {
      return sentence + '!' + space + period;
    }
    return match;
  });
  
  // Pattern 4: Fix sentences that start with ¿ but don't end with ? (before a period)
  result = result.replace(/(¿[^!?.]*?)(\s*)(\.)/g, (match, sentence, space, period) => {
    const trimmed = sentence.trim();
    if (trimmed.startsWith('¿') && !trimmed.endsWith('?') && !trimmed.endsWith('!')) {
      return sentence + '?' + space + period;
    }
    return match;
  });
  
  // SECOND: Fix sentences that END with ! or ? but don't have the opening mark
  
  // Pattern 5: Fix sentences that start after punctuation and end with ! but lack ¡
  result = result.replace(/([.!?]\s+)([A-ZÁÉÍÓÚÑ][^¡!]*!)/g, (match, prefix, sentence) => {
    if (!sentence.trim().startsWith('¡')) {
      return prefix + '¡' + sentence;
    }
    return match;
  });
  
  // Pattern 6: Fix sentences at the start of text or after newlines that end with ! but lack ¡
  result = result.replace(/(^|\n\s*)([A-ZÁÉÍÓÚÑ][^¡!]*!)/gm, (match, prefix, sentence) => {
    if (!sentence.trim().startsWith('¡')) {
      return prefix + '¡' + sentence;
    }
    return match;
  });
  
  // Pattern 7: Fix sentences that start after punctuation and end with ? but lack ¿
  result = result.replace(/([.!?]\s+)([A-ZÁÉÍÓÚÑ][^¿?]*\?)/g, (match, prefix, sentence) => {
    if (!sentence.trim().startsWith('¿')) {
      return prefix + '¿' + sentence;
    }
    return match;
  });
  
  // Pattern 8: Fix sentences at the start of text or after newlines that end with ? but lack ¿
  result = result.replace(/(^|\n\s*)([A-ZÁÉÍÓÚÑ][^¿?]*\?)/gm, (match, prefix, sentence) => {
    if (!sentence.trim().startsWith('¿')) {
      return prefix + '¿' + sentence;
    }
    return match;
  });
  
  // Pattern 9: Fix cases where a sentence starts after a comma and ends with ! but lacks ¡
  result = result.replace(/(,\s+)([A-ZÁÉÍÓÚÑ][^¡!]*!)/g, (match, commaSpace, sentence) => {
    if (!sentence.trim().startsWith('¡')) {
      return commaSpace + '¡' + sentence;
    }
    return match;
  });
  
  // Pattern 10: Fix cases where a sentence starts after a semicolon and ends with ! but lacks ¡
  result = result.replace(/(;\s+)([A-ZÁÉÍÓÚÑ][^¡!]*!)/g, (match, semicolonSpace, sentence) => {
    if (!sentence.trim().startsWith('¡')) {
      return semicolonSpace + '¡' + sentence;
    }
    return match;
  });
  
  return result;
}

// Helper function to check if a value is truthy
function isTrue(value: string | boolean | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.toLowerCase().trim();
    // Support "S" (Sí) and "N" (No) as used in the products table
    if (lower === "s" || lower === "si" || lower === "sí") return true;
    if (lower === "n" || lower === "no") return false;
    // Support other common formats
    return lower === "true" || value === "1";
  }
  return false;
}

// Test AI connection
export async function generateDescriptionVariants(
  originalDescription: string,
  product: ProductData,
  count: number = 3
): Promise<string[]> {
  const client = getAIClient();
  const model = client.chat(getModelName());

  // Load variable configs to get custom product context template
  const configs = await loadVariableConfigs();
  const productContext = buildProductContext(product, configs.productContext);

  const prompt = `Basándote en esta descripción existente y el contexto del producto, generá ${count} variantes diferentes de la descripción para e-commerce.

**DESCRIPCIÓN ORIGINAL:**
${originalDescription}

**CONTEXTO DEL PRODUCTO:**
${productContext}

**INSTRUCCIONES PARA LAS VARIACIONES:**
1. Cada variante debe ser única y diferente de la original
2. Mantener el mismo tono elegante y aspiracional
3. Destacar diferentes aspectos del producto en cada variante
4. **IMPORTANTE: MANTENER LA MISMA ESTRUCTURA** de la descripción original (mismo número de párrafos, misma organización, misma longitud aproximada)
5. Solo variar el contenido, las palabras y las frases, pero respetando la estructura original
6. Mantener la información esencial (materiales, diseño, beneficios)
7. Usar español rioplatense profesional
8. No incluir emojis ni caracteres especiales
9. Cada variante debe ser convincente y atractiva
10. Basarse en las mismas instrucciones y contexto que la descripción original

**FORMATO DE RESPUESTA:**
Devolvé exactamente ${count} variantes separadas por "---VARIANTE---" (sin incluir este texto en las variantes finales).

VARIANTE 1:
[texto de la variante 1]

---VARIANTE---

VARIANTE 2:
[texto de la variante 2]

---VARIANTE---

VARIANTE 3:
[texto de la variante 3]`;

  try {
    const result = await generateText({
      model,
      prompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 1200, // More tokens for multiple variants
    });

    const text = result.text.trim();

    // Split by the separator and clean up
    const variants = text
      .split('---VARIANTE---')
      .map(v => v.trim())
      .filter(v => v.length > 0)
      // Remove "VARIANTE X:" prefixes
      .map(v => v.replace(/^VARIANTE \d+:\s*/i, '').trim())
      // Fix Spanish punctuation
      .map(v => fixSpanishPunctuation(v));

    // Ensure we return exactly the requested count, taking the first ones if more were generated
    return variants.slice(0, count);
  } catch (error) {
    console.error("AI variants generation error:", error);
    throw new Error(
      `Failed to generate variants: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

export async function testAIConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const client = getAIClient();
    const model = client.chat(getModelName());

    const result = await generateText({
      model,
      prompt: "Responde solo 'OK' si puedes leer este mensaje.",
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 10,
    });

    return {
      success: true,
      message: `AI connection successful. Response: ${result.text}`,
    };
  } catch (error) {
    return {
      success: false,
      message: `AI connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
