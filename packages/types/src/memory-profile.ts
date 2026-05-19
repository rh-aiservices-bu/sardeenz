/**
 * Memory Profiling Types
 *
 * Types for GPU memory profiling and capacity planning.
 */

/**
 * Warning level for pre-load memory checks
 */
export enum MemoryWarningLevel {
  /** Model will definitely not fit */
  Danger = 'danger',
  /** Memory is tight, may succeed */
  Caution = 'caution',
  /** No profile found for this configuration */
  Info = 'info',
  /** Model should fit fine */
  Ok = 'ok',
}

/**
 * A saved memory profile for a model configuration
 */
export interface MemoryProfile {
  id: string
  /** Human-readable profile name */
  profileName: string
  /** Model path (e.g., "HuggingFaceTB/SmolLM2-135M-Instruct") */
  modelPath: string
  /** Max tokens configuration when profiled */
  maxTokens: number

  // Memory metrics
  /** Total actual GPU memory consumed by the model process in GiB (from NVML) */
  totalGpuMemoryGib: number
  /** Model weights memory in GiB */
  weightsMemoryGib: number
  /** CUDA graph capture memory in GiB */
  cudaGraphsGib: number
  /** Overhead memory (total - weights - CUDA graphs) in GiB */
  overheadMemoryGib: number
  /** @deprecated KV cache available - meaningless with kvcached, kept for backwards compat */
  kvCacheAvailableGib: number
  /** Estimated KV cache per request in MiB */
  kvCachePerRequestMib?: number

  // GPU context
  /** GPU name where profile was captured */
  gpuName?: string
  /** Total GPU memory in GiB */
  gpuTotalMemoryGib?: number

  // Metadata
  /** User comments */
  comments?: string
  /** Who created the profile */
  createdBy?: string
  /** When profile was created */
  createdAt: string
  /** When profile was last updated */
  updatedAt?: string

  // Cluster context
  /** GPU type used for profiling (e.g., "NVIDIA A100") */
  gpuType?: string
  /** Total VRAM in MB of the GPU used for profiling */
  gpuVramMb?: number
  /** Pod ID that generated this profile */
  sourcePodId?: string
}

/**
 * Input for creating a memory profile
 */
export interface CreateMemoryProfileInput {
  /** Instance ID to capture profile from */
  instanceId?: string
  /** Optional custom profile name */
  profileName?: string
  /** Optional comments */
  comments?: string

  // For manual entry (if no instanceId)
  modelPath?: string
  maxTokens?: number
  /** Total actual GPU memory consumed in GiB (required for manual entry) */
  totalGpuMemoryGib?: number
  weightsMemoryGib?: number
  cudaGraphsGib?: number
  /** Overhead will be auto-calculated if not provided */
  overheadMemoryGib?: number
  /** @deprecated No longer used, kept for backwards compat */
  kvCacheAvailableGib?: number
  kvCachePerRequestMib?: number
  gpuName?: string
  gpuTotalMemoryGib?: number
}

/**
 * Input for updating a memory profile
 */
export interface UpdateMemoryProfileInput {
  profileName?: string
  comments?: string
}

/**
 * Result of a pre-load memory check
 */
export interface MemoryCheckResult {
  /** Whether a matching profile was found */
  hasProfile: boolean
  /** Whether the model is estimated to fit */
  canFit: boolean
  /** Warning level for UI display */
  warningLevel: MemoryWarningLevel
  /** Human-readable message */
  message: string
  /** The matching profile (if found) */
  profile?: MemoryProfile
  /** Available GPU memory in GiB */
  availableMemoryGib?: number
  /** Estimated required memory in GiB */
  estimatedRequiredGib?: number
}

/**
 * Input for pre-load memory check
 */
export interface MemoryCheckInput {
  /** Model path to check */
  modelPath: string
  /** Max tokens configuration */
  maxTokens: number
  /** Target GPU name */
  gpuName: string
}

/**
 * Computed fixed cost for a model (weights + CUDA graphs)
 */
export interface ModelFixedCost {
  /** Total fixed cost in GiB */
  totalGib: number
  /** Weights portion in GiB */
  weightsGib: number
  /** CUDA graphs portion in GiB */
  cudaGraphsGib: number
}
