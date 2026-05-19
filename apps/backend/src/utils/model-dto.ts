import type { ModelInstance, ModelInstanceDTO } from '@sardeenz/types'

export function toModelDTO(instance: ModelInstance): ModelInstanceDTO {
  return {
    id: instance.id,
    model_path: instance.modelPath,
    model_name: instance.modelName,
    status: instance.status,
    port: instance.port,
    process_id: instance.processId,
    max_tokens: instance.maxTokens,
    gpu_memory_utilization: instance.gpuMemoryUtilization,
    loaded_at: instance.loadedAt.toISOString(),
    ready_at: instance.readyAt?.toISOString(),
    error_message: instance.errorMessage,
    memory_metrics: instance.memoryMetrics
      ? {
          total_gpu_memory_gib: instance.memoryMetrics.totalGpuMemoryGiB,
          weights_memory_gib: instance.memoryMetrics.weightsMemoryGiB,
          cuda_graph_memory_gib: instance.memoryMetrics.cudaGraphMemoryGiB,
          overhead_memory_gib: instance.memoryMetrics.overheadMemoryGiB,
          kv_cache_available_gib: instance.memoryMetrics.kvCacheAvailableGiB,
          kv_cache_per_request_mib: instance.memoryMetrics.kvCachePerRequestMiB,
          max_model_len: instance.memoryMetrics.maxModelLen,
        }
      : undefined,
    has_chat_template: instance.hasChatTemplate,
    launch_command: instance.launchCommand,
    gpu_ids: instance.gpuIds,
    tensor_parallel_size: instance.tensorParallelSize,
    kvcached_enabled: instance.kvcachedEnabled,
    memory_baseline_by_gpu: instance.memoryBaselineByGpu,
    sleep_mode_enabled: instance.sleepModeEnabled,
    sleep_level: instance.sleepLevel,
    slept_at: instance.sleptAt?.toISOString(),
    routable: instance.routable,
  }
}
