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

// Generate e-commerce product description using AI
export async function generateProductDescription(
  product: ProductData,
  imageUrl?: string
): Promise<string> {
  const client = getAIClient();
  const model = client.chat(getModelName());

  // Build product context
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

  const productContext = productInfo.join("\n");

  // Build the prompt
  const prompt = `Eres un experto copywriter para e-commerce de moda y productos de lujo. Genera una descripcion de producto atractiva y profesional para una tienda online.

INFORMACION DEL PRODUCTO:
${productContext}

INSTRUCCIONES:
1. Escribe una descripcion de 2-3 parrafos cortos (maximo 150 palabras total)
2. Usa un tono elegante y aspiracional
3. Destaca los beneficios y caracteristicas principales
4. Si hay informacion de materiales/composicion, mencionala de forma atractiva
5. Si el producto esta en oferta u outlet, no lo menciones en la descripcion (eso se muestra aparte)
6. Si es producto nuevo o preventa, puedes mencionarlo sutilmente
7. NO uses emojis
8. NO incluyas precios
9. Escribe SOLO la descripcion, sin encabezados ni etiquetas

DESCRIPCION:`;

  try {
    const result = await generateText({
      model,
      prompt,
      maxTokens: 300,
      temperature: 0.7,
    });

    return result.text.trim();
  } catch (error) {
    console.error("AI generation error:", error);
    throw new Error(
      `Failed to generate description: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
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
