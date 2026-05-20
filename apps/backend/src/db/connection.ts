import { Pool } from 'pg'

let pool: Pool | null = null

export function getPool(): Pool {
  if (pool) return pool

  const connectionString =
    process.env.DATABASE_URL || 'postgresql://sardeenz:sardeenz@localhost:5432/sardeenz'

  pool = new Pool({ connectionString, max: 20 })
  return pool
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
  }
}

export function getTestPool(): Pool {
  const connectionString =
    process.env.TEST_DATABASE_URL || 'postgresql://sardeenz:sardeenz@localhost:5432/sardeenz_test'
  return new Pool({ connectionString, max: 5 })
}
