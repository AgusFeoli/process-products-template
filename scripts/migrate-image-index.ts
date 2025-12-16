import { neon } from "@neondatabase/serverless";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function runMigration() {
  console.log("=".repeat(50));
  console.log("🗄️  MIGRACIÓN: Tablas de indexado de imágenes");
  console.log("=".repeat(50));

  try {
    // Step 1: Enable pg_trgm extension for fast ILIKE searches
    console.log("\n1️⃣  Habilitando extensión pg_trgm...");
    await sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`;
    console.log("   ✅ pg_trgm habilitado");

    // Step 2: Create sftp_images table
    console.log("\n2️⃣  Creando tabla sftp_images...");
    await sql`
      CREATE TABLE IF NOT EXISTS sftp_images (
        id SERIAL PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_lower TEXT NOT NULL,
        size BIGINT DEFAULT 0,
        modify_time TIMESTAMPTZ,
        seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("   ✅ Tabla sftp_images creada");

    // Step 3: Create trigram index for fast ILIKE searches
    console.log("\n3️⃣  Creando índice trigram en name_lower...");
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sftp_images_name_lower_trgm 
      ON sftp_images USING gin (name_lower gin_trgm_ops)
    `;
    console.log("   ✅ Índice trigram creado");

    // Step 4: Create regular index on path for lookups
    console.log("\n4️⃣  Creando índice en path...");
    await sql`
      CREATE INDEX IF NOT EXISTS idx_sftp_images_path 
      ON sftp_images (path)
    `;
    console.log("   ✅ Índice en path creado");

    // Step 5: Create product_images table for caching matches
    console.log("\n5️⃣  Creando tabla product_images...");
    await sql`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL,
        image_path TEXT NOT NULL,
        match_score REAL DEFAULT 0,
        matched_by TEXT DEFAULT 'modelo_contains',
        matched_at TIMESTAMPTZ DEFAULT NOW(),
        image_modify_time TIMESTAMPTZ,
        is_primary BOOLEAN DEFAULT TRUE,
        UNIQUE(product_id, image_path)
      )
    `;
    console.log("   ✅ Tabla product_images creada");

    // Step 6: Create indexes on product_images
    console.log("\n6️⃣  Creando índices en product_images...");
    await sql`
      CREATE INDEX IF NOT EXISTS idx_product_images_product_id 
      ON product_images (product_id)
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_product_images_primary 
      ON product_images (product_id, is_primary) WHERE is_primary = TRUE
    `;
    console.log("   ✅ Índices en product_images creados");

    // Step 7: Create product_ai table for versioning/cache
    console.log("\n7️⃣  Creando tabla product_ai (cache/versionado)...");
    await sql`
      CREATE TABLE IF NOT EXISTS product_ai (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL UNIQUE,
        ai_version TEXT DEFAULT '1.0',
        ai_generated_at TIMESTAMPTZ,
        product_updated_at TIMESTAMPTZ,
        image_path TEXT,
        image_modify_time TIMESTAMPTZ,
        description_hash TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("   ✅ Tabla product_ai creada");

    // Step 8: Create index on product_ai
    console.log("\n8️⃣  Creando índice en product_ai...");
    await sql`
      CREATE INDEX IF NOT EXISTS idx_product_ai_product_id 
      ON product_ai (product_id)
    `;
    console.log("   ✅ Índice en product_ai creado");

    // Step 9: Create ai_prompt_config table for storing AI prompt templates
    console.log("\n9️⃣  Creando tabla ai_prompt_config...");
    await sql`
      CREATE TABLE IF NOT EXISTS ai_prompt_config (
        id SERIAL PRIMARY KEY,
        prompt_template TEXT NOT NULL,
        version TEXT DEFAULT '1.0',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(version)
      )
    `;
    console.log("   ✅ Tabla ai_prompt_config creada");

    // Insert default prompt if table is empty
    const existingPrompt = await sql`
      SELECT id FROM ai_prompt_config LIMIT 1
    `;
    if (existingPrompt.length === 0) {
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
      
      await sql`
        INSERT INTO ai_prompt_config (prompt_template, version)
        VALUES (${defaultPrompt}, '1.0')
      `;
      console.log("   ✅ Prompt por defecto insertado");
    }

    // Verify tables exist
    console.log("\n📊 Verificando tablas creadas...");
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('sftp_images', 'product_images', 'product_ai', 'ai_prompt_config')
      ORDER BY table_name
    `;
    
    console.log(`   Tablas encontradas: ${tables.map((t) => (t as { table_name: string }).table_name).join(", ")}`);

    // Check if pg_trgm is enabled
    const extensions = await sql`
      SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'
    `;
    console.log(`   Extensión pg_trgm: ${extensions.length > 0 ? "✅ activa" : "❌ no encontrada"}`);

    console.log("\n" + "=".repeat(50));
    console.log("✅ MIGRACIÓN COMPLETADA EXITOSAMENTE");
    console.log("=".repeat(50));

  } catch (error) {
    console.error("\n❌ Error en migración:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

runMigration();

