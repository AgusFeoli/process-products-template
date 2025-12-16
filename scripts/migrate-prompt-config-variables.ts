#!/usr/bin/env tsx

/**
 * Migration script to add variable configuration columns to ai_prompt_config table
 * 
 * This script adds the following columns:
 * - image_instructions_config (JSONB): Configuration for IMAGE_INSTRUCTIONS variable
 * - product_context_config (TEXT): Template for PRODUCT_CONTEXT variable
 * - cta_instructions_config (JSONB): Configuration for CTA_INSTRUCTIONS variable
 */

import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function runMigration() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    console.log("🔄 Starting migration: Add variable configuration columns to ai_prompt_config...");

    // Check if columns already exist
    const existingColumns = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'ai_prompt_config' 
      AND column_name IN ('image_instructions_config', 'product_context_config', 'cta_instructions_config')
    `;

    const existingColumnNames = existingColumns.map((row: any) => row.column_name);

    // Add image_instructions_config column if it doesn't exist
    if (!existingColumnNames.includes('image_instructions_config')) {
      console.log("   ➕ Adding image_instructions_config column...");
      await sql`
        ALTER TABLE ai_prompt_config
        ADD COLUMN image_instructions_config JSONB
      `;
      console.log("   ✅ Column image_instructions_config added");
    } else {
      console.log("   ⏭️  Column image_instructions_config already exists");
    }

    // Add product_context_config column if it doesn't exist
    if (!existingColumnNames.includes('product_context_config')) {
      console.log("   ➕ Adding product_context_config column...");
      await sql`
        ALTER TABLE ai_prompt_config
        ADD COLUMN product_context_config TEXT
      `;
      console.log("   ✅ Column product_context_config added");
    } else {
      console.log("   ⏭️  Column product_context_config already exists");
    }

    // Add cta_instructions_config column if it doesn't exist
    if (!existingColumnNames.includes('cta_instructions_config')) {
      console.log("   ➕ Adding cta_instructions_config column...");
      await sql`
        ALTER TABLE ai_prompt_config
        ADD COLUMN cta_instructions_config JSONB
      `;
      console.log("   ✅ Column cta_instructions_config added");
    } else {
      console.log("   ⏭️  Column cta_instructions_config already exists");
    }

    // Set default values for existing rows if they don't have values
    const rowsWithoutConfigs = await sql`
      SELECT id FROM ai_prompt_config
      WHERE image_instructions_config IS NULL
         OR product_context_config IS NULL
         OR cta_instructions_config IS NULL
      LIMIT 1
    `;

    if (rowsWithoutConfigs.length > 0) {
      console.log("   🔄 Setting default values for existing rows...");
      
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

      await sql`
        UPDATE ai_prompt_config
        SET 
          image_instructions_config = COALESCE(image_instructions_config, ${JSON.stringify(defaultImageInstructions)}::jsonb),
          product_context_config = COALESCE(product_context_config, ${defaultProductContext}),
          cta_instructions_config = COALESCE(cta_instructions_config, ${JSON.stringify(defaultCtaInstructions)}::jsonb)
        WHERE image_instructions_config IS NULL
           OR product_context_config IS NULL
           OR cta_instructions_config IS NULL
      `;
      
      console.log("   ✅ Default values set for existing rows");
    }

    console.log("✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration if script is executed directly
if (require.main === module) {
  runMigration()
    .then(() => {
      console.log("✨ Done!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Fatal error:", error);
      process.exit(1);
    });
}

export { runMigration };
