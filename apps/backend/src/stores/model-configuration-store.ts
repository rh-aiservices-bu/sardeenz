/**
 * Model Configuration Store
 *
 * PostgreSQL persistence layer for saved model configurations.
 */

import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { getPool } from '../db/index.js'
import type {
  SavedModelConfiguration,
  ModelConfigurationEntry,
  CreateModelConfigurationInput,
  UpdateModelConfigurationInput,
  ModelInstance,
  ModelInstanceDTO,
  ModelSourceType,
} from '@sardeenz/types'
import { peerStore } from './peer-store.js'
import { signRequest } from '../services/cluster-auth.js'
import { config } from '../config.js'

// Row types for PostgreSQL (snake_case)
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
  sleep_mode_enabled: number // stored as 0/1
  gpu_type_constraint: string | null
  min_vram_mb: number | null
  pod_id: string | null
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
    podId: row.pod_id ?? undefined,
  }
}

class ModelConfigurationStore {
  private pool: Pool

  constructor(pool?: Pool) {
    this.pool = pool || getPool()
  }

  /**
   * Create a new configuration by capturing current running models
   */
  async createFromRunningModels(
    input: CreateModelConfigurationInput,
    instances: ModelInstance[],
    localPodId?: string,
    remoteModels?: Array<{ dto: ModelInstanceDTO; podId: string }>
  ): Promise<SavedModelConfiguration> {
    const id = randomUUID()
    const now = new Date().toISOString()

    // Filter to running and sleeping models (both are valid active configurations)
    const activeInstances = instances.filter(
      (i) => i.status === 'running' || i.status === 'sleeping'
    )
    const activeRemote = (remoteModels ?? []).filter(
      (r) => r.dto.status === 'running' || r.dto.status === 'sleeping'
    )
    const totalCount = activeInstances.length + activeRemote.length

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      await client.query(
        `INSERT INTO model_configurations (id, name, description, model_count, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, input.name, input.description ?? null, totalCount, now]
      )

      let loadOrder = 0

      for (const instance of activeInstances) {
        const servedModelName =
          instance.modelName !== instance.modelPath ? instance.modelName : null

        await client.query(
          `INSERT INTO model_configuration_entries
           (id, config_id, model_path, served_model_name, max_tokens, source_type, extra_args, gpu_ids, tensor_parallel_size, load_order, sleep_mode_enabled, pod_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            randomUUID(), id,
            instance.modelPath, servedModelName,
            instance.maxTokens, 'huggingface', null,
            instance.gpuIds.length > 0 ? JSON.stringify(instance.gpuIds) : null,
            instance.tensorParallelSize, loadOrder++,
            instance.sleepModeEnabled ? 1 : 0,
            localPodId ?? null,
          ]
        )
      }

      for (const { dto, podId } of activeRemote) {
        const servedModelName =
          dto.model_name !== dto.model_path ? dto.model_name : null

        await client.query(
          `INSERT INTO model_configuration_entries
           (id, config_id, model_path, served_model_name, max_tokens, source_type, extra_args, gpu_ids, tensor_parallel_size, load_order, sleep_mode_enabled, pod_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            randomUUID(), id,
            dto.model_path, servedModelName,
            dto.max_tokens, 'huggingface', null,
            dto.gpu_ids && dto.gpu_ids.length > 0 ? JSON.stringify(dto.gpu_ids) : null,
            dto.tensor_parallel_size, loadOrder++,
            dto.sleep_mode_enabled ? 1 : 0,
            podId,
          ]
        )
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    return {
      id,
      name: input.name,
      description: input.description,
      modelCount: totalCount,
      createdAt: now,
    }
  }

  /**
   * Get a configuration by ID (with entries)
   */
  async getConfiguration(id: string): Promise<SavedModelConfiguration | null> {
    const configResult = await this.pool.query(
      'SELECT * FROM model_configurations WHERE id = $1',
      [id]
    )
    const configRow = configResult.rows[0] as ConfigurationRow | undefined

    if (!configRow) return null

    const entriesResult = await this.pool.query(
      'SELECT * FROM model_configuration_entries WHERE config_id = $1 ORDER BY load_order',
      [id]
    )
    const entryRows = entriesResult.rows as EntryRow[]

    return {
      ...rowToConfiguration(configRow),
      entries: entryRows.map(rowToEntry),
    }
  }

  /**
   * List all configurations (without entries)
   */
  async listConfigurations(): Promise<{ configurations: SavedModelConfiguration[]; total: number }> {
    const countResult = await this.pool.query(
      'SELECT COUNT(*) as count FROM model_configurations'
    )
    const count = parseInt(countResult.rows[0].count, 10)

    const selectResult = await this.pool.query(
      'SELECT * FROM model_configurations ORDER BY created_at DESC'
    )
    const rows = selectResult.rows as ConfigurationRow[]

    return {
      configurations: rows.map(rowToConfiguration),
      total: count,
    }
  }

  /**
   * Update configuration name/description
   */
  async updateConfiguration(
    id: string,
    input: UpdateModelConfigurationInput
  ): Promise<SavedModelConfiguration | null> {
    const existing = await this.getConfiguration(id)
    if (!existing) return null

    const now = new Date().toISOString()
    let paramIndex = 1
    const fields = [`updated_at = $${paramIndex++}`]
    const values: (string | null)[] = [now]

    if (input.name !== undefined) {
      fields.push(`name = $${paramIndex++}`)
      values.push(input.name)
    }
    if (input.description !== undefined) {
      fields.push(`description = $${paramIndex++}`)
      values.push(input.description)
    }

    values.push(id)
    await this.pool.query(
      `UPDATE model_configurations SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )

    return this.getConfiguration(id)
  }

  /**
   * Delete a configuration (entries cascade)
   */
  async deleteConfiguration(id: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM model_configurations WHERE id = $1',
      [id]
    )
    return result.rowCount! > 0
  }

  /**
   * Check if a configuration name already exists
   */
  async nameExists(name: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT 1 FROM model_configurations WHERE name = $1',
      [name]
    )
    return result.rows.length > 0
  }

  /**
   * Get configuration by name
   */
  async getConfigurationByName(name: string): Promise<SavedModelConfiguration | null> {
    const result = await this.pool.query(
      'SELECT * FROM model_configurations WHERE name = $1',
      [name]
    )
    const row = result.rows[0] as ConfigurationRow | undefined
    if (!row) return null

    return this.getConfiguration(row.id)
  }

  /**
   * T066: Sync a preset received from another pod.
   * Uses version numbers for conflict resolution (higher version wins).
   */
  async syncPreset(preset: SavedModelConfiguration): Promise<boolean> {
    const existing = await this.getConfiguration(preset.id)

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')

      if (existing) {
        // Conflict resolution: higher version wins
        if ((existing.version ?? 1) >= (preset.version ?? 1)) {
          await client.query('ROLLBACK')
          return false // Local version is same or newer
        }

        // Update existing preset
        const now = new Date().toISOString()
        await client.query(
          `UPDATE model_configurations SET
             name = $1, description = $2, model_count = $3,
             placement_strategy = $4, min_kv_cache_mb = $5, version = $6,
             updated_at = $7
           WHERE id = $8`,
          [
            preset.name,
            preset.description ?? null,
            preset.modelCount,
            preset.placementStrategy ?? null,
            preset.minKvCacheMb ?? null,
            preset.version ?? 1,
            now,
            preset.id,
          ]
        )

        // Replace entries
        await client.query(
          'DELETE FROM model_configuration_entries WHERE config_id = $1',
          [preset.id]
        )
      } else {
        // Insert new preset
        await client.query(
          `INSERT INTO model_configurations (id, name, description, model_count, placement_strategy, min_kv_cache_mb, version, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            preset.id,
            preset.name,
            preset.description ?? null,
            preset.modelCount,
            preset.placementStrategy ?? null,
            preset.minKvCacheMb ?? null,
            preset.version ?? 1,
            preset.createdAt,
          ]
        )
      }

      // Insert entries
      if (preset.entries) {
        for (const entry of preset.entries) {
          await client.query(
            `INSERT INTO model_configuration_entries
             (id, config_id, model_path, served_model_name, max_tokens, source_type, extra_args, gpu_ids, tensor_parallel_size, load_order, sleep_mode_enabled, gpu_type_constraint, min_vram_mb, pod_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
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
              entry.minVramMb ?? null,
              entry.podId ?? null,
            ]
          )
        }
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
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
  pool: Pool
): ModelConfigurationStore {
  return new ModelConfigurationStore(pool)
}
