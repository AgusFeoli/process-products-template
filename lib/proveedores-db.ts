import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

const PROVEEDORES_TABLE = "proveedores";

export interface Proveedor {
  id?: number;
  codigo: number;
  nombre: string;
  tipo: string;
}

// Ensure proveedores table exists
export async function ensureProveedoresTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS proveedores (
      id SERIAL PRIMARY KEY,
      codigo INTEGER NOT NULL UNIQUE,
      nombre VARCHAR(255) NOT NULL,
      tipo VARCHAR(100) DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

// Get all proveedores
export async function getProveedores(): Promise<Proveedor[]> {
  await ensureProveedoresTable();
  const result = await sql`
    SELECT id, codigo, nombre, tipo FROM proveedores ORDER BY codigo ASC
  `;
  return result as Proveedor[];
}

// Insert a single proveedor
export async function insertProveedor(
  proveedor: Omit<Proveedor, "id">
): Promise<Proveedor> {
  await ensureProveedoresTable();
  const result = await sql`
    INSERT INTO proveedores (codigo, nombre, tipo)
    VALUES (${proveedor.codigo}, ${proveedor.nombre}, ${proveedor.tipo || ''})
    ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, tipo = EXCLUDED.tipo, updated_at = NOW()
    RETURNING id, codigo, nombre, tipo
  `;
  return result[0] as Proveedor;
}

// Insert multiple proveedores (bulk)
export async function insertProveedoresBulk(
  proveedores: Omit<Proveedor, "id">[]
): Promise<{ inserted: number; errors: string[] }> {
  await ensureProveedoresTable();
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
  const values: (string | number)[] = [];
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

  if (updates.length === 0) return;

  updates.push(`updated_at = NOW()`);
  values.push(id);

  const query = `UPDATE ${PROVEEDORES_TABLE} SET ${updates.join(", ")} WHERE id = $${paramIndex}`;
  await sql(query, values);
}

// Delete a proveedor
export async function deleteProveedor(id: number): Promise<void> {
  await sql`DELETE FROM proveedores WHERE id = ${id}`;
}

// Delete all proveedores
export async function deleteAllProveedores(): Promise<{ deletedCount: number }> {
  const countResult = await sql`SELECT COUNT(*) as count FROM proveedores`;
  const count = Number(countResult[0]?.count || 0);
  await sql`DELETE FROM proveedores`;
  return { deletedCount: count };
}
