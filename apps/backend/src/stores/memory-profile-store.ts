/**
 * Memory Profile Store
 *
 * SQLite persistence layer for memory profiles used in capacity planning.
 */

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/index.js'
import type { MemoryProfile, UpdateMemoryProfileInput } from '@sardeenz/types'

// Row type for SQLite (snake_case)
interface MemoryProfileRow {
  id: string
  profile_name: string
  model_path: string
  max_tokens: number
  total_gpu_memory_gib: number | null // Actual GPU memory from nvidia-smi
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
  }
}

export interface CreateProfileData {
  profileName: string
  modelPath: string
  maxTokens: number
  /** Actual GPU memory from nvidia-smi */
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
  private db: Database.Database

  constructor(database?: Database.Database) {
    this.db = database || getDb()
  }

  /**
   * Create a new memory profile
   */
  createProfile(data: CreateProfileData): MemoryProfile {
    const id = randomUUID()
    const now = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO memory_profiles (
        id, profile_name, model_path, max_tokens,
        total_gpu_memory_gib, weights_memory_gib, cuda_graphs_gib, overhead_memory_gib,
        kv_cache_available_gib, kv_cache_per_request_mib,
        gpu_name, gpu_total_memory_gib,
        comments, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
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
      now
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
  getProfile(id: string): MemoryProfile | null {
    const stmt = this.db.prepare('SELECT * FROM memory_profiles WHERE id = ?')
    const row = stmt.get(id) as MemoryProfileRow | undefined
    return row ? rowToProfile(row) : null
  }

  /**
   * List all memory profiles
   */
  listProfiles(): { profiles: MemoryProfile[]; total: number } {
    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM memory_profiles')
    const countResult = countStmt.get() as { count: number }

    const selectStmt = this.db.prepare('SELECT * FROM memory_profiles ORDER BY created_at DESC')
    const rows = selectStmt.all() as MemoryProfileRow[]

    return {
      profiles: rows.map(rowToProfile),
      total: countResult.count,
    }
  }

  /**
   * Lookup profile by model_path + max_tokens + gpu_name (unique key)
   */
  lookupProfile(modelPath: string, maxTokens: number, gpuName: string): MemoryProfile | null {
    const stmt = this.db.prepare(`
      SELECT * FROM memory_profiles
      WHERE model_path = ? AND max_tokens = ? AND gpu_name = ?
    `)
    const row = stmt.get(modelPath, maxTokens, gpuName) as MemoryProfileRow | undefined
    return row ? rowToProfile(row) : null
  }

  /**
   * Find profiles for a model path (any max_tokens/gpu_name)
   */
  findProfilesByModelPath(modelPath: string): MemoryProfile[] {
    const stmt = this.db.prepare(
      'SELECT * FROM memory_profiles WHERE model_path = ? ORDER BY max_tokens'
    )
    const rows = stmt.all(modelPath) as MemoryProfileRow[]
    return rows.map(rowToProfile)
  }

  /**
   * Update a memory profile (name/comments only)
   */
  updateProfile(id: string, updates: UpdateMemoryProfileInput): MemoryProfile | null {
    const existing = this.getProfile(id)
    if (!existing) return null

    const now = new Date().toISOString()
    const fields = ['updated_at = ?']
    const values: (string | null)[] = [now]

    if (updates.profileName !== undefined) {
      fields.push('profile_name = ?')
      values.push(updates.profileName)
    }
    if (updates.comments !== undefined) {
      fields.push('comments = ?')
      values.push(updates.comments)
    }

    const stmt = this.db.prepare(`UPDATE memory_profiles SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values, id)

    return this.getProfile(id)
  }

  /**
   * Delete a memory profile
   */
  deleteProfile(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM memory_profiles WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * Check if a profile exists for the given unique key
   */
  hasProfile(modelPath: string, maxTokens: number, gpuName: string): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM memory_profiles
      WHERE model_path = ? AND max_tokens = ? AND gpu_name = ?
    `)
    const result = stmt.get(modelPath, maxTokens, gpuName)
    return result !== undefined
  }

  /**
   * Upsert a profile (update if exists, create if not)
   */
  upsertProfile(data: CreateProfileData): MemoryProfile {
    const existing = data.gpuName
      ? this.lookupProfile(data.modelPath, data.maxTokens, data.gpuName)
      : null

    if (existing) {
      // Update existing profile
      const now = new Date().toISOString()
      const stmt = this.db.prepare(`
        UPDATE memory_profiles SET
          profile_name = ?,
          total_gpu_memory_gib = ?,
          weights_memory_gib = ?,
          cuda_graphs_gib = ?,
          overhead_memory_gib = ?,
          kv_cache_available_gib = ?,
          kv_cache_per_request_mib = ?,
          gpu_total_memory_gib = ?,
          comments = ?,
          updated_at = ?
        WHERE id = ?
      `)

      stmt.run(
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
        existing.id
      )

      return this.getProfile(existing.id)!
    }

    // Create new profile
    return this.createProfile(data)
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
export function createMemoryProfileStore(database: Database.Database): MemoryProfileStore {
  return new MemoryProfileStore(database)
}
