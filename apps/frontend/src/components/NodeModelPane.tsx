import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import {
  Card,
  CardBody,
  EmptyState,
  EmptyStateBody,
  EmptyStateActions,
  EmptyStateFooter,
  Button,
  Spinner,
  Flex,
  FlexItem,
} from '@patternfly/react-core'
import { CubesIcon } from '@patternfly/react-icons'
import type {
  ModelInstanceDTO,
  MultiGpuMemoryUsageResponse,
} from '@sardeenz/types'
import { apiClient } from '../services/api'
import { useNotifications } from '../contexts/NotificationContext'
import { useOperations } from '../contexts/OperationsContext'
import { ModelToolbar } from './ModelToolbar'
import type { ViewMode, FilterState, SortField, SortDirection } from './ModelToolbar'
import { GpuGroupSection } from './GpuGroupSection'
import { ModelTable } from './ModelTable'
import { MoveModelDialog } from './MoveModelDialog'

function getGpuGroupKey(model: ModelInstanceDTO): string {
  return model.gpu_ids.length > 1 ? 'multi-gpu' : `gpu-${model.gpu_ids[0]}`
}

function formatGpuLabel(gpuKey: string): string {
  if (gpuKey === 'multi-gpu') return 'Multi-GPU'
  return gpuKey.replace('gpu-', 'GPU ')
}

export interface NodeModelPaneProps {
  podId: string
  isLocalPod: boolean
  isClusterMode: boolean
  gpuMemoryData: MultiGpuMemoryUsageResponse | null
  kvCacheTotalByGpu: Record<number, number>
  memoryUtilizationByInstance: Record<string, number>
  onGpuRefresh: () => void
  onModelsChanged?: () => void
  isSplitView?: boolean
}

export interface NodeModelPaneHandle {
  openMoveDialog: (model: ModelInstanceDTO, targetGpuIds: number[], targetPodId?: string, modelSourcePodId?: string) => void
}

export const NodeModelPane = forwardRef<NodeModelPaneHandle, NodeModelPaneProps>(function NodeModelPane({
  podId,
  isLocalPod,
  isClusterMode,
  gpuMemoryData,
  kvCacheTotalByGpu,
  memoryUtilizationByInstance,
  onGpuRefresh,
  onModelsChanged,
  isSplitView,
}, ref) {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [unloadingInstanceId, setUnloadingInstanceId] = useState<string | null>(null)
  const [sleepingInstanceId, setSleepingInstanceId] = useState<string | null>(null)
  const [wakingInstanceId, setWakingInstanceId] = useState<string | null>(null)

  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [filters, setFilters] = useState<FilterState>({
    status: [],
    gpuAssignment: [],
    searchTerm: '',
  })
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  const [expandedGpuGroups, setExpandedGpuGroups] = useState<Set<string>>(new Set())
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveModalModel, setMoveModalModel] = useState<ModelInstanceDTO | null>(null)
  const [moveTargetGpuIds, setMoveTargetGpuIds] = useState<number[]>([])
  const [moveTargetPodId, setMoveTargetPodId] = useState<string | undefined>(undefined)
  const [moveModelSourcePodId, setMoveModelSourcePodId] = useState<string | undefined>(undefined)

  // Self-fetch GPU memory data so we always know all GPUs (even empty ones)
  const [selfGpuData, setSelfGpuData] = useState<MultiGpuMemoryUsageResponse | null>(null)

  const { addNotification } = useNotifications()
  const { startOperation, endOperation } = useOperations()

  const fetchGpuMemory = useCallback(async () => {
    try {
      const data = isLocalPod
        ? await apiClient.getMultiGpuMemoryUsage()
        : await apiClient.getClusterPodMemory(podId)
      setSelfGpuData(data)
    } catch {
      // Non-critical — GPU groups just won't show empty GPUs
    }
  }, [podId, isLocalPod])

  useEffect(() => {
    setSelfGpuData(null)
    fetchGpuMemory()
    const interval = setInterval(fetchGpuMemory, 5000)
    return () => clearInterval(interval)
  }, [fetchGpuMemory])

  // Parent-provided data takes priority (more frequent updates from GpuMemoryPanel), self-fetched as fallback
  const effectiveGpuMemoryData = gpuMemoryData ?? selfGpuData

  const effectiveKvCacheTotalByGpu = useMemo(() => {
    if (isLocalPod && Object.keys(kvCacheTotalByGpu).length > 0) return kvCacheTotalByGpu
    const src = effectiveGpuMemoryData
    if (!src) return {}
    const map: Record<number, number> = {}
    for (const gpu of src.gpus) {
      map[gpu.gpu_index] = gpu.kvcache?.total_gb ?? src.kvcache.total_gb
    }
    return map
  }, [isLocalPod, kvCacheTotalByGpu, effectiveGpuMemoryData])

  const effectiveMemoryUtilByInstance = useMemo(() => {
    if (isLocalPod && Object.keys(memoryUtilizationByInstance).length > 0) return memoryUtilizationByInstance
    const src = effectiveGpuMemoryData
    if (!src) return {}
    const map: Record<string, number> = {}
    for (const gpu of src.gpus) {
      for (const model of gpu.models) {
        map[model.instance_id] = gpu.total_gb > 0 ? model.gpu_memory_gb / gpu.total_gb : 0
      }
    }
    return map
  }, [isLocalPod, memoryUtilizationByInstance, effectiveGpuMemoryData])

  const fetchModels = useCallback(async () => {
    try {
      if (isLocalPod) {
        const response = await apiClient.listModels()
        setModels(response.models)
      } else {
        const response = await apiClient.getClusterPodModelsFull(podId)
        setModels(response.models)
      }
    } catch (err) {
      addNotification({
        title: 'Error fetching models',
        description: err instanceof Error ? err.message : `Failed to fetch models from ${podId}`,
        variant: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }, [podId, isLocalPod, addNotification])

  useEffect(() => {
    setLoading(true)
    setModels([])
    setExpandedGpuGroups(new Set())
    setExpandedCards(new Set())
    fetchModels()
  }, [podId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const interval = setInterval(fetchModels, 5000)
    return () => clearInterval(interval)
  }, [fetchModels])

  // Filter and sort
  const filteredModels = useMemo(() => {
    return models
      .filter((model) => {
        if (filters.status.length > 0 && !filters.status.includes(model.status)) return false
        if (filters.gpuAssignment.length > 0) {
          const gpuKey = getGpuGroupKey(model)
          if (!filters.gpuAssignment.includes(gpuKey)) return false
        }
        if (filters.searchTerm) {
          const term = filters.searchTerm.toLowerCase()
          return model.model_path.toLowerCase().includes(term) || model.model_name.toLowerCase().includes(term)
        }
        return true
      })
      .sort((a, b) => {
        let comparison = 0
        switch (sortBy) {
          case 'name': comparison = a.model_path.localeCompare(b.model_path); break
          case 'startTime': comparison = (a.loaded_at || '').localeCompare(b.loaded_at || ''); break
          case 'memoryUsage': comparison = a.gpu_memory_utilization - b.gpu_memory_utilization; break
        }
        return sortDirection === 'asc' ? comparison : -comparison
      })
  }, [models, filters, sortBy, sortDirection])

  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInstanceDTO[]> = {}
    filteredModels.forEach((model) => {
      const gpuKey = getGpuGroupKey(model)
      if (!groups[gpuKey]) groups[gpuKey] = []
      groups[gpuKey].push(model)
    })
    return groups
  }, [filteredModels])

  const availableGpusFromModels = useMemo(() => {
    const gpuSet = new Set<string>()
    models.forEach((m) => gpuSet.add(getGpuGroupKey(m)))
    return Array.from(gpuSet).sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [models])

  const allAvailableGpus = useMemo(() => {
    if (!effectiveGpuMemoryData?.gpus) return availableGpusFromModels
    const gpuKeys = effectiveGpuMemoryData.gpus.map((gpu) => `gpu-${gpu.gpu_index}`)
    if (models.some((m) => m.gpu_ids.length > 1)) gpuKeys.push('multi-gpu')
    return gpuKeys.sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [effectiveGpuMemoryData, models, availableGpusFromModels])

  // Auto-expand/collapse GPU groups
  useEffect(() => {
    if (allAvailableGpus.length > 0 && expandedGpuGroups.size === 0) {
      const nonEmpty = allAvailableGpus.filter((k) => groupedModels[k]?.length)
      setExpandedGpuGroups(new Set(nonEmpty))
    }
  }, [allAvailableGpus, expandedGpuGroups.size, groupedModels])

  useEffect(() => {
    setExpandedGpuGroups((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const gpuKey of prev) {
        if (!groupedModels[gpuKey]?.length) { next.delete(gpuKey); changed = true }
      }
      for (const gpuKey of Object.keys(groupedModels)) {
        if (groupedModels[gpuKey]?.length && !prev.has(gpuKey)) { next.add(gpuKey); changed = true }
      }
      return changed ? next : prev
    })
  }, [groupedModels])

  const orderedGpuKeys = useMemo(() => {
    const keys = new Set(allAvailableGpus)
    Object.keys(groupedModels).forEach((k) => keys.add(k))
    return Array.from(keys).sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [allAvailableGpus, groupedModels])

  // Actions — use cluster endpoints for remote pods, local endpoints for local pod
  const handleUnloadModel = async (instanceId: string, modelPath: string, isFailed: boolean) => {
    setUnloadingInstanceId(instanceId)
    const opId = startOperation({ type: 'unload', label: `Unloading ${modelPath}`, targetId: instanceId })
    try {
      if (isLocalPod) {
        await apiClient.unloadModelByInstanceId(instanceId)
      } else {
        await apiClient.clusterUnloadModel(instanceId)
      }
      addNotification({
        title: isFailed ? 'Model removed' : 'Model unloaded',
        description: `Successfully ${isFailed ? 'removed' : 'unloaded'}: ${modelPath}`,
        variant: 'success',
      })
      await fetchModels()
      onGpuRefresh()
      onModelsChanged?.()
    } catch (err) {
      addNotification({
        title: isFailed ? 'Failed to remove model' : 'Failed to unload model',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setUnloadingInstanceId(null)
      endOperation(opId)
    }
  }

  const handleSleepModel = async (instanceId: string) => {
    const model = models.find((m) => m.id === instanceId)
    if (!model) return
    setSleepingInstanceId(instanceId)
    const opId = startOperation({ type: 'sleep', label: `Sleeping ${model.model_path}`, targetId: instanceId })
    try {
      if (isLocalPod) {
        await apiClient.sleepModel(instanceId)
      } else {
        await apiClient.clusterSleepModel(instanceId)
      }
      addNotification({ title: 'Model sleeping', description: `${model.model_path} has been put to sleep`, variant: 'success' })
      await fetchModels()
      onGpuRefresh()
      onModelsChanged?.()
    } catch (err) {
      addNotification({ title: 'Failed to sleep model', description: err instanceof Error ? err.message : 'Unknown error', variant: 'danger' })
    } finally {
      setSleepingInstanceId(null)
      endOperation(opId)
    }
  }

  const handleWakeModel = async (instanceId: string) => {
    const model = models.find((m) => m.id === instanceId)
    if (!model) return
    setWakingInstanceId(instanceId)
    const opId = startOperation({ type: 'wake', label: `Waking ${model.model_path}`, targetId: instanceId })
    try {
      if (isLocalPod) {
        await apiClient.wakeModel(instanceId)
      } else {
        await apiClient.clusterWakeModel(instanceId)
      }
      addNotification({ title: 'Model woken up', description: `${model.model_path} is now ready for inference`, variant: 'success' })
      await fetchModels()
      onGpuRefresh()
      onModelsChanged?.()
    } catch (err) {
      addNotification({ title: 'Failed to wake model', description: err instanceof Error ? err.message : 'Unknown error', variant: 'danger' })
    } finally {
      setWakingInstanceId(null)
      endOperation(opId)
    }
  }

  // Drag-and-drop targets (handled by parent DndContext, but move dialog is local)
  const handleMoveModel = useCallback((model: ModelInstanceDTO) => {
    setMoveModalModel(model)
    setMoveTargetGpuIds([])
    setMoveModalOpen(true)
  }, [])

  const handleMoveComplete = useCallback(() => {
    fetchModels()
    onGpuRefresh()
    onModelsChanged?.()
    setMoveModalOpen(false)
    setMoveModalModel(null)
    setMoveTargetGpuIds([])
    setMoveTargetPodId(undefined)
  }, [fetchModels, onGpuRefresh, onModelsChanged])

  useImperativeHandle(ref, () => ({
    openMoveDialog: (model: ModelInstanceDTO, targetGpuIds: number[], targetPodId?: string, modelSourcePodId?: string) => {
      setMoveModalModel(model)
      setMoveTargetGpuIds(targetGpuIds)
      setMoveTargetPodId(targetPodId)
      setMoveModelSourcePodId(modelSourcePodId)
      setMoveModalOpen(true)
    },
  }), [])

  const handleGpuGroupToggle = (gpuKey: string) => {
    setExpandedGpuGroups((prev) => {
      const next = new Set(prev)
      if (next.has(gpuKey)) next.delete(gpuKey)
      else next.add(gpuKey)
      return next
    })
  }

  const handleCardToggle = (instanceId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(instanceId)) next.delete(instanceId)
      else next.add(instanceId)
      return next
    })
  }

  const handleTableSort = (field: SortField) => {
    if (field === sortBy) setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(field); setSortDirection('asc') }
  }

  const handleClearAllFilters = () => {
    setFilters({ status: [], gpuAssignment: [], searchTerm: '' })
  }

  if (loading) {
    return (
      <Flex justifyContent={{ default: 'justifyContentCenter' }} style={{ padding: 'var(--pf-t--global--spacer--xl) 0' }}>
        <FlexItem><Spinner size="lg" aria-label={`Loading models for ${podId}`} /></FlexItem>
      </Flex>
    )
  }

  const hasGpuData = orderedGpuKeys.length > 0

  return (
    <>
      {models.length > 0 && (
        <ModelToolbar
          filters={filters}
          onFiltersChange={setFilters}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSortChange={(field, direction) => { setSortBy(field); setSortDirection(direction) }}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          availableGpus={allAvailableGpus}
          onClearAllFilters={handleClearAllFilters}
        />
      )}

      <div style={{ marginTop: models.length > 0 ? 'var(--pf-t--global--spacer--md)' : undefined }}>
        {models.length > 0 && filteredModels.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState titleText="No models match filters" icon={CubesIcon}>
                <EmptyStateBody>Try adjusting your filters or search term.</EmptyStateBody>
                <EmptyStateFooter>
                  <EmptyStateActions>
                    <Button variant="link" onClick={handleClearAllFilters}>Clear all filters</Button>
                  </EmptyStateActions>
                </EmptyStateFooter>
              </EmptyState>
            </CardBody>
          </Card>
        ) : hasGpuData && viewMode === 'card' ? (
          <>
            {orderedGpuKeys.map((gpuKey) => (
              <GpuGroupSection
                key={gpuKey}
                gpuKey={gpuKey}
                gpuLabel={formatGpuLabel(gpuKey)}
                gpuIndex={gpuKey === 'multi-gpu' ? -1 : parseInt(gpuKey.replace('gpu-', ''), 10)}
                podId={podId}
                models={groupedModels[gpuKey] || []}
                isExpanded={expandedGpuGroups.has(gpuKey)}
                onToggle={handleGpuGroupToggle}
                onUnload={handleUnloadModel}
                onSleep={handleSleepModel}
                onWake={handleWakeModel}
                onMove={handleMoveModel}
                unloadingInstanceId={unloadingInstanceId}
                sleepingInstanceId={sleepingInstanceId}
                wakingInstanceId={wakingInstanceId}
                expandedCards={expandedCards}
                onCardToggle={handleCardToggle}
                kvCacheTotalByGpu={effectiveKvCacheTotalByGpu}
                memoryUtilizationByInstance={effectiveMemoryUtilByInstance}
                isSplitView={isSplitView}
              />
            ))}
          </>
        ) : models.length > 0 && viewMode === 'table' ? (
          <ModelTable
            models={filteredModels}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSort={handleTableSort}
            onUnload={handleUnloadModel}
            onSleep={handleSleepModel}
            onWake={handleWakeModel}
            unloadingInstanceId={unloadingInstanceId}
            sleepingInstanceId={sleepingInstanceId}
            wakingInstanceId={wakingInstanceId}
          />
        ) : !hasGpuData ? (
          <Card>
            <CardBody>
              <EmptyState titleText="No models loaded" icon={CubesIcon}>
                <EmptyStateBody>
                  {isClusterMode
                    ? `Pod ${podId} has no models loaded.`
                    : 'Start a model to get started with inference.'}
                </EmptyStateBody>
              </EmptyState>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <MoveModelDialog
        isOpen={moveModalOpen}
        onClose={() => { setMoveModalOpen(false); setMoveModalModel(null); setMoveTargetGpuIds([]); setMoveTargetPodId(undefined) }}
        model={moveModalModel}
        preselectedGpuIds={moveTargetGpuIds}
        preselectedPodId={moveTargetPodId}
        sourcePodId={moveModelSourcePodId ?? podId}
        gpuMemoryData={effectiveGpuMemoryData}
        onMoveComplete={handleMoveComplete}
        isClusterMode={isClusterMode}
      />
    </>
  )
})
