import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

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
function buildProductContext(product: ProductData): string {
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

  if (product.repite_color) {
    productInfo.push(`Color: **${product.repite_color}**`);
  }

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

// Build image instruction text
function buildImageInstruction(imageCount: number): string {
  if (imageCount === 0) return "";
  
  if (imageCount === 1) {
    return `
[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]  
- Analizá la imagen del producto para extraer detalles visuales únicos.  
- Describí el estilo, color, textura y características visibles que hacen al producto especial.  
- Usá la imagen para enriquecer la descripción con detalles que solo se aprecian en la foto (ej: tipo de estampado, forma del cuello, acabados, accesorios incluidos, etc.).
`;
  }
  
  return `
[INSTRUCCIONES DE IMAGEN - solo si hay imágenes]  
- Tenés **${imageCount}** imágenes del producto para analizar.  
- Analizá **todas** las imágenes para extraer un panorama completo de los detalles visuales.  
- Describí el estilo, color, textura, detalles y características visibles desde diferentes ángulos.  
- Mencioná los distintos aspectos que se aprecian en cada imagen (vista frontal, detalles de primer plano, dorso, interior, etc.) para brindar una descripción rica y completa.
`;
}

// Build the final prompt from template
function buildPrompt(
  productContext: string,
  imageCount: number,
  customTemplate?: string
): string {
  const template = customTemplate || DEFAULT_PROMPT_TEMPLATE;
  const imageInstruction = buildImageInstruction(imageCount);
  
  // Replace placeholders
  return template
    .replace(/\{\{IMAGE_INSTRUCTIONS\}\}/g, imageInstruction)
    .replace(/\{\{PRODUCT_CONTEXT\}\}/g, productContext);
}

// Generate e-commerce product description using AI (text only or with images)
export async function generateProductDescription(
  product: ProductData,
  imageBuffers?: Buffer[] | Buffer | null,
  customPromptTemplate?: string
): Promise<string> {
  const client = getAIClient();
  const productContext = buildProductContext(product);
  
  // Normalize to array
  const images = Array.isArray(imageBuffers) 
    ? imageBuffers.filter(img => img && img.length > 0)
    : imageBuffers && imageBuffers.length > 0 
      ? [imageBuffers] 
      : [];
  
  // If we have images, use multimodal generation
  if (images.length > 0) {
    return generateMultimodalDescription(client, productContext, images, customPromptTemplate);
  }

  // Text-only generation
  const model = client.chat(getModelName());
  const prompt = buildPrompt(productContext, 0, customPromptTemplate);

  try {
    const result = await generateText({
      model,
      prompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    return result.text.trim();
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
  customPromptTemplate?: string
): Promise<string> {
  const model = client.chat(getVisionModelName());
  const prompt = buildPrompt(productContext, imageBuffers.length, customPromptTemplate);

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

    return result.text.trim();
  } catch (error) {
    // If multimodal fails, fall back to text-only
    console.warn("Multimodal generation failed, falling back to text-only:", error);
    
    const textModel = client.chat(getModelName());
    const textPrompt = buildPrompt(productContext, 0, customPromptTemplate);
    
    const result = await generateText({
      model: textModel,
      prompt: textPrompt,
      // @ts-expect-error - maxTokens is supported by the AI SDK but types may not reflect it
      maxTokens: 400,
    });

    return result.text.trim();
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

// Helper function to check if a value is truthy
function isTrue(value: string | boolean | null | undefined): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1" || value.toLowerCase() === "si";
  }
  return false;
}

// Test AI connection
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
