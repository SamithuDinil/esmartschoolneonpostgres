import { Pool } from "pg";

const globalForPg = globalThis as typeof globalThis & { eduspherePgPool?: Pool };

export function getPostgresPool() {
  if (globalForPg.eduspherePgPool) return globalForPg.eduspherePgPool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to connect to Neon PostgreSQL.");
  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  globalForPg.eduspherePgPool = pool;
  return pool;
}
