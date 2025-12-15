/**
 * Database Migration Runner
 *
 * Runs SQL migrations on startup. Migrations are stored in the `migrations/` directory
 * and are executed in order based on their numeric prefix (001, 002, etc.).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type Database from 'better-sqlite3'
import { getDb } from './connection.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

interface MigrationRecord {
  version: number
  applied_at: string
}

/**
 * Get the list of applied migrations from the database
 */
function getAppliedMigrations(db: Database.Database): number[] {
  // Check if schema_migrations table exists
  const tableExists = db
    .prepare(
      `
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='schema_migrations'
  `
    )
    .get()

  if (!tableExists) {
    return []
  }

  const rows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as MigrationRecord[]

  return rows.map((r) => r.version)
}

/**
 * Get all available migration files, sorted by version
 */
function getMigrationFiles(): { version: number; path: string }[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return []
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)

  return files
    .filter((f) => f.endsWith('.sql'))
    .map((f) => {
      // Extract version number from filename (e.g., "001-benchmarks.sql" -> 1)
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

/**
 * Run all pending migrations
 */
export function runMigrations(db?: Database.Database): void {
  const database = db || getDb()
  const applied = getAppliedMigrations(database)
  const migrations = getMigrationFiles()

  const pending = migrations.filter((m) => !applied.includes(m.version))

  if (pending.length === 0) {
    return
  }

  console.log(`[db] Running ${pending.length} pending migration(s)...`)

  for (const migration of pending) {
    console.log(`[db] Applying migration ${migration.version}...`)

    const sql = fs.readFileSync(migration.path, 'utf-8')

    // Execute the migration in a transaction
    database.exec(sql)

    console.log(`[db] Migration ${migration.version} applied successfully`)
  }

  console.log('[db] All migrations completed')
}

/**
 * Initialize the database (run migrations)
 * Called automatically on server startup
 */
export function initializeDatabase(): void {
  const db = getDb()
  runMigrations(db)
}
