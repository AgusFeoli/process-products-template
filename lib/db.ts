import { neon } from "@neondatabase/serverless";

// Neon serverless SQL client
const sql = neon(process.env.DATABASE_URL!);

// Table configuration - set this to your existing table name
const TARGET_TABLE = process.env.TARGET_TABLE || "products";

export interface TableColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimary: boolean;
}

export interface TableRow {
  [key: string]: string | number | boolean | null;
}

export interface TableData {
  tableName: string;
  columns: TableColumn[];
  rows: TableRow[];
  primaryKey: string | null;
}

// Get table schema
export async function getTableSchema(tableName: string): Promise<TableColumn[]> {
  const result = await sql`
    SELECT
      c.column_name as name,
      c.data_type as "dataType",
      c.is_nullable = 'YES' as "isNullable",
      COALESCE(pk.is_primary, false) as "isPrimary"
    FROM information_schema.columns c
    LEFT JOIN (
      SELECT kcu.column_name, true as is_primary
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_name = ${tableName}
    ) pk ON c.column_name = pk.column_name
    WHERE c.table_name = ${tableName}
    ORDER BY c.ordinal_position
  `;
  return result as TableColumn[];
}

// Get all data from the target table
export async function getTableData(): Promise<TableData> {
  const columns = await getTableSchema(TARGET_TABLE);
  const primaryKey = columns.find((c) => c.isPrimary)?.name || null;

  // Use raw SQL for dynamic table/column names
  const query = `SELECT * FROM "${TARGET_TABLE}" ORDER BY ${primaryKey ? `"${primaryKey}"` : "1"}`;
  const result = await sql(query);

  return {
    tableName: TARGET_TABLE,
    columns,
    rows: result as TableRow[],
    primaryKey,
  };
}

// Insert rows into the table (append mode)
export async function insertRows(
  rows: Record<string, string>[]
): Promise<{ inserted: number; errors: string[] }> {
  if (rows.length === 0) {
    return { inserted: 0, errors: [] };
  }

  const columns = await getTableSchema(TARGET_TABLE);
  const columnNames = columns.map((c) => c.name);

  // Check if table has timestamp columns
  const hasCreatedAt = columnNames.includes("created_at");
  const hasUpdatedAt = columnNames.includes("updated_at");

  // Filter out primary key if it's auto-generated (serial/identity)
  const primaryKey = columns.find((c) => c.isPrimary)?.name;
  const insertColumns = columnNames.filter((col) => {
    // Skip id/primary key columns that are likely auto-generated
    if (col === primaryKey && (col === "id" || col.endsWith("_id"))) {
      return false;
    }
    return true;
  });

  let inserted = 0;
  const errors: string[] = [];
  const now = new Date().toISOString();

  for (const row of rows) {
    try {
      const values = insertColumns.map((col) => {
        // Set created_at and updated_at to current timestamp on insert
        if (col === "created_at" && hasCreatedAt) {
          return now;
        }
        if (col === "updated_at" && hasUpdatedAt) {
          return now;
        }
        return row[col] ?? null;
      });
      const placeholders = insertColumns.map((_, i) => `$${i + 1}`).join(", ");
      const quotedColumns = insertColumns.map((c) => `"${c}"`).join(", ");

      const query = `INSERT INTO "${TARGET_TABLE}" (${quotedColumns}) VALUES (${placeholders})`;
      await sql(query, values);
      inserted++;
    } catch (error) {
      errors.push(
        `Row error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return { inserted, errors };
}

// Update a single cell
export async function updateCell(
  primaryKeyValue: string | number,
  columnName: string,
  value: string | null
): Promise<void> {
  const columns = await getTableSchema(TARGET_TABLE);
  const columnNames = columns.map((c) => c.name);
  const primaryKey = columns.find((c) => c.isPrimary)?.name;

  if (!primaryKey) {
    throw new Error("Table has no primary key, cannot update");
  }

  // Check if table has updated_at column and we're not already updating it
  const hasUpdatedAt = columnNames.includes("updated_at");
  const now = new Date().toISOString();

  if (hasUpdatedAt && columnName !== "updated_at") {
    // Update both the target column and updated_at
    const query = `UPDATE "${TARGET_TABLE}" SET "${columnName}" = $1, "updated_at" = $2 WHERE "${primaryKey}" = $3`;
    await sql(query, [value, now, primaryKeyValue]);
  } else {
    // Just update the target column
    const query = `UPDATE "${TARGET_TABLE}" SET "${columnName}" = $1 WHERE "${primaryKey}" = $2`;
    await sql(query, [value, primaryKeyValue]);
  }
}

// Delete a row
export async function deleteRow(primaryKeyValue: string | number): Promise<void> {
  const columns = await getTableSchema(TARGET_TABLE);
  const primaryKey = columns.find((c) => c.isPrimary)?.name;

  if (!primaryKey) {
    throw new Error("Table has no primary key, cannot delete");
  }

  const query = `DELETE FROM "${TARGET_TABLE}" WHERE "${primaryKey}" = $1`;
  await sql(query, [primaryKeyValue]);
}

// Delete all rows
export async function deleteAllRows(): Promise<{ deletedCount: number }> {
  // First get the count
  const countResult = await sql(`SELECT COUNT(*) as count FROM "${TARGET_TABLE}"`);
  const count = Number(countResult[0]?.count || 0);

  // Delete all rows
  await sql(`DELETE FROM "${TARGET_TABLE}"`);

  return { deletedCount: count };
}

// Add a new empty row
export async function addRow(): Promise<TableRow> {
  // Insert with default values and return the new row
  const query = `INSERT INTO "${TARGET_TABLE}" DEFAULT VALUES RETURNING *`;
  const result = await sql(query);

  return result[0] as TableRow;
}

// List all tables in the database
export async function listTables(): Promise<string[]> {
  const result = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;
  return result.map((r: { table_name: string }) => r.table_name);
}

// Test database connection
export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

// Initialize (verify connection and table exists)
export async function initializeDatabase(): Promise<{
  connected: boolean;
  tableExists: boolean;
  tableName: string;
}> {
  try {
    const connected = await testConnection();
    if (!connected) {
      return { connected: false, tableExists: false, tableName: TARGET_TABLE };
    }

    const tables = await listTables();
    const tableExists = tables.includes(TARGET_TABLE);

    return { connected, tableExists, tableName: TARGET_TABLE };
  } catch {
    return { connected: false, tableExists: false, tableName: TARGET_TABLE };
  }
}
