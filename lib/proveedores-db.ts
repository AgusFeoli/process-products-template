import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
function getSql() {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

const PROVEEDORES_TABLE = "proveedores";

export interface Proveedor {
  id?: number;
  codigo: number;
  nombre: string;
  tipo: string;
  skip_ai?: boolean;
}

// Ensure proveedores table exists
export async function ensureProveedoresTable(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS proveedores (
      id SERIAL PRIMARY KEY,
      codigo INTEGER NOT NULL UNIQUE,
      nombre VARCHAR(255) NOT NULL,
      tipo VARCHAR(100) DEFAULT '',
      skip_ai BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  // Add skip_ai column if it doesn't exist (for existing tables)
  await sql`
    ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS skip_ai BOOLEAN DEFAULT false
  `.catch(() => {});
}

// Get all proveedores
export async function getProveedores(): Promise<Proveedor[]> {
  await ensureProveedoresTable();
  const sql = getSql();
  const result = await sql`
    SELECT id, codigo, nombre, tipo, COALESCE(skip_ai, false) as skip_ai FROM proveedores ORDER BY codigo ASC
  `;
  return result as Proveedor[];
}

// Get proveedores with skip_ai = true (names list for AI processing)
export async function getSkipAiProveedorNames(): Promise<string[]> {
  await ensureProveedoresTable();
  const sql = getSql();
  const result = await sql`
    SELECT nombre FROM proveedores WHERE skip_ai = true
  `;
  return result.map((r) => r.nombre as string);
}

// Insert a single proveedor
export async function insertProveedor(
  proveedor: Omit<Proveedor, "id">
): Promise<Proveedor> {
  await ensureProveedoresTable();
  const sql = getSql();
  const result = await sql`
    INSERT INTO proveedores (codigo, nombre, tipo, skip_ai)
    VALUES (${proveedor.codigo}, ${proveedor.nombre}, ${proveedor.tipo || ''}, ${proveedor.skip_ai || false})
    ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, skip_ai = EXCLUDED.skip_ai, updated_at = NOW()
    RETURNING id, codigo, nombre, tipo, skip_ai
  `;
  return result[0] as Proveedor;
}

// Insert multiple proveedores (bulk)
export async function insertProveedoresBulk(
  proveedores: Omit<Proveedor, "id">[]
): Promise<{ inserted: number; errors: string[] }> {
  await ensureProveedoresTable();
  const sql = getSql();
  let inserted = 0;
  const errors: string[] = [];

  for (let i = 0; i < proveedores.length; i++) {
    const p = proveedores[i];
    try {
      await sql`
        INSERT INTO proveedores (codigo, nombre, tipo)
        VALUES (${p.codigo}, ${p.nombre}, ${p.tipo || ''})
        ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, updated_at = NOW()
      `;
      inserted++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      errors.push(`Fila ${i + 1}: ${msg}`);
    }
  }

  return { inserted, errors };
}

// Update a proveedor
export async function updateProveedor(
  id: number,
  data: Partial<Omit<Proveedor, "id">>
): Promise<void> {
  const updates: string[] = [];
  const values: (string | number | boolean)[] = [];
  let paramIndex = 1;

  if (data.codigo !== undefined) {
    updates.push(`codigo = $${paramIndex++}`);
    values.push(data.codigo);
  }
  if (data.nombre !== undefined) {
    updates.push(`nombre = $${paramIndex++}`);
    values.push(data.nombre);
  }
  if (data.tipo !== undefined) {
    updates.push(`tipo = $${paramIndex++}`);
    values.push(data.tipo);
  }
  if (data.skip_ai !== undefined) {
    updates.push(`skip_ai = $${paramIndex++}`);
    values.push(data.skip_ai);
  }

  if (updates.length === 0) return;

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const sql = getSql();
  const query = `UPDATE ${PROVEEDORES_TABLE} SET ${updates.join(", ")} WHERE id = $${paramIndex}`;
  await sql(query, values);
}

// Delete a proveedor
export async function deleteProveedor(id: number): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM proveedores WHERE id = ${id}`;
}

// Delete all proveedores
export async function deleteAllProveedores(): Promise<{ deletedCount: number }> {
  const sql = getSql();
  const countResult = await sql`SELECT COUNT(*) as count FROM proveedores`;
  const count = Number(countResult[0]?.count || 0);
  await sql`DELETE FROM proveedores`;
  return { deletedCount: count };
}
