import { Pool, type PoolClient } from "pg";

// Singleton pool instance
let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL environment variable is not set");
    }
    _pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: connectionString.includes("sslmode=")
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return _pool;
}

/**
 * A neon-compatible SQL function that can be used as:
 * - Tagged template literal: sql`SELECT * FROM users WHERE id = ${id}`
 * - Function call with query string: sql("SELECT * FROM users WHERE id = $1", [id])
 *
 * Returns an array of row objects, matching the neon driver API.
 */
type SqlFunction = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  (query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};

function createSqlFunction(): SqlFunction {
  const fn = async (...args: unknown[]): Promise<Record<string, unknown>[]> => {
    const pool = getPool();

    // Check if called as tagged template literal
    if (Array.isArray(args[0]) && "raw" in (args[0] as object)) {
      const strings = args[0] as unknown as TemplateStringsArray;
      const values = args.slice(1);

      // Build parameterized query from template literal
      let query = strings[0];
      for (let i = 0; i < values.length; i++) {
        query += `$${i + 1}` + strings[i + 1];
      }

      const result = await pool.query(query, values as unknown[]);
      return result.rows;
    }

    // Called as regular function: sql("SELECT ...", [params])
    const query = args[0] as string;
    const params = (args[1] as unknown[]) || [];
    const result = await pool.query(query, params);
    return result.rows;
  };

  return fn as SqlFunction;
}

// Export a singleton sql function
let _sql: SqlFunction | null = null;

export function getSql(): SqlFunction {
  if (!_sql) {
    _sql = createSqlFunction();
  }
  return _sql;
}

/**
 * Test the database connection.
 */
export async function testDatabaseConnection(): Promise<boolean> {
  try {
    const pool = getPool();
    const client: PoolClient = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully close the pool (for cleanup).
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _sql = null;
  }
}
