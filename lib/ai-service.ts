import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { neon } from "@neondatabase/serverless";

// Variable configuration interfaces
interface ImageInstructionsConfig {
  single: string;
  multiple: string;
}

// Cache for variable configurations
let configCache: {
  imageInstructions?: ImageInstructionsConfig;
  productContext?: string;
  lastFetch?: number;
} = {};

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Load variable configurations from database
async function loadVariableConfigs(): Promise<{
  imageInstructions?: ImageInstructionsConfig;
  productContext?: string;
}> {
  // Check cache first
  if (configCache.lastFetch && Date.now() - configCache.lastFetch < CACHE_TTL) {
    return {
      imageInstructions: configCache.imageInstructions,
      productContext: configCache.productContext,
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
        product_context_config
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
      };

      // Update cache
      configCache = {
        imageInstructions: configs.imageInstructions || undefined,
        productContext: configs.productContext || undefined,
        lastFetch: Date.now(),
      };

      return {
        imageInstructions: configs.imageInstructions || undefined,
        productContext: configs.productContext || undefined,
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
const DEFAULT_PROMPT_TEMPLATE = `Eres un redactor técnico especializado en fichas de producto para e-commerce. Tu trabajo es crear descripciones objetivas, informativas y elegantes.

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

  // Shared classification strategy for all image counts
  const classificationBlock = `
**ESTRATEGIA DE CLASIFICACIÓN DE PRENDA (OBLIGATORIO):**
- **PASO 1 - EXAMINÁ TODAS LAS IMÁGENES:** Mirá CADA UNA de las imágenes en detalle antes de decidir qué producto es.
- **PASO 2 - IDENTIFICÁ EL PRODUCTO PRINCIPAL:** Las imágenes pueden mostrar el producto desde diferentes ángulos o con otros items. Identificá cuál es el producto principal que se está vendiendo.
- **PASO 3 - CLASIFICÁ POR TIPO:** Categorías posibles: **parte superior** (remera, blusa, camisa, sweater, campera, chaleco, top, etc.), **parte inferior** (pantalón, jean, falda, short, bermuda, etc.), **conjunto completo/enterizo** (vestido, enterito, mono, jumpsuit, etc.), **accesorio** (cartera, bolso, cinturón, bufanda, etc.), **calzado** (zapato, bota, sandalia, etc.), **otro** (traje de baño, ropa interior, etc.).
- **CRÍTICO:** Una foto recortada o de detalle puede ser engañosa. Una foto de cerca de un cuello NO significa que sea solo un top; puede ser parte de un vestido.
- Buscá evidencia del largo total de la prenda en TODAS las imágenes: cómo cae sobre el cuerpo, si cubre piernas, torso, o ambos.
- Si ves múltiples productos en las imágenes (ej: arriba y abajo), determiná cuál es el producto principal basándote en cuál ocupa más espacio o está más destacado.
- **NUNCA** te bases en una sola imagen para clasificar. Usá la evidencia visual conjunta de TODAS las imágenes.`;

  // Default behavior
  if (imageCount === 1) {
    return `
[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]
- Analizá la imagen del producto para extraer detalles visuales únicos.
- Describí el estilo, textura y características visibles que hacen al producto especial.
- **NO describas el color del producto.** La misma descripción se usa para todas las variantes de color.
- Usá la imagen para enriquecer la descripción con detalles que solo se aprecian en la foto (ej: tipo de estampado, forma del cuello, acabados, accesorios incluidos, etc.).
${classificationBlock}
- NOTA: Solo tenés 1 imagen. Intentá determinar el tipo de prenda a partir de las pistas visuales disponibles (largo, forma, silueta). Si la imagen es un detalle o recorte, sé conservador en la clasificación y enfocate en lo que se puede confirmar visualmente.
`;
  }

  return `
[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]
- Tenés **${imageCount}** imágenes del producto para analizar.
- **IMPORTANTE: Analizá TODAS las ${imageCount} imágenes ANTES de empezar a redactar.** No te bases en la primera imagen solamente.
- Analizá **todas** las imágenes para extraer un panorama completo de los detalles visuales.
- Describí el estilo, textura, detalles y características visibles desde diferentes ángulos.
- **NO describas el color del producto.** La misma descripción se usa para todas las variantes de color.
- Mencioná los distintos aspectos que se aprecian en cada imagen (vista frontal, detalles de primer plano, dorso, interior, etc.) para brindar una descripción rica y completa.
${classificationBlock}
- Con ${imageCount} imágenes, tenés múltiples ángulos y vistas. Usá esta ventaja para confirmar el tipo de prenda con certeza antes de describir.
`;
}

// Build the final prompt from template
async function buildPrompt(
  productContext: string,
  imageCount: number,
  customTemplate?: string
): Promise<string> {
  const template = customTemplate || DEFAULT_PROMPT_TEMPLATE;

  // Load variable configs
  const configs = await loadVariableConfigs();

  const imageInstruction = buildImageInstruction(imageCount, configs.imageInstructions);

  // Replace placeholders - CTA instructions are no longer used
  return template
    .replace(/\{\{IMAGE_INSTRUCTIONS\}\}/g, imageInstruction)
    .replace(/\{\{PRODUCT_CONTEXT\}\}/g, productContext)
    .replace(/\{\{CTA_INSTRUCTIONS\}\}/g, ""); // Remove CTA placeholder entirely
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
  const prompt = await buildPrompt(productContext, 0, customPromptTemplate);

  try {
    const result = await generateText({
      model,
      prompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    // Remove line breaks and replace with spaces, then fix punctuation
    let cleanedText = result.text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    cleanedText = removeCTAs(cleanedText);
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
  const prompt = await buildPrompt(productContext, imageBuffers.length, customPromptTemplate);

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
    let cleanedText = result.text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    cleanedText = removeCTAs(cleanedText);
    return fixSpanishPunctuation(cleanedText);
  } catch (error) {
    // If multimodal fails, fall back to text-only
    console.warn("Multimodal generation failed, falling back to text-only:", error);
    
    const textModel = client.chat(getModelName());
    const textPrompt = await buildPrompt(productContext, 0, customPromptTemplate);
    
    const result = await generateText({
      model: textModel,
      prompt: textPrompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    // Remove line breaks and replace with spaces, then fix punctuation
    let cleanedText = result.text.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
    cleanedText = removeCTAs(cleanedText);
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

// Remove CTAs (Call-to-Action phrases) from text
function removeCTAs(text: string): string {
  // Common CTA patterns in Spanish that should be removed
  // These phrases typically appear at the end of descriptions
  const ctaPatterns = [
    // "No te quedes sin" variations - MUST BE FIRST
    /\s*[¡!]?\s*(?:no\s+te\s+quedes?\s+sin\s+(?:el\s+tuyo|la\s+tuya|los\s+tuyos|las\s+tuyas|esta|este|estos|estas))[\s\S]*?[.!,]?$/gi,
    // Stock/availability urgency (includes "asegurate", "stock", etc.)
    /\s*[¡!]?\s*(?:asegurat[ea]\s+(?:el\s+)?tuy[oa]|asegurat[ea]\s+(?:tu\s+)?(?:prenda|pieza|lugar)|antes\s+de\s+que\s+(?:se\s+)?agot[ée]\s+(?:el\s+)?stock|stock\s+limitado|últimas?\s+unidades?|ultimas?\s+unidades?|pocas?\s+unidades?|últimos?\s+disponibles?|ultimos?\s+disponibles?)[\s\S]*?[.!,]?$/gi,
    // Direct purchase commands
    /\s*[¡!]?\s*(?:compralo|cómpralo|comprala|cómprala|comprar|adquiere|adquirilo|adquirila|llevalo|llévalo|llevatela|llevatelo|llevatela|obtenelo|obtenela|conseguido|conseguida|conseguilo|conseguido|adquierelo|adquierela)[\s\S]*?[.!,]?$/gi,
    // Urgency phrases
    /\s*[¡!]?\s*(?:no\s+te\s+lo\s+pierdas?|no\s+te\s+la\s+pierdas?|no\s+te\s+los\s+pierdas?|no\s+te\s+las\s+pierdas?|aprovech[aá]|aprovech[aá]\s+esta\s+oportunidad|ultima\s+oportunidad|última\s+oportunidad|tiempo\s+limitado|por\s+tiempo\s+limitado|no\s+esperes\s+más|no\s+esperes\s+mas)[\s\S]*?[.!,]?$/gi,
    // Collection/possession phrases
    /\s*[¡!]?\s*(?:sumalo\s+a\s+tu\s+colección|sumala\s+a\s+tu\s+colección|sumalo\s+a\s+tu\s+coleccion|sumala\s+a\s+tu\s+coleccion|hacelo\s+tuyo|hacela\s+tuya|hacelas\s+tuyas|hacelos\s+tuyos|tenelo\s+cerca|tenela\s+cerca)[\s\S]*?[.!,]?$/gi,
    // Discovery phrases used as CTAs
    /\s*[¡!]?\s*(?:descubr[íi]\s+(?:esta\s+)?(?:pieza|prenda|bolsos?|zapatos?|accesorio)[\s\S]*?|descubr[íi]\s+el\s+(?:estilo|diseño|encanto)[\s\S]*?)[.!,]?$/gi,
    // Invitation to buy phrases
    /\s*[¡!]?\s*(?:eleg[íi]lo|eleg[íi]la|eleg[íi]\s+(?:tu\s+)?(?:talle|color|estilo)|encargalo|encargala|reservalo|reserala|reservá|reserva)[\s\S]*?[.!,]?$/gi,
    // General CTAs at end of sentence
    /\s*[¡!]?\s*(?:y[aá]\s+disponible|disponible\s+y[aá]|disponible\s+ahora|compralo\s+ahora|comprala\s+ahora|cómpralo\s+ahora|cómprala\s+ahora)[\s\S]*?[.!,]?$/gi,
    // "Make it yours" type endings
    /\s*[¡!]?\s*(?:hacelo\s+tuyo|hacela\s+tuya|hacelos\s+tuyos|hacelas\s+tuyas)\s*[.!,]?$/gi,
    // Visit/shop phrases
    /\s*[¡!]?\s*(?:visit[aá]|conoc[eé]|explor[aá]|mir[aá]|vere?\s+m[aá]s|ver\s+mas|chequealo|chequeala)[\s\S]*?[.!,]?$/gi,
    // Possession with "ya" or "hoy"
    /\s*[¡!]?\s*(?:llevatelo\s+ya|llevatela\s+ya|llevatelo\s+hoy|llevatela\s+hoy|tenelo\s+ya|tenela\s+ya|consiguelo\s+ya|consiguela\s+ya)[\s\S]*?[.!,]?$/gi,
    // "Hoy" (today) urgency CTAs
    /\s*[¡!]?\s*(?:hoy\s+mismo|esta\s+semana|esta\s+temporada|ahora\s+mismo|en\s+este\s+momento)[\s\S]*?[.!,]?$/gi,
    // "Tu" (your) possession phrases
    /\s*[¡!]?\s*(?:sé\s+la\s+primera|se\s+la\s+primera|sé\s+el\s+primero|se\s+el\s+primero|llev[aá]telo\s+antes|llev[aá]tela\s+antes)[\s\S]*?[.!,]?$/gi,
    // Edition/exclusive phrases at the end
    /\s*[¡!,]?\s*es\s+una?\s+edici[oó]n[\s\S]*?$/gi,
  ];

  let result = text;
  for (const pattern of ctaPatterns) {
    result = result.replace(pattern, '');
  }

  // Additional cleanup: Remove any sentence at the end that contains CTA keywords
  // This catches combinations and variations we might have missed
  const ctaKeywords = [
    'no te quedes', 'no te quedes sin', 'quédate', 'quedate',
    'asegurate', 'asegúrate', 'stock', 'agote', 'agot', 'última', 'ultima',
    'compralo', 'cómpralo', 'comprala', 'cómprala', 'llevalo', 'llévalo',
    'hacelo tuyo', 'hacela tuya', 'no te lo pierdas', 'no te la pierdas',
    'aprovechá', 'aprovecha', 'tu colección', 'tu coleccion', 'hoy mismo',
    'ahora mismo', 'ya disponible', 'disponible ya', 'consiguelo', 'consíguelo',
    'consiguela', 'consíguela', 'obtenelo', 'obtenela', 'únicas', 'unicas',
    'exclusivo', 'exclusiva', 'limitad', 'es una edición', 'es un edición',
    'edición limitada', 'edicion limitada', 'edición exclusiva', 'edicion exclusiva',
    'reservá', 'reserva', 'reservalo', 'reservala'
  ];

  // Split into sentences and check the last one for CTA keywords
  const sentences = result.split(/(?<=[.!?])\s+/);
  if (sentences.length > 1) {
    const lastSentence = sentences[sentences.length - 1].toLowerCase();
    const isCTA = ctaKeywords.some(keyword => lastSentence.includes(keyword));
    if (isCTA) {
      sentences.pop();
      result = sentences.join(' ');
    }
  }

  // Clean up any trailing punctuation or whitespace issues
  result = result.replace(/\s+[.,;:]+$/, '').replace(/\s+$/, '');

  return result.trim();
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
