import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pool, PoolClient } from 'pg'
import { getPool } from './connection.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

// Advisory lock ID for migration serialization across pods
const MIGRATION_LOCK_ID = 728349261

async function getAppliedMigrations(client: PoolClient): Promise<number[]> {
  const tableCheck = await client.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_name = 'schema_migrations'
    ) AS exists
  `)

  if (!tableCheck.rows[0].exists) {
    return []
  }

  const result = await client.query('SELECT version FROM schema_migrations ORDER BY version')
  return result.rows.map((r) => r.version)
}

function getMigrationFiles(): { version: number; path: string }[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return []
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)

  return files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      const match = f.match(/^(\d+)-/)
      if (!match) return null
      return {
        version: parseInt(match[1], 10),
        path: path.join(MIGRATIONS_DIR, f),
      }
    })
    .filter((m): m is { version: number; path: string } => m !== null)
    .sort((a, b) => a.version - b.version)
}

async function executeMigrationSql(client: PoolClient, sql: string): Promise<void> {
  const statements = sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  for (const stmt of statements) {
    await client.query(stmt)
  }
}

export async function runMigrations(pool?: Pool): Promise<void> {
  const database = pool || getPool()
  const client = await database.connect()

  try {
    // Acquire advisory lock so only one pod runs migrations at a time
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])

    try {
      const applied = await getAppliedMigrations(client)
      const migrations = getMigrationFiles()
      const pending = migrations.filter((m) => !applied.includes(m.version))

      if (pending.length === 0) {
        return
      }

      console.log(`[db] Running ${pending.length} pending migration(s)...`)

      for (const migration of pending) {
        console.log(`[db] Applying migration ${migration.version}...`)

        const sql = fs.readFileSync(migration.path, 'utf-8')

        await client.query('BEGIN')
        try {
          await executeMigrationSql(client, sql)
          await client.query(
            `INSERT INTO schema_migrations (version, applied_at)
             VALUES ($1, NOW())
             ON CONFLICT DO NOTHING`,
            [migration.version]
          )
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        }

        console.log(`[db] Migration ${migration.version} applied successfully`)
      }

      console.log('[db] All migrations completed')
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
    }
  } finally {
    client.release()
  }
}

export async function initializeDatabase(): Promise<void> {
  const pool = getPool()
  await runMigrations(pool)
}
