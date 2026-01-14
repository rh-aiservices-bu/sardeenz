import { useCallback, useEffect, useMemo, useState } from 'react'
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
import type { ModelInstanceDTO, LoadModelRequest } from '@sardeenz/types'
import {
  LoadModelDialog,
  GpuMemoryPanel,
  SaveConfigurationDialog,
  LoadConfigurationDialog,
  ModelToolbar,
  GpuGroupSection,
  ModelTable,
} from '../components'
import type { ViewMode, FilterState, SortField, SortDirection } from '../components'
import { useNotifications } from '../contexts/NotificationContext'

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
  const [isSaveConfigOpen, setIsSaveConfigOpen] = useState(false)
  const [isLoadConfigOpen, setIsLoadConfigOpen] = useState(false)
  const [isUnloadAllModalOpen, setIsUnloadAllModalOpen] = useState(false)
  const [isUnloadingAll, setIsUnloadingAll] = useState(false)

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

  const { addNotification } = useNotifications()

  // Count running models for configuration save
  const runningModelCount = useMemo(
    () => models.filter((m) => m.status === 'running').length,
    [models]
  )

  const inferenceUrl = useMemo(() => `${window.location.origin}/v1`, [])

  // Get available GPUs from loaded models
  const availableGpus = useMemo(() => {
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

  // Initialize expanded GPU groups when models load
  useEffect(() => {
    if (models.length > 0 && expandedGpuGroups.size === 0) {
      setExpandedGpuGroups(new Set(availableGpus))
    }
  }, [models, availableGpus, expandedGpuGroups.size])

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

  // Get ordered GPU keys for rendering
  const orderedGpuKeys = useMemo(() => {
    return Object.keys(groupedModels).sort((a, b) => {
      if (a === 'multi-gpu') return 1
      if (b === 'multi-gpu') return -1
      return a.localeCompare(b)
    })
  }, [groupedModels])

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

  const handleLoadModel = async (request: LoadModelRequest) => {
    // Start the load and return instance_id for SSE subscription
    const result = await apiClient.loadModel(request)
    return { instance_id: result.instance_id }
  }

  const handleLoadSuccess = () => {
    fetchModels()
    addNotification({
      title: 'Model loaded',
      description: 'Model is now ready for inference',
      variant: 'success',
    })
  }

  const handleUnloadModel = async (instanceId: string, modelPath: string, isFailed: boolean) => {
    setUnloadingInstanceId(instanceId)
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
    } catch (err) {
      addNotification({
        title: isFailed ? 'Failed to remove model' : 'Failed to unload model',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setUnloadingInstanceId(null)
    }
  }

  const handleConfigSaved = () => {
    addNotification({
      title: 'Configuration saved',
      description: 'Model configuration saved successfully',
      variant: 'success',
    })
  }

  const handleConfigLoadStarted = (message: string) => {
    addNotification({
      title: 'Loading configuration',
      description: message,
      variant: 'info',
    })
    setTimeout(fetchModels, 2000)
  }

  const handleUnloadAll = async () => {
    setIsUnloadingAll(true)
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
    } catch (err) {
      addNotification({
        title: 'Error unloading models',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setIsUnloadingAll(false)
      setIsUnloadAllModalOpen(false)
    }
  }

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
    <>
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
          <GpuMemoryPanel onModelClick={handleMemoryBarClick} />
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
                availableGpus={availableGpus}
                onClearAllFilters={handleClearAllFilters}
              />
            </div>

            {/* Model List/Table */}
            <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
              {filteredModels.length === 0 ? (
                <Card>
                  <CardBody>
                    <EmptyState titleText="No models match filters" icon={CubesIcon}>
                      <EmptyStateBody>
                        Try adjusting your filters or search term.
                      </EmptyStateBody>
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
                      models={groupedModels[gpuKey]}
                      isExpanded={expandedGpuGroups.has(gpuKey)}
                      onToggle={handleGpuGroupToggle}
                      onUnload={handleUnloadModel}
                      unloadingInstanceId={unloadingInstanceId}
                      expandedCards={expandedCards}
                      onCardToggle={handleCardToggle}
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
                  unloadingInstanceId={unloadingInstanceId}
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
    </>
  )
}

export default ModelManagement
