/**
 * SQLite Database Connection Singleton
 *
 * Provides a single shared connection to the SQLite database for all stores.
 * The database file is created in the `data/` directory by default.
 */

import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

// Database file location (configurable via env)
const DEFAULT_DB_PATH = 'data/sardeenz.db'

let db: Database.Database | null = null

/**
 * Get the database file path from environment or use default
 */
function getDbPath(): string {
  const dbPath = process.env.SARDEENZ_DB_PATH || DEFAULT_DB_PATH

  // If relative path, resolve from project root
  if (!path.isAbsolute(dbPath)) {
    // Go up from src/db to project root
    return path.resolve(process.cwd(), dbPath)
  }

  return dbPath
}

/**
 * Ensure the data directory exists
 */
function ensureDataDir(dbPath: string): void {
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Get or create the singleton database connection
 */
export function getDb(): Database.Database {
  if (db) {
    return db
  }

  const dbPath = getDbPath()
  ensureDataDir(dbPath)

  db = new Database(dbPath)

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL')

  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  return db
}

/**
 * Close the database connection
 * Should be called during graceful shutdown
 */
export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

/**
 * Get an in-memory database for testing
 */
export function getTestDb(): Database.Database {
  const testDb = new Database(':memory:')
  testDb.pragma('foreign_keys = ON')
  return testDb
}
