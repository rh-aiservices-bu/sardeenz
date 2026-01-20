import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragEndEvent, pointerWithin } from '@dnd-kit/core'
import {
  PageSection,
  Content,
  Card,
  CardBody,
  Button,
  Spinner,
  EmptyState,
  EmptyStateBody,
  EmptyStateActions,
  EmptyStateFooter,
  Flex,
  FlexItem,
  ClipboardCopy,
  ClipboardCopyVariant,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core'
import { PlusCircleIcon, CubesIcon, SaveIcon, UploadIcon, TrashIcon } from '@patternfly/react-icons'
import { apiClient } from '../services/api'
import type {
  ModelInstanceDTO,
  LoadModelRequest,
  MultiGpuMemoryUsageResponse,
} from '@sardeenz/types'
import {
  LoadModelDialog,
  GpuMemoryPanel,
  SaveConfigurationDialog,
  LoadConfigurationDialog,
  ModelToolbar,
  GpuGroupSection,
  ModelTable,
  MoveModelDialog,
} from '../components'
import type { ViewMode, FilterState, SortField, SortDirection, ConfigLoadStartedInfo } from '../components'
import { useNotifications } from '../contexts/NotificationContext'
import { useOperations } from '../contexts/OperationsContext'

// Helper to determine GPU group key
function getGpuGroupKey(model: ModelInstanceDTO): string {
  return model.gpu_ids.length > 1 ? 'multi-gpu' : `gpu-${model.gpu_ids[0]}`
}

// Format GPU key to display label
function formatGpuLabel(gpuKey: string): string {
  if (gpuKey === 'multi-gpu') return 'Multi-GPU'
  return gpuKey.replace('gpu-', 'GPU ')
}

function ModelManagement() {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)
  const [unloadingInstanceId, setUnloadingInstanceId] = useState<string | null>(null)
  const [sleepingInstanceId, setSleepingInstanceId] = useState<string | null>(null)
  const [wakingInstanceId, setWakingInstanceId] = useState<string | null>(null)
  const [isSaveConfigOpen, setIsSaveConfigOpen] = useState(false)
  const [isLoadConfigOpen, setIsLoadConfigOpen] = useState(false)
  const [isUnloadAllModalOpen, setIsUnloadAllModalOpen] = useState(false)
  const [isUnloadingAll, setIsUnloadingAll] = useState(false)
  const [gpuRefreshTrigger, setGpuRefreshTrigger] = useState(0)
  // KV cache total per GPU (gpu index -> total_gb), updated from GpuMemoryPanel
  const [kvCacheTotalByGpu, setKvCacheTotalByGpu] = useState<Record<number, number>>({})
  // GPU memory utilization per instance (instance_id -> percentage 0-1), from GpuMemoryPanel
  const [memoryUtilizationByInstance, setMemoryUtilizationByInstance] = useState<
    Record<string, number>
  >({})

  // View mode state
  const [viewMode, setViewMode] = useState<ViewMode>('card')

  // Filter state
  const [filters, setFilters] = useState<FilterState>({
    status: [],
    gpuAssignment: [],
    searchTerm: '',
  })

  // Sort state
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')

  // Expansion state
  const [expandedGpuGroups, setExpandedGpuGroups] = useState<Set<string>>(new Set())
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  // Move modal state
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveModalModel, setMoveModalModel] = useState<ModelInstanceDTO | null>(null)
  const [moveTargetGpuIds, setMoveTargetGpuIds] = useState<number[]>([])
  // State for GPU memory data needed by move modal
  const [gpuMemoryData, setGpuMemoryData] = useState<MultiGpuMemoryUsageResponse | null>(null)

  // Configuration loading tracking state
  const [configLoadingInfo, setConfigLoadingInfo] = useState<{
    operationId: string
    expectedModelCount: number
    configurationName: string
  } | null>(null)
  const configLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { addNotification } = useNotifications()
  const { startOperation, endOperation } = useOperations()

  // Trigger GPU memory panel refresh
  const triggerGpuRefresh = useCallback(() => {
    setGpuRefreshTrigger((prev) => prev + 1)
  }, [])

  // Handle memory data updates from GpuMemoryPanel
  const handleMemoryDataChange = useCallback((data: MultiGpuMemoryUsageResponse) => {
    setGpuMemoryData(data) // Store for move modal
    const kvCacheMap: Record<number, number> = {}
    const memoryMap: Record<string, number> = {}

    for (const gpu of data.gpus) {
      // Use per-GPU kvcache if available, otherwise fall back to global
      const kvcacheTotal = gpu.kvcache?.total_gb ?? data.kvcache.total_gb
      kvCacheMap[gpu.gpu_index] = kvcacheTotal

      // Memory utilization per model instance (for live updates after sleep/wake)
      for (const model of gpu.models) {
        const utilization = gpu.total_gb > 0 ? model.gpu_memory_gb / gpu.total_gb : 0
        memoryMap[model.instance_id] = utilization
      }
    }

    setKvCacheTotalByGpu(kvCacheMap)
    setMemoryUtilizationByInstance(memoryMap)
  }, [])

  // Count running models for configuration save
  const runningModelCount = useMemo(
    () => models.filter((m) => m.status === 'running').length,
    [models]
  )

  const inferenceUrl = useMemo(() => `${window.location.origin}/v1`, [])

  // Get available GPUs from loaded models (for filtering)
  const availableGpusFromModels = useMemo(() => {
    const gpuSet = new Set<string>()
    models.forEach((model) => {
      gpuSet.add(getGpuGroupKey(model))
    })
    // Sort: gpu-0, gpu-1, ..., multi-gpu
    return Array.from(gpuSet).sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [models])

  // Get all available GPUs from hardware (includes empty GPUs for drag-drop targets)
  const allAvailableGpus = useMemo(() => {
    if (!gpuMemoryData?.gpus) {
      // Fall back to model-derived GPUs if no memory data yet
      return availableGpusFromModels
    }
    const gpuKeys = gpuMemoryData.gpus.map((gpu) => `gpu-${gpu.gpu_index}`)
    // Add multi-gpu if any models use multiple GPUs
    if (models.some((m) => m.gpu_ids.length > 1)) {
      gpuKeys.push('multi-gpu')
    }
    return gpuKeys.sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [gpuMemoryData, models, availableGpusFromModels])

  // Filter and sort models
  const filteredModels = useMemo(() => {
    return models
      .filter((model) => {
        // Status filter
        if (filters.status.length > 0 && !filters.status.includes(model.status)) {
          return false
        }
        // GPU assignment filter
        if (filters.gpuAssignment.length > 0) {
          const gpuKey = getGpuGroupKey(model)
          if (!filters.gpuAssignment.includes(gpuKey)) {
            return false
          }
        }
        // Search filter
        if (filters.searchTerm) {
          const term = filters.searchTerm.toLowerCase()
          return (
            model.model_path.toLowerCase().includes(term) ||
            model.model_name.toLowerCase().includes(term)
          )
        }
        return true
      })
      .sort((a, b) => {
        let comparison = 0
        switch (sortBy) {
          case 'name':
            comparison = a.model_path.localeCompare(b.model_path)
            break
          case 'startTime':
            comparison = (a.loaded_at || '').localeCompare(b.loaded_at || '')
            break
          case 'memoryUsage':
            comparison = a.gpu_memory_utilization - b.gpu_memory_utilization
            break
        }
        return sortDirection === 'asc' ? comparison : -comparison
      })
  }, [models, filters, sortBy, sortDirection])

  // Group models by GPU for card view
  const groupedModels = useMemo(() => {
    const groups: Record<string, ModelInstanceDTO[]> = {}

    filteredModels.forEach((model) => {
      const gpuKey = getGpuGroupKey(model)
      if (!groups[gpuKey]) {
        groups[gpuKey] = []
      }
      groups[gpuKey].push(model)
    })

    return groups
  }, [filteredModels])

  // Initialize expanded GPU groups when GPUs are available (only expand non-empty groups)
  useEffect(() => {
    if (allAvailableGpus.length > 0 && expandedGpuGroups.size === 0) {
      // Only expand groups that have models
      const nonEmptyGroups = allAvailableGpus.filter((gpuKey) => {
        const modelsInGroup = groupedModels[gpuKey]
        return modelsInGroup && modelsInGroup.length > 0
      })
      setExpandedGpuGroups(new Set(nonEmptyGroups))
    }
  }, [allAvailableGpus, expandedGpuGroups.size, groupedModels])

  // Auto-collapse empty groups and auto-expand groups that receive models
  useEffect(() => {
    setExpandedGpuGroups((prev) => {
      const next = new Set(prev)
      let changed = false

      // Collapse groups that became empty
      for (const gpuKey of prev) {
        const modelsInGroup = groupedModels[gpuKey]
        if (!modelsInGroup || modelsInGroup.length === 0) {
          next.delete(gpuKey)
          changed = true
        }
      }

      // Expand groups that have models but are not expanded
      for (const gpuKey of Object.keys(groupedModels)) {
        const modelsInGroup = groupedModels[gpuKey]
        if (modelsInGroup && modelsInGroup.length > 0 && !prev.has(gpuKey)) {
          next.add(gpuKey)
          changed = true
        }
      }

      return changed ? next : prev
    })
  }, [groupedModels])

  // Get ordered GPU keys for rendering (includes empty GPUs for drag-drop targets)
  const orderedGpuKeys = useMemo(() => {
    // Start with all available GPUs from hardware
    const keys = new Set(allAvailableGpus)
    // Add any additional keys from grouped models (e.g., multi-gpu)
    Object.keys(groupedModels).forEach((k) => keys.add(k))
    return Array.from(keys).sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [allAvailableGpus, groupedModels])

  const fetchModels = useCallback(async () => {
    try {
      const response = await apiClient.listModels()
      setModels(response.models)
    } catch (err) {
      addNotification({
        title: 'Error fetching models',
        description: err instanceof Error ? err.message : 'Failed to fetch models',
        variant: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }, [addNotification])

  useEffect(() => {
    fetchModels()

    // Auto-refresh every 5 seconds
    const interval = setInterval(fetchModels, 5000)
    return () => clearInterval(interval)
  }, [fetchModels])

  // Check if configuration loading is complete
  useEffect(() => {
    if (!configLoadingInfo) return

    // Count models that are running or failed
    const runningCount = models.filter((m) => m.status === 'running').length
    const failedCount = models.filter((m) => m.status === 'failed').length
    const terminalCount = runningCount + failedCount

    // Check if we've reached the expected count
    if (terminalCount >= configLoadingInfo.expectedModelCount) {
      // Clear timeout
      if (configLoadTimeoutRef.current) {
        clearTimeout(configLoadTimeoutRef.current)
        configLoadTimeoutRef.current = null
      }

      endOperation(configLoadingInfo.operationId)
      setConfigLoadingInfo(null)

      if (failedCount > 0) {
        addNotification({
          title: 'Configuration partially loaded',
          description: `${runningCount} models loaded, ${failedCount} failed`,
          variant: 'warning',
        })
      } else {
        addNotification({
          title: 'Configuration loaded',
          description: `${configLoadingInfo.configurationName} loaded successfully`,
          variant: 'success',
        })
      }
    }
  }, [models, configLoadingInfo, endOperation, addNotification])

  // Cleanup config loading timeout on unmount
  useEffect(() => {
    return () => {
      if (configLoadTimeoutRef.current) {
        clearTimeout(configLoadTimeoutRef.current)
      }
    }
  }, [])

  const handleLoadModel = async (request: LoadModelRequest) => {
    // Start the load and return instance_id for SSE subscription
    const result = await apiClient.loadModel(request)
    return { instance_id: result.instance_id }
  }

  const handleLoadSuccess = () => {
    fetchModels()
    triggerGpuRefresh()
    addNotification({
      title: 'Model loaded',
      description: 'Model is now ready for inference',
      variant: 'success',
    })
  }

  const handleUnloadModel = async (instanceId: string, modelPath: string, isFailed: boolean) => {
    setUnloadingInstanceId(instanceId)
    const opId = startOperation({
      type: 'unload',
      label: `Unloading ${modelPath}`,
      targetId: instanceId,
    })
    try {
      await apiClient.unloadModelByInstanceId(instanceId)
      addNotification({
        title: isFailed ? 'Model removed' : 'Model unloaded',
        description: isFailed
          ? `Successfully removed: ${modelPath}`
          : `Successfully unloaded: ${modelPath}`,
        variant: 'success',
      })
      await fetchModels()
      triggerGpuRefresh()
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
    const opId = startOperation({
      type: 'sleep',
      label: `Sleeping ${model.model_path}`,
      targetId: instanceId,
    })
    try {
      await apiClient.sleepModel(instanceId)
      addNotification({
        title: 'Model sleeping',
        description: `${model.model_path} has been put to sleep`,
        variant: 'success',
      })
      await fetchModels()
      triggerGpuRefresh()
    } catch (err) {
      addNotification({
        title: 'Failed to sleep model',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setSleepingInstanceId(null)
      endOperation(opId)
    }
  }

  const handleWakeModel = async (instanceId: string) => {
    const model = models.find((m) => m.id === instanceId)
    if (!model) return

    setWakingInstanceId(instanceId)
    const opId = startOperation({
      type: 'wake',
      label: `Waking ${model.model_path}`,
      targetId: instanceId,
    })
    try {
      await apiClient.wakeModel(instanceId)
      addNotification({
        title: 'Model woken up',
        description: `${model.model_path} is now ready for inference`,
        variant: 'success',
      })
      await fetchModels()
      triggerGpuRefresh()
    } catch (err) {
      addNotification({
        title: 'Failed to wake model',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setWakingInstanceId(null)
      endOperation(opId)
    }
  }

  const handleConfigSaved = () => {
    addNotification({
      title: 'Configuration saved',
      description: 'Model configuration saved successfully',
      variant: 'success',
    })
  }

  const handleConfigLoadStarted = (info: ConfigLoadStartedInfo) => {
    // Start the operation (will be ended when models are loaded)
    const opId = startOperation({
      type: 'load-config',
      label: `Loading configuration: ${info.configurationName}`,
    })

    setConfigLoadingInfo({
      operationId: opId,
      expectedModelCount: info.expectedModelCount,
      configurationName: info.configurationName,
    })

    addNotification({
      title: 'Loading configuration',
      description: info.message,
      variant: 'info',
    })

    // Set timeout (5 minutes) to prevent infinite loading state
    configLoadTimeoutRef.current = setTimeout(() => {
      setConfigLoadingInfo((current) => {
        if (current) {
          endOperation(current.operationId)
          addNotification({
            title: 'Configuration load timeout',
            description: 'Some models may not have loaded successfully',
            variant: 'warning',
          })
        }
        return null
      })
    }, 5 * 60 * 1000)

    // Trigger immediate refresh
    fetchModels()
    triggerGpuRefresh()
  }

  const handleUnloadAll = async () => {
    setIsUnloadingAll(true)
    const opId = startOperation({
      type: 'unload-all',
      label: `Unloading all models (${models.length})`,
    })
    try {
      for (const model of models) {
        try {
          await apiClient.unloadModelByInstanceId(model.id)
        } catch (err) {
          addNotification({
            title: 'Failed to unload model',
            description: `${model.model_path}: ${err instanceof Error ? err.message : 'Unknown error'}`,
            variant: 'warning',
          })
        }
      }
      addNotification({
        title: 'All models unloaded',
        description: 'Successfully unloaded all models',
        variant: 'success',
      })
      await fetchModels()
      triggerGpuRefresh()
    } catch (err) {
      addNotification({
        title: 'Error unloading models',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setIsUnloadingAll(false)
      setIsUnloadAllModalOpen(false)
      endOperation(opId)
    }
  }

  // Drag-and-drop handler
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return

    const model = active.data?.current?.model as ModelInstanceDTO | undefined
    if (!model) return

    // Extract target GPU from drop zone id (e.g., "gpu-drop-0" -> 0)
    const targetGpuId = over.data?.current?.gpuIndex as number | undefined
    if (targetGpuId === undefined || targetGpuId === -1) return

    // Don't open modal if dropping on same GPU
    if (model.gpu_ids.includes(targetGpuId)) return

    // Open move modal with preselected target GPU
    setMoveModalModel(model)
    setMoveTargetGpuIds([targetGpuId])
    setMoveModalOpen(true)
  }, [])

  // Move handlers (for menu item in ModelCardCompact)
  const handleMoveModel = useCallback((model: ModelInstanceDTO) => {
    setMoveModalModel(model)
    setMoveTargetGpuIds([])
    setMoveModalOpen(true)
  }, [])

  const handleMoveComplete = useCallback(() => {
    fetchModels()
    triggerGpuRefresh()
    setMoveModalOpen(false)
    setMoveModalModel(null)
    setMoveTargetGpuIds([])
  }, [fetchModels, triggerGpuRefresh])

  // Toolbar handlers
  const handleFiltersChange = (newFilters: FilterState) => {
    setFilters(newFilters)
  }

  const handleSortChange = (field: SortField, direction: SortDirection) => {
    setSortBy(field)
    setSortDirection(direction)
  }

  const handleClearAllFilters = () => {
    setFilters({
      status: [],
      gpuAssignment: [],
      searchTerm: '',
    })
  }

  // GPU group toggle
  const handleGpuGroupToggle = (gpuKey: string) => {
    setExpandedGpuGroups((prev) => {
      const next = new Set(prev)
      if (next.has(gpuKey)) {
        next.delete(gpuKey)
      } else {
        next.add(gpuKey)
      }
      return next
    })
  }

  // Card toggle
  const handleCardToggle = (instanceId: string) => {
    setExpandedCards((prev) => {
      const next = new Set(prev)
      if (next.has(instanceId)) {
        next.delete(instanceId)
      } else {
        next.add(instanceId)
      }
      return next
    })
  }

  // Handle click from GPU memory panel - scroll to model card
  const handleMemoryBarClick = useCallback(
    (instanceId: string) => {
      const model = models.find((m) => m.id === instanceId)
      if (!model) return

      const gpuKey = getGpuGroupKey(model)

      // Ensure GPU group is expanded
      setExpandedGpuGroups((prev) => new Set([...prev, gpuKey]))

      // Ensure card is expanded
      setExpandedCards((prev) => new Set([...prev, instanceId]))

      // Scroll to card after state updates
      requestAnimationFrame(() => {
        const cardElement = document.getElementById(`model-card-${instanceId}`)
        cardElement?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    },
    [models]
  )

  // Table sort handler
  const handleTableSort = (field: SortField) => {
    if (field === sortBy) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(field)
      setSortDirection('asc')
    }
  }

  if (loading) {
    return (
      <PageSection>
        <Flex justifyContent={{ default: 'justifyContentCenter' }}>
          <FlexItem>
            <Spinner size="xl" aria-label="Loading models" />
          </FlexItem>
        </Flex>
      </PageSection>
    )
  }

  return (
    <DndContext onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
      <PageSection>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Content component="h1">Model Placement Management</Content>
            <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              Inference URL:{' '}
              <ClipboardCopy
                isReadOnly
                hoverTip="Copy"
                clickTip="Copied"
                variant={ClipboardCopyVariant.inline}
              >
                {inferenceUrl}
              </ClipboardCopy>
            </span>
          </FlexItem>
          <FlexItem>
            <Flex gap={{ default: 'gapSm' }}>
              <FlexItem>
                <Button
                  variant="secondary"
                  icon={<SaveIcon />}
                  onClick={() => setIsSaveConfigOpen(true)}
                  isDisabled={runningModelCount === 0}
                >
                  Save Config
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="secondary"
                  icon={<UploadIcon />}
                  onClick={() => setIsLoadConfigOpen(true)}
                >
                  Load Config
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="secondary"
                  icon={<TrashIcon />}
                  onClick={() => setIsUnloadAllModalOpen(true)}
                  isDisabled={models.length === 0}
                >
                  Unload All
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="primary"
                  icon={<PlusCircleIcon />}
                  onClick={() => setIsLoadModalOpen(true)}
                >
                  Start Model
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>

        {/* GPU Memory Overview Panel */}
        <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
          <GpuMemoryPanel
            onModelClick={handleMemoryBarClick}
            refreshTrigger={gpuRefreshTrigger}
            onMemoryDataChange={handleMemoryDataChange}
          />
        </div>

        {models.length === 0 ? (
          <Card style={{ marginTop: 'var(--pf-t--global--spacer--xl)' }}>
            <CardBody>
              <EmptyState titleText="No models started" icon={CubesIcon}>
                <EmptyStateBody>Start a model to get started with inference.</EmptyStateBody>
                <EmptyStateFooter>
                  <EmptyStateActions>
                    <Button
                      variant="primary"
                      onClick={() => setIsLoadModalOpen(true)}
                      icon={<PlusCircleIcon />}
                    >
                      Start Model
                    </Button>
                  </EmptyStateActions>
                </EmptyStateFooter>
              </EmptyState>
            </CardBody>
          </Card>
        ) : (
          <>
            {/* Toolbar */}
            <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
              <ModelToolbar
                filters={filters}
                onFiltersChange={handleFiltersChange}
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSortChange={handleSortChange}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                availableGpus={allAvailableGpus}
                onClearAllFilters={handleClearAllFilters}
              />
            </div>

            {/* Model List/Table */}
            <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
              {filteredModels.length === 0 ? (
                <Card>
                  <CardBody>
                    <EmptyState titleText="No models match filters" icon={CubesIcon}>
                      <EmptyStateBody>Try adjusting your filters or search term.</EmptyStateBody>
                      <EmptyStateFooter>
                        <EmptyStateActions>
                          <Button variant="link" onClick={handleClearAllFilters}>
                            Clear all filters
                          </Button>
                        </EmptyStateActions>
                      </EmptyStateFooter>
                    </EmptyState>
                  </CardBody>
                </Card>
              ) : viewMode === 'card' ? (
                // Card View with GPU Groups
                <>
                  {orderedGpuKeys.map((gpuKey) => (
                    <GpuGroupSection
                      key={gpuKey}
                      gpuKey={gpuKey}
                      gpuLabel={formatGpuLabel(gpuKey)}
                      gpuIndex={gpuKey === 'multi-gpu' ? -1 : parseInt(gpuKey.replace('gpu-', ''), 10)}
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
                      kvCacheTotalByGpu={kvCacheTotalByGpu}
                      memoryUtilizationByInstance={memoryUtilizationByInstance}
                    />
                  ))}
                </>
              ) : (
                // Table View
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
              )}
            </div>
          </>
        )}
      </PageSection>

      <LoadModelDialog
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        onLoad={handleLoadModel}
        onSuccess={handleLoadSuccess}
      />

      <SaveConfigurationDialog
        isOpen={isSaveConfigOpen}
        onClose={() => setIsSaveConfigOpen(false)}
        onSuccess={handleConfigSaved}
        modelCount={runningModelCount}
      />

      <LoadConfigurationDialog
        isOpen={isLoadConfigOpen}
        onClose={() => setIsLoadConfigOpen(false)}
        onLoadStarted={handleConfigLoadStarted}
        currentModelCount={runningModelCount}
      />

      <Modal
        variant="small"
        isOpen={isUnloadAllModalOpen}
        onClose={() => setIsUnloadAllModalOpen(false)}
        aria-labelledby="unload-all-modal-title"
        aria-describedby="unload-all-modal-body"
      >
        <ModalHeader title="Unload All Models" labelId="unload-all-modal-title" />
        <ModalBody id="unload-all-modal-body">
          Are you sure you want to unload all {models.length} model{models.length !== 1 ? 's' : ''}?
          This will stop all inference services and free GPU memory.
        </ModalBody>
        <ModalFooter>
          <Button
            key="confirm"
            variant="danger"
            onClick={handleUnloadAll}
            isLoading={isUnloadingAll}
            isDisabled={isUnloadingAll}
          >
            {isUnloadingAll ? 'Unloading...' : 'Unload All'}
          </Button>
          <Button
            key="cancel"
            variant="link"
            onClick={() => setIsUnloadAllModalOpen(false)}
            isDisabled={isUnloadingAll}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>

      <MoveModelDialog
        isOpen={moveModalOpen}
        onClose={() => {
          setMoveModalOpen(false)
          setMoveModalModel(null)
          setMoveTargetGpuIds([])
        }}
        model={moveModalModel}
        preselectedGpuIds={moveTargetGpuIds}
        gpuMemoryData={gpuMemoryData}
        onMoveComplete={handleMoveComplete}
      />
    </DndContext>
  )
}

export default ModelManagement
