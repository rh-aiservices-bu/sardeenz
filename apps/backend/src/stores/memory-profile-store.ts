/**
 * Memory Profile Store
 *
 * PostgreSQL persistence layer for memory profiles used in capacity planning.
 */

import type { Pool } from 'pg'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { getPool } from '../db/index.js'
import type { MemoryProfile, UpdateMemoryProfileInput } from '@sardeenz/types'
import { peerStore } from './peer-store.js'
import { signRequest } from '../services/cluster-auth.js'
import { config } from '../config.js'

// Row type for PostgreSQL (snake_case)
interface MemoryProfileRow {
  id: string
  profile_name: string
  model_path: string
  max_tokens: number
  total_gpu_memory_gib: number | null // Actual GPU memory from NVML
  weights_memory_gib: number
  cuda_graphs_gib: number
  overhead_memory_gib: number | null // Total - weights - CUDA graphs
  kv_cache_available_gib: number
  kv_cache_per_request_mib: number | null
  gpu_name: string | null
  gpu_total_memory_gib: number | null
  comments: string | null
  created_by: string | null
  created_at: string
  updated_at: string | null
  gpu_type: string | null
  gpu_vram_mb: number | null
  source_pod_id: string | null
}

// Convert row to domain object
function rowToProfile(row: MemoryProfileRow): MemoryProfile {
  // Calculate fallback for totalGpuMemoryGib if not stored (for legacy profiles)
  const totalGpuMemoryGib = row.total_gpu_memory_gib ?? row.weights_memory_gib + row.cuda_graphs_gib
  const overheadMemoryGib = row.overhead_memory_gib ?? 0

  return {
    id: row.id,
    profileName: row.profile_name,
    modelPath: row.model_path,
    maxTokens: row.max_tokens,
    totalGpuMemoryGib,
    weightsMemoryGib: row.weights_memory_gib,
    cudaGraphsGib: row.cuda_graphs_gib,
    overheadMemoryGib,
    kvCacheAvailableGib: row.kv_cache_available_gib,
    kvCachePerRequestMib: row.kv_cache_per_request_mib ?? undefined,
    gpuName: row.gpu_name ?? undefined,
    gpuTotalMemoryGib: row.gpu_total_memory_gib ?? undefined,
    comments: row.comments ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    gpuType: row.gpu_type ?? undefined,
    gpuVramMb: row.gpu_vram_mb ?? undefined,
    sourcePodId: row.source_pod_id ?? undefined,
  }
}

export interface CreateProfileData {
  profileName: string
  modelPath: string
  maxTokens: number
  /** Actual GPU memory from NVML */
  totalGpuMemoryGib: number
  weightsMemoryGib: number
  cudaGraphsGib: number
  /** Overhead = total - weights - CUDA graphs */
  overheadMemoryGib: number
  kvCacheAvailableGib: number
  kvCachePerRequestMib?: number
  gpuName?: string
  gpuTotalMemoryGib?: number
  comments?: string
  createdBy?: string
}

class MemoryProfileStore {
  private pool: Pool

  constructor(pool?: Pool) {
    this.pool = pool || getPool()
  }

  /**
   * Create a new memory profile
   */
  async createProfile(data: CreateProfileData): Promise<MemoryProfile> {
    const id = randomUUID()
    const now = new Date().toISOString()

    await this.pool.query(
      `
      INSERT INTO memory_profiles (
        id, profile_name, model_path, max_tokens,
        total_gpu_memory_gib, weights_memory_gib, cuda_graphs_gib, overhead_memory_gib,
        kv_cache_available_gib, kv_cache_per_request_mib,
        gpu_name, gpu_total_memory_gib,
        comments, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        id,
        data.profileName,
        data.modelPath,
        data.maxTokens,
        data.totalGpuMemoryGib,
        data.weightsMemoryGib,
        data.cudaGraphsGib,
        data.overheadMemoryGib,
        data.kvCacheAvailableGib,
        data.kvCachePerRequestMib ?? null,
        data.gpuName ?? null,
        data.gpuTotalMemoryGib ?? null,
        data.comments ?? null,
        data.createdBy ?? null,
        now,
      ]
    )

    return {
      id,
      profileName: data.profileName,
      modelPath: data.modelPath,
      maxTokens: data.maxTokens,
      totalGpuMemoryGib: data.totalGpuMemoryGib,
      weightsMemoryGib: data.weightsMemoryGib,
      cudaGraphsGib: data.cudaGraphsGib,
      overheadMemoryGib: data.overheadMemoryGib,
      kvCacheAvailableGib: data.kvCacheAvailableGib,
      kvCachePerRequestMib: data.kvCachePerRequestMib,
      gpuName: data.gpuName,
      gpuTotalMemoryGib: data.gpuTotalMemoryGib,
      comments: data.comments,
      createdBy: data.createdBy,
      createdAt: now,
    }
  }

  /**
   * Get a memory profile by ID
   */
  async getProfile(id: string): Promise<MemoryProfile | null> {
    const result = await this.pool.query('SELECT * FROM memory_profiles WHERE id = $1', [id])
    const row = result.rows[0] as MemoryProfileRow | undefined
    return row ? rowToProfile(row) : null
  }

  /**
   * List all memory profiles
   */
  async listProfiles(): Promise<{ profiles: MemoryProfile[]; total: number }> {
    const countResult = await this.pool.query('SELECT COUNT(*) as count FROM memory_profiles')
    const count = parseInt(countResult.rows[0].count, 10)

    const selectResult = await this.pool.query(
      'SELECT * FROM memory_profiles ORDER BY created_at DESC'
    )
    const rows = selectResult.rows as MemoryProfileRow[]

    return {
      profiles: rows.map(rowToProfile),
      total: count,
    }
  }

  /**
   * Lookup profile by model_path + max_tokens + gpu_name (unique key)
   */
  async lookupProfile(
    modelPath: string,
    maxTokens: number,
    gpuName: string
  ): Promise<MemoryProfile | null> {
    const result = await this.pool.query(
      `
      SELECT * FROM memory_profiles
      WHERE model_path = $1 AND max_tokens = $2 AND gpu_name = $3
      `,
      [modelPath, maxTokens, gpuName]
    )
    const row = result.rows[0] as MemoryProfileRow | undefined
    return row ? rowToProfile(row) : null
  }

  /**
   * Find profiles for a model path (any max_tokens/gpu_name)
   */
  async findProfilesByModelPath(modelPath: string): Promise<MemoryProfile[]> {
    const result = await this.pool.query(
      'SELECT * FROM memory_profiles WHERE model_path = $1 ORDER BY max_tokens',
      [modelPath]
    )
    const rows = result.rows as MemoryProfileRow[]
    return rows.map(rowToProfile)
  }

  /**
   * Update a memory profile (name/comments only)
   */
  async updateProfile(
    id: string,
    updates: UpdateMemoryProfileInput
  ): Promise<MemoryProfile | null> {
    const existing = await this.getProfile(id)
    if (!existing) return null

    const now = new Date().toISOString()
    let paramIndex = 1
    const fields = [`updated_at = $${paramIndex++}`]
    const values: (string | null)[] = [now]

    if (updates.profileName !== undefined) {
      fields.push(`profile_name = $${paramIndex++}`)
      values.push(updates.profileName)
    }
    if (updates.comments !== undefined) {
      fields.push(`comments = $${paramIndex++}`)
      values.push(updates.comments)
    }

    values.push(id)
    await this.pool.query(
      `UPDATE memory_profiles SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )

    return this.getProfile(id)
  }

  /**
   * Delete a memory profile
   */
  async deleteProfile(id: string): Promise<boolean> {
    const result = await this.pool.query('DELETE FROM memory_profiles WHERE id = $1', [id])
    return result.rowCount! > 0
  }

  /**
   * Check if a profile exists for the given unique key
   */
  async hasProfile(modelPath: string, maxTokens: number, gpuName: string): Promise<boolean> {
    const result = await this.pool.query(
      `
      SELECT 1 FROM memory_profiles
      WHERE model_path = $1 AND max_tokens = $2 AND gpu_name = $3
      `,
      [modelPath, maxTokens, gpuName]
    )
    return result.rows.length > 0
  }

  /**
   * Upsert a profile (update if exists, create if not)
   */
  async upsertProfile(data: CreateProfileData): Promise<MemoryProfile> {
    const existing = data.gpuName
      ? await this.lookupProfile(data.modelPath, data.maxTokens, data.gpuName)
      : null

    if (existing) {
      // Update existing profile
      const now = new Date().toISOString()
      await this.pool.query(
        `
        UPDATE memory_profiles SET
          profile_name = $1,
          total_gpu_memory_gib = $2,
          weights_memory_gib = $3,
          cuda_graphs_gib = $4,
          overhead_memory_gib = $5,
          kv_cache_available_gib = $6,
          kv_cache_per_request_mib = $7,
          gpu_total_memory_gib = $8,
          comments = $9,
          updated_at = $10
        WHERE id = $11
        `,
        [
          data.profileName,
          data.totalGpuMemoryGib,
          data.weightsMemoryGib,
          data.cudaGraphsGib,
          data.overheadMemoryGib,
          data.kvCacheAvailableGib,
          data.kvCachePerRequestMib ?? null,
          data.gpuTotalMemoryGib ?? null,
          data.comments ?? null,
          now,
          existing.id,
        ]
      )

      return (await this.getProfile(existing.id))!
    }

    // Create new profile
    return this.createProfile(data)
  }

  /**
   * T071: Auto-push a profile to all healthy peers.
   * Fire-and-forget with HMAC signing. Only active in cluster mode.
   */
  pushProfileToPeers(profile: MemoryProfile): void {
    // Only push in cluster mode
    if (!process.env.KUBERNETES_SERVICE_HOST && !config.clusterPeers) return

    const peers = peerStore.getHealthyPeers()
    const localPodId = hostname()

    for (const peer of peers) {
      if (peer.podId === localPodId) continue

      const internalPath = '/internal/memory-profiles'
      const body = JSON.stringify({ profiles: [profile] })
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      if (config.clusterSecret) {
        const { signature, timestamp } = signRequest('POST', internalPath, body, config.clusterSecret)
        headers['x-cluster-signature'] = signature
        headers['x-cluster-timestamp'] = String(timestamp)
      }

      fetch(`http://${peer.address}:${peer.port}${internalPath}`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {
        // Fire-and-forget — peers will sync during reconciliation
      })
    }
  }
}

// Singleton instance
let memoryProfileStore: MemoryProfileStore | null = null

export function getMemoryProfileStore(): MemoryProfileStore {
  if (!memoryProfileStore) {
    memoryProfileStore = new MemoryProfileStore()
  }
  return memoryProfileStore
}

// For testing with custom database
export function createMemoryProfileStore(pool: Pool): MemoryProfileStore {
  return new MemoryProfileStore(pool)
}
