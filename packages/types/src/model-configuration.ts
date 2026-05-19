/**
 * Model Configuration Save/Load Types
 *
 * Types for saving and loading model configurations.
 */

import type { ModelSourceType } from './api.js'

/**
 * A single model entry within a saved configuration
 */
export interface ModelConfigurationEntry {
  id: string
  configId: string
  modelPath: string
  servedModelName?: string
  maxTokens: number
  sourceType: ModelSourceType
  extraArgs?: string[]
  gpuIds?: number[]
  tensorParallelSize: number
  loadOrder: number
  sleepModeEnabled?: boolean
  gpuTypeConstraint?: string
  minVramMb?: number
  podId?: string
}

/**
 * A saved model configuration (header with entries)
 */
export interface SavedModelConfiguration {
  id: string
  name: string
  description?: string
  modelCount: number
  placementStrategy?: 'maximize-models' | 'balanced' | null
  minKvCacheMb?: number | null
  version?: number
  createdAt: string
  updatedAt?: string
  entries?: ModelConfigurationEntry[]
}

/**
 * Input for creating a new configuration
 */
export interface CreateModelConfigurationInput {
  name: string
  description?: string
}

/**
 * Input for updating a configuration
 */
export interface UpdateModelConfigurationInput {
  name?: string
  description?: string
}

/**
 * Status of a configuration load operation
 */
export enum ConfigurationLoadStatus {
  Pending = 'pending',
  Unloading = 'unloading',
  Loading = 'loading',
  Completed = 'completed',
  PartiallyCompleted = 'partially_completed',
  Failed = 'failed',
}

/**
 * Progress update during configuration load
 */
export interface ConfigurationLoadProgress {
  status: ConfigurationLoadStatus
  totalModels: number
  modelsUnloaded: number
  modelsLoaded: number
  currentModel?: string
  errors: string[]
}
