/**
 * Model Configuration Store
 *
 * SQLite persistence layer for saved model configurations.
 */

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { getDb } from '../db/index.js'
import type {
  SavedModelConfiguration,
  ModelConfigurationEntry,
  CreateModelConfigurationInput,
  UpdateModelConfigurationInput,
  ModelInstance,
  ModelSourceType,
} from '@sardeenz/types'
import { peerStore } from './peer-store.js'
import { signRequest } from '../services/cluster-auth.js'
import { config } from '../config.js'

// Row types for SQLite (snake_case)
interface ConfigurationRow {
  id: string
  name: string
  description: string | null
  model_count: number
  placement_strategy: string | null
  min_kv_cache_mb: number | null
  version: number
  created_at: string
  updated_at: string | null
}

interface EntryRow {
  id: string
  config_id: string
  model_path: string
  served_model_name: string | null
  max_tokens: number
  source_type: string
  extra_args: string | null // JSON
  gpu_ids: string | null // JSON
  tensor_parallel_size: number
  load_order: number
  sleep_mode_enabled: number // SQLite stores booleans as 0/1
  gpu_type_constraint: string | null
  min_vram_mb: number | null
}

// Convert row to domain object
function rowToConfiguration(row: ConfigurationRow): SavedModelConfiguration {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    modelCount: row.model_count,
    placementStrategy: row.placement_strategy as SavedModelConfiguration['placementStrategy'],
    minKvCacheMb: row.min_kv_cache_mb,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  }
}

function rowToEntry(row: EntryRow): ModelConfigurationEntry {
  return {
    id: row.id,
    configId: row.config_id,
    modelPath: row.model_path,
    servedModelName: row.served_model_name ?? undefined,
    maxTokens: row.max_tokens,
    sourceType: row.source_type as ModelSourceType,
    extraArgs: row.extra_args ? JSON.parse(row.extra_args) : undefined,
    gpuIds: row.gpu_ids ? JSON.parse(row.gpu_ids) : undefined,
    tensorParallelSize: row.tensor_parallel_size,
    loadOrder: row.load_order,
    sleepModeEnabled: row.sleep_mode_enabled === 1,
    gpuTypeConstraint: row.gpu_type_constraint ?? undefined,
    minVramMb: row.min_vram_mb ?? undefined,
  }
}

class ModelConfigurationStore {
  private db: Database.Database

  constructor(database?: Database.Database) {
    this.db = database || getDb()
  }

  /**
   * Create a new configuration by capturing current running models
   */
  createFromRunningModels(
    input: CreateModelConfigurationInput,
    instances: ModelInstance[]
  ): SavedModelConfiguration {
    const id = randomUUID()
    const now = new Date().toISOString()

    // Filter to running and sleeping models (both are valid active configurations)
    const activeInstances = instances.filter(
      (i) => i.status === 'running' || i.status === 'sleeping'
    )

    const insertConfig = this.db.prepare(`
      INSERT INTO model_configurations (id, name, description, model_count, created_at)
      VALUES (?, ?, ?, ?, ?)
    `)

    const insertEntry = this.db.prepare(`
      INSERT INTO model_configuration_entries
      (id, config_id, model_path, served_model_name, max_tokens, source_type, extra_args, gpu_ids, tensor_parallel_size, load_order, sleep_mode_enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      insertConfig.run(id, input.name, input.description ?? null, activeInstances.length, now)

      activeInstances.forEach((instance, index) => {
        // Determine if served_model_name differs from model path
        const servedModelName =
          instance.modelName !== instance.modelPath ? instance.modelName : null

        insertEntry.run(
          randomUUID(),
          id,
          instance.modelPath,
          servedModelName,
          instance.maxTokens,
          'huggingface', // Default source type
          null, // Extra args not captured from running instance
          instance.gpuIds.length > 0 ? JSON.stringify(instance.gpuIds) : null,
          instance.tensorParallelSize,
          index,
          instance.sleepModeEnabled ? 1 : 0
        )
      })
    })

    transaction()

    return {
      id,
      name: input.name,
      description: input.description,
      modelCount: activeInstances.length,
      createdAt: now,
    }
  }

  /**
   * Get a configuration by ID (with entries)
   */
  getConfiguration(id: string): SavedModelConfiguration | null {
    const configStmt = this.db.prepare('SELECT * FROM model_configurations WHERE id = ?')
    const configRow = configStmt.get(id) as ConfigurationRow | undefined

    if (!configRow) return null

    const entriesStmt = this.db.prepare(
      'SELECT * FROM model_configuration_entries WHERE config_id = ? ORDER BY load_order'
    )
    const entryRows = entriesStmt.all(id) as EntryRow[]

    return {
      ...rowToConfiguration(configRow),
      entries: entryRows.map(rowToEntry),
    }
  }

  /**
   * List all configurations (without entries)
   */
  listConfigurations(): { configurations: SavedModelConfiguration[]; total: number } {
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM model_configurations')
    const countResult = countStmt.get() as { count: number }

    const selectStmt = this.db.prepare(
      'SELECT * FROM model_configurations ORDER BY created_at DESC'
    )
    const rows = selectStmt.all() as ConfigurationRow[]

    return {
      configurations: rows.map(rowToConfiguration),
      total: countResult.count,
    }
  }

  /**
   * Update configuration name/description
   */
  updateConfiguration(
    id: string,
    input: UpdateModelConfigurationInput
  ): SavedModelConfiguration | null {
    const existing = this.getConfiguration(id)
    if (!existing) return null

    const now = new Date().toISOString()
    const fields = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (input.name !== undefined) {
      fields.push('name = ?')
      values.push(input.name)
    }
    if (input.description !== undefined) {
      fields.push('description = ?')
      values.push(input.description)
    }

    const stmt = this.db.prepare(
      `UPDATE model_configurations SET ${fields.join(', ')} WHERE id = ?`
    )
    stmt.run(...values, id)

    return this.getConfiguration(id)
  }

  /**
   * Delete a configuration (entries cascade)
   */
  deleteConfiguration(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM model_configurations WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * Check if a configuration name already exists
   */
  nameExists(name: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM model_configurations WHERE name = ?')
    return stmt.get(name) !== undefined
  }

  /**
   * Get configuration by name
   */
  getConfigurationByName(name: string): SavedModelConfiguration | null {
    const stmt = this.db.prepare('SELECT * FROM model_configurations WHERE name = ?')
    const row = stmt.get(name) as ConfigurationRow | undefined
    if (!row) return null

    return this.getConfiguration(row.id)
  }

  /**
   * T066: Sync a preset received from another pod.
   * Uses version numbers for conflict resolution (higher version wins).
   */
  syncPreset(preset: SavedModelConfiguration): boolean {
    const existing = this.getConfiguration(preset.id)

    if (existing) {
      // Conflict resolution: higher version wins
      if ((existing.version ?? 1) >= (preset.version ?? 1)) {
        return false // Local version is same or newer
      }

      // Update existing preset
      const now = new Date().toISOString()
      this.db.prepare(`
        UPDATE model_configurations SET
          name = ?, description = ?, model_count = ?,
          placement_strategy = ?, min_kv_cache_mb = ?, version = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        preset.name,
        preset.description ?? null,
        preset.modelCount,
        preset.placementStrategy ?? null,
        preset.minKvCacheMb ?? null,
        preset.version ?? 1,
        now,
        preset.id
      )

      // Replace entries
      this.db.prepare('DELETE FROM model_configuration_entries WHERE config_id = ?').run(preset.id)
    } else {
      // Insert new preset
      this.db.prepare(`
        INSERT INTO model_configurations (id, name, description, model_count, placement_strategy, min_kv_cache_mb, version, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        preset.id,
        preset.name,
        preset.description ?? null,
        preset.modelCount,
        preset.placementStrategy ?? null,
        preset.minKvCacheMb ?? null,
        preset.version ?? 1,
        preset.createdAt
      )
    }

    // Insert entries
    if (preset.entries) {
      const insertEntry = this.db.prepare(`
        INSERT INTO model_configuration_entries
        (id, config_id, model_path, served_model_name, max_tokens, source_type, extra_args, gpu_ids, tensor_parallel_size, load_order, sleep_mode_enabled, gpu_type_constraint, min_vram_mb)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const entry of preset.entries) {
        insertEntry.run(
          entry.id || randomUUID(),
          preset.id,
          entry.modelPath,
          entry.servedModelName ?? null,
          entry.maxTokens,
          entry.sourceType,
          entry.extraArgs ? JSON.stringify(entry.extraArgs) : null,
          entry.gpuIds ? JSON.stringify(entry.gpuIds) : null,
          entry.tensorParallelSize,
          entry.loadOrder,
          entry.sleepModeEnabled ? 1 : 0,
          entry.gpuTypeConstraint ?? null,
          entry.minVramMb ?? null
        )
      }
    }

    return true
  }

  /**
   * T066: Replicate a preset to all healthy peers via POST /internal/presets/sync.
   * Fire-and-forget to avoid blocking on unreachable peers.
   */
  replicateToAllPeers(presetId: string): void {
    const preset = this.getConfiguration(presetId)
    if (!preset) return

    const peers = peerStore.getHealthyPeers()
    const localPodId = hostname()

    for (const peer of peers) {
      if (peer.podId === localPodId) continue

      const internalPath = '/internal/presets/sync'
      const body = JSON.stringify(preset)
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (config.clusterSecret) {
        const { signature, timestamp } = signRequest('POST', internalPath, body, config.clusterSecret)
        headers['x-cluster-signature'] = signature
        headers['x-cluster-timestamp'] = String(timestamp)
      }

      // Fire-and-forget
      fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {
        // Ignore replication failures — peers will sync on next heartbeat cycle
      })
    }
  }
}

// Singleton instance
let modelConfigurationStore: ModelConfigurationStore | null = null

export function getModelConfigurationStore(): ModelConfigurationStore {
  if (!modelConfigurationStore) {
    modelConfigurationStore = new ModelConfigurationStore()
  }
  return modelConfigurationStore
}

// For testing with custom database
export function createModelConfigurationStore(
  database: Database.Database
): ModelConfigurationStore {
  return new ModelConfigurationStore(database)
}
