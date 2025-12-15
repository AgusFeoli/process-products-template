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
  return createOpenAI({
    apiKey: process.env.API_KEY || "not-required",
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
    productInfo.push(`Marca/Proveedor: ${product.proveedor}`);
  }
  if (product.modelo) {
    productInfo.push(`Modelo/SKU: ${product.modelo}`);
  }
  if (product.descripcion) {
    productInfo.push(`Descripcion original: ${product.descripcion}`);
  }
  if (product.composicion) {
    productInfo.push(`Composicion/Materiales: ${product.composicion}`);
  }

  // Status flags
  const flags: string[] = [];
  if (isTrue(product.nuevo)) flags.push("Producto Nuevo");
  if (isTrue(product.preventa)) flags.push("Disponible en Preventa");
  if (isTrue(product.sale)) flags.push("En Oferta/Sale");
  if (isTrue(product.outlet)) flags.push("Producto Outlet");

  if (flags.length > 0) {
    productInfo.push(`Estado: ${flags.join(", ")}`);
  }

  if (product.repite_color) {
    productInfo.push(`Color: ${product.repite_color}`);
  }

  return productInfo.join("\n");
}

// Build the base prompt
function buildPrompt(productContext: string, hasImage: boolean): string {
  const imageInstruction = hasImage
    ? `
IMPORTANTE - ANÁLISIS DE IMAGEN:
- Analizá la imagen del producto para extraer detalles visuales
- Describí el estilo, color, textura, y características visibles
- Usá la imagen para enriquecer la descripción con detalles que solo se ven en la foto
`
    : "";

  return `Eres un especialista experto en redacción de productos para e-commerce. Generá una descripción de producto convincente y atractiva.

IMPORTANTE - IDIOMA Y ESTILO:
- Todo el contenido debe estar en ESPAÑOL LATINO RIOPLATENSE (estilo Argentina/Uruguay - Cono Sur)
- Usá el voseo: "vos" en lugar de "tú" (ej: "llevate", "descubrí", "sumá", "elegí", "no te pierdas")
- Usá expresiones naturales del Río de la Plata
- Esta es una marca uruguaya que busca atraer clientas con productos EXCLUSIVOS y ORIGINALES
- Los CTAs deben transmitir urgencia y exclusividad
${imageInstruction}
DATOS DEL PRODUCTO:
${productContext}

INSTRUCCIONES:
1. Escribí una descripción de 2-3 párrafos cortos (máximo 150 palabras total)
2. Usá un tono elegante, aspiracional y que destaque la EXCLUSIVIDAD y ORIGINALIDAD del producto
3. Destacá los beneficios y características principales, no solo las especificaciones técnicas
4. Si hay información de materiales/composición, mencionala de forma atractiva
5. Si el producto está en oferta u outlet, NO lo menciones en la descripción (eso se muestra aparte)
6. Si es producto nuevo o preventa, podés mencionarlo sutilmente
7. NO uses emojis
8. NO incluyas precios
9. IMPORTANTE: La descripción DEBE terminar con un call-to-action (CTA) atractivo en español rioplatense que enfatice la EXCLUSIVIDAD y ORIGINALIDAD del producto. Ejemplos de CTAs efectivos: "¡Llevate el tuyo antes de que se agote!", "Descubrí esta pieza única y exclusiva", "No te lo pierdas, es edición limitada", "Sumalo a tu colección ahora", "Hacelo tuyo, quedan pocas unidades"
10. Escribí SOLO la descripción con el CTA al final, sin encabezados ni etiquetas adicionales

DESCRIPCIÓN:`;
}

// Generate e-commerce product description using AI (text only)
export async function generateProductDescription(
  product: ProductData,
  imageBuffer?: Buffer | null
): Promise<string> {
  const client = getAIClient();
  const productContext = buildProductContext(product);
  
  // If we have an image, use multimodal generation
  if (imageBuffer && imageBuffer.length > 0) {
    return generateMultimodalDescription(client, productContext, imageBuffer);
  }

  // Text-only generation
  const model = client.chat(getModelName());
  const prompt = buildPrompt(productContext, false);

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

// Generate description with image (multimodal)
async function generateMultimodalDescription(
  client: ReturnType<typeof createOpenAI>,
  productContext: string,
  imageBuffer: Buffer
): Promise<string> {
  const model = client.chat(getVisionModelName());
  const prompt = buildPrompt(productContext, true);

  // Convert buffer to base64 data URL
  const base64Image = imageBuffer.toString("base64");
  
  // Detect image type from magic bytes
  const mimeType = detectImageMimeType(imageBuffer);

  try {
    const result = await generateText({
      model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              image: `data:${mimeType};base64,${base64Image}`,
            },
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
    const textPrompt = buildPrompt(productContext, false);
    
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
