import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragEndEvent, pointerWithin } from '@dnd-kit/core'
import {
  PageSection,
  Content,
  Button,
  Spinner,
  Flex,
  FlexItem,
  ClipboardCopy,
  ClipboardCopyVariant,
  Card,
  CardHeader,
  CardBody,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core'
import { PlusCircleIcon, SaveIcon, UploadIcon, TrashIcon, ColumnsIcon } from '@patternfly/react-icons'
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
  ClusterOverview,
  PodSelector,
  NodeModelPane,
} from '../components'
import type { ConfigLoadStartedInfo, NodeModelPaneHandle } from '../components'
import { useNotifications } from '../contexts/NotificationContext'
import { useOperations } from '../contexts/OperationsContext'
import { useClusterStatus } from '../hooks/useClusterStatus'

function ModelManagement() {
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)
  const [isSaveConfigOpen, setIsSaveConfigOpen] = useState(false)
  const [isLoadConfigOpen, setIsLoadConfigOpen] = useState(false)
  const [isUnloadAllModalOpen, setIsUnloadAllModalOpen] = useState(false)
  const [isUnloadingAll, setIsUnloadingAll] = useState(false)
  const [gpuRefreshTrigger, setGpuRefreshTrigger] = useState(0)
  const [kvCacheTotalByGpu, setKvCacheTotalByGpu] = useState<Record<number, number>>({})
  const [memoryUtilizationByInstance, setMemoryUtilizationByInstance] = useState<Record<string, number>>({})
  const [gpuMemoryData, setGpuMemoryData] = useState<MultiGpuMemoryUsageResponse | null>(null)

  // Local models for header counts and unload-all
  const [localModels, setLocalModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)

  // Configuration loading tracking
  const [configLoadingInfo, setConfigLoadingInfo] = useState<{
    operationId: string
    expectedModelCount: number
    configurationName: string
  } | null>(null)
  const configLoadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cluster pod IDs for GPU memory panel
  const [clusterPodIds, setClusterPodIds] = useState<string[]>([])

  // Pane refs for cross-pane drag-and-drop
  const leftPaneRef = useRef<NodeModelPaneHandle>(null)
  const rightPaneRef = useRef<NodeModelPaneHandle>(null)
  const singlePaneRef = useRef<NodeModelPaneHandle>(null)

  // Node selector and split view state
  const [selectedPodId, setSelectedPodId] = useState<string | undefined>(undefined)
  const [splitViewActive, setSplitViewActive] = useState(false)
  const [splitRightPodId, setSplitRightPodId] = useState<string | undefined>(undefined)

  const { addNotification } = useNotifications()
  const { startOperation, endOperation } = useOperations()
  const clusterData = useClusterStatus({
    onLeaderChange: useCallback((leaderId: string, leaderAddress: string | null) => {
      addNotification({
        title: 'Cluster leader changed',
        description: leaderAddress
          ? `New leader: ${leaderId}. Redirecting to ${leaderAddress}...`
          : `New leader: ${leaderId}. Waiting for leader address...`,
        variant: 'info',
      })
    }, [addNotification]),
  })

  // Initialize selected pod to local pod
  useEffect(() => {
    if (clusterData.isClusterMode && clusterData.clusterStatus?.localPodId && !selectedPodId) {
      setSelectedPodId(clusterData.clusterStatus.localPodId)
    }
  }, [clusterData.isClusterMode, clusterData.clusterStatus?.localPodId, selectedPodId])

  // Initialize split right pod to a different pod if available
  useEffect(() => {
    if (splitViewActive && !splitRightPodId && clusterPodIds.length > 1) {
      const otherPod = clusterPodIds.find((id) => id !== selectedPodId)
      if (otherPod) setSplitRightPodId(otherPod)
    }
  }, [splitViewActive, splitRightPodId, clusterPodIds, selectedPodId])

  // Fetch cluster pod IDs
  useEffect(() => {
    if (!clusterData.isClusterMode) return
    apiClient.getClusterPods().then((res) => {
      setClusterPodIds(res.pods.map((p) => p.podId))
    }).catch(() => { })
  }, [clusterData.isClusterMode, clusterData.clusterStatus?.podCount])

  const triggerGpuRefresh = useCallback(() => {
    setGpuRefreshTrigger((prev) => prev + 1)
  }, [])

  const handleMemoryDataChange = useCallback((data: MultiGpuMemoryUsageResponse) => {
    setGpuMemoryData(data)
    const kvCacheMap: Record<number, number> = {}
    const memoryMap: Record<string, number> = {}
    for (const gpu of data.gpus) {
      const kvcacheTotal = gpu.kvcache?.total_gb ?? data.kvcache.total_gb
      kvCacheMap[gpu.gpu_index] = kvcacheTotal
      for (const model of gpu.models) {
        const utilization = gpu.total_gb > 0 ? model.gpu_memory_gb / gpu.total_gb : 0
        memoryMap[model.instance_id] = utilization
      }
    }
    setKvCacheTotalByGpu(kvCacheMap)
    setMemoryUtilizationByInstance(memoryMap)
  }, [])

  // Fetch local models (for header counts, config tracking, unload-all)
  const fetchLocalModels = useCallback(async () => {
    try {
      const response = await apiClient.listModels()
      setLocalModels(response.models)
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
    fetchLocalModels()
    const interval = setInterval(fetchLocalModels, 5000)
    return () => clearInterval(interval)
  }, [fetchLocalModels])

  // Config loading tracking
  useEffect(() => {
    if (!configLoadingInfo) return
    const failedCount = localModels.filter((m) => m.status === 'failed').length
    // In cluster mode use the cluster-wide running count; localModels only covers the local pod.
    const runningCount = clusterData.isClusterMode
      ? (clusterData.clusterStatus?.totalModelsLoaded ?? 0)
      : localModels.filter((m) => m.status === 'running').length
    const terminalCount = runningCount + failedCount

    if (terminalCount >= configLoadingInfo.expectedModelCount) {
      if (configLoadTimeoutRef.current) {
        clearTimeout(configLoadTimeoutRef.current)
        configLoadTimeoutRef.current = null
      }
      endOperation(configLoadingInfo.operationId)
      setConfigLoadingInfo(null)
      if (failedCount > 0) {
        addNotification({ title: 'Configuration partially loaded', description: `${runningCount} models loaded, ${failedCount} failed`, variant: 'warning' })
      } else {
        addNotification({ title: 'Configuration loaded', description: `${configLoadingInfo.configurationName} loaded successfully`, variant: 'success' })
      }
    }
  }, [localModels, configLoadingInfo, endOperation, addNotification, clusterData.isClusterMode, clusterData.clusterStatus?.totalModelsLoaded])

  useEffect(() => {
    return () => {
      if (configLoadTimeoutRef.current) clearTimeout(configLoadTimeoutRef.current)
    }
  }, [])

  const runningModelCount = useMemo(
    () => localModels.filter((m) => m.status === 'running').length,
    [localModels]
  )

  // Cluster-wide total (used for header button states and Save Config dialog count)
  const totalModelCount = useMemo(
    () => clusterData.isClusterMode
      ? (clusterData.clusterStatus?.totalModelsLoaded ?? runningModelCount)
      : runningModelCount,
    [clusterData.isClusterMode, clusterData.clusterStatus?.totalModelsLoaded, runningModelCount]
  )

  const inferenceUrl = useMemo(() => `${window.location.origin}/v1`, [])

  const isLocalPod = useMemo(() => {
    if (!clusterData.isClusterMode) return true
    return selectedPodId === clusterData.clusterStatus?.localPodId
  }, [clusterData.isClusterMode, clusterData.clusterStatus?.localPodId, selectedPodId])

  const isRightLocalPod = useMemo(() => {
    if (!clusterData.isClusterMode) return true
    return splitRightPodId === clusterData.clusterStatus?.localPodId
  }, [clusterData.isClusterMode, clusterData.clusterStatus?.localPodId, splitRightPodId])

  // Effective pod ID (for single-pod mode, use a stable value)
  const effectivePodId = clusterData.isClusterMode
    ? selectedPodId || clusterData.clusterStatus?.localPodId || 'local'
    : 'local'

  const handleLoadModel = async (request: LoadModelRequest) => {
    const result = await apiClient.loadModel(request)
    return { instance_id: result.instance_id }
  }

  const handleLoadSuccess = () => {
    fetchLocalModels()
    triggerGpuRefresh()
    addNotification({ title: 'Model loaded', description: 'Model is now ready for inference', variant: 'success' })
  }

  const handleConfigSaved = () => {
    addNotification({ title: 'Configuration saved', description: 'Model configuration saved successfully', variant: 'success' })
  }

  const handleConfigLoadStarted = (info: ConfigLoadStartedInfo) => {
    const opId = startOperation({ type: 'load-config', label: `Loading configuration: ${info.configurationName}` })
    setConfigLoadingInfo({ operationId: opId, expectedModelCount: info.expectedModelCount, configurationName: info.configurationName })
    addNotification({ title: 'Loading configuration', description: info.message, variant: 'info' })
    if (info.skippedPods && info.skippedPods.length > 0) {
      addNotification({
        title: 'Some pods unavailable',
        description: `Models for the following pods were skipped: ${info.skippedPods.join(', ')}`,
        variant: 'warning',
      })
    }
    configLoadTimeoutRef.current = setTimeout(() => {
      setConfigLoadingInfo((current) => {
        if (current) {
          endOperation(current.operationId)
          addNotification({ title: 'Configuration load timeout', description: 'Some models may not have loaded successfully', variant: 'warning' })
        }
        return null
      })
    }, 5 * 60 * 1000)
    fetchLocalModels()
    triggerGpuRefresh()
  }

  const handleUnloadAll = async () => {
    setIsUnloadingAll(true)
    try {
      if (clusterData.isClusterMode && clusterPodIds.length > 0) {
        const allModels: ModelInstanceDTO[] = []
        for (const podId of clusterPodIds) {
          try {
            const res = await apiClient.getClusterPodModelsFull(podId)
            allModels.push(...res.models)
          } catch (err) {
            addNotification({
              title: `Failed to list models on pod ${podId}`,
              description: err instanceof Error ? err.message : 'Unknown error',
              variant: 'warning',
            })
          }
        }
        const opId = startOperation({ type: 'unload-all', label: `Unloading all models (${allModels.length}) across ${clusterPodIds.length} pods` })
        try {
          for (const model of allModels) {
            try {
              await apiClient.clusterUnloadModel(model.id)
            } catch (err) {
              addNotification({
                title: 'Failed to unload model',
                description: `${model.model_path}: ${err instanceof Error ? err.message : 'Unknown error'}`,
                variant: 'warning',
              })
            }
          }
          addNotification({ title: 'All models unloaded', description: `Successfully unloaded all models across all pods`, variant: 'success' })
          await fetchLocalModels()
          triggerGpuRefresh()
        } finally {
          endOperation(opId)
        }
      } else {
        const opId = startOperation({ type: 'unload-all', label: `Unloading all models (${localModels.length})` })
        try {
          for (const model of localModels) {
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
          addNotification({ title: 'All models unloaded', description: 'Successfully unloaded all models', variant: 'success' })
          await fetchLocalModels()
          triggerGpuRefresh()
        } catch (err) {
          addNotification({ title: 'Error unloading models', description: err instanceof Error ? err.message : 'Unknown error', variant: 'danger' })
        } finally {
          endOperation(opId)
        }
      }
    } finally {
      setIsUnloadingAll(false)
      setIsUnloadAllModalOpen(false)
    }
  }

  // Drag-and-drop: route to the correct pane based on drop target's podId
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over) return
    const model = active.data?.current?.model as ModelInstanceDTO | undefined
    if (!model) return
    const targetGpuId = over.data?.current?.gpuIndex as number | undefined
    const targetPodId = over.data?.current?.podId as string | undefined
    const sourcePodId = active.data?.current?.sourcePodId as string | undefined
    if (targetGpuId === undefined || targetGpuId === -1) return
    if (model.gpu_ids.includes(targetGpuId) && (!sourcePodId || !targetPodId || sourcePodId === targetPodId)) return

    if (splitViewActive) {
      if (targetPodId === selectedPodId) {
        leftPaneRef.current?.openMoveDialog(model, [targetGpuId], targetPodId, sourcePodId)
      } else if (targetPodId === splitRightPodId) {
        rightPaneRef.current?.openMoveDialog(model, [targetGpuId], targetPodId, sourcePodId)
      }
    } else {
      singlePaneRef.current?.openMoveDialog(model, [targetGpuId], targetPodId, sourcePodId)
    }
  }, [splitViewActive, selectedPodId, splitRightPodId])

  const handleMemoryBarClick = useCallback(
    (instanceId: string, podId?: string) => {
      // Switch left/main panel to the pod hosting this model
      if (podId && podId !== selectedPodId) {
        setSelectedPodId(podId)
      }

      // Retry scrolling until the model card exists in the DOM (pod switch triggers re-render + fetch)
      let attempts = 0
      const tryScroll = () => {
        const el = document.getElementById(`model-card-${instanceId}`)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else if (attempts < 20) {
          attempts++
          setTimeout(tryScroll, 150)
        }
      }
      requestAnimationFrame(tryScroll)
    },
    [selectedPodId]
  )

  if (loading) {
    return (
      <PageSection>
        <Flex justifyContent={{ default: 'justifyContentCenter' }}>
          <FlexItem><Spinner size="xl" aria-label="Loading models" /></FlexItem>
        </Flex>
      </PageSection>
    )
  }

  return (
    <DndContext onDragEnd={handleDragEnd} collisionDetection={pointerWithin}>
      {/* Sticky header */}
      <PageSection stickyOnBreakpoint={{ default: 'top' }} hasShadowBottom>
        <Content component="h1">Model Management</Content>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }} spaceItems={{ default: 'spaceItemsSm' }}>
              <FlexItem>
                <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>Inference URL:</span>
              </FlexItem>
              <FlexItem>
                <ClipboardCopy isReadOnly hoverTip="Copy" clickTip="Copied" variant={ClipboardCopyVariant.inline}>
                  {inferenceUrl}
                </ClipboardCopy>
              </FlexItem>
            </Flex>
          </FlexItem>
          <FlexItem>
            <Flex gap={{ default: 'gapSm' }}>
              <FlexItem>
                <Button variant="secondary" icon={<SaveIcon />} onClick={() => setIsSaveConfigOpen(true)} isDisabled={totalModelCount === 0}>
                  Save Config
                </Button>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" icon={<UploadIcon />} onClick={() => setIsLoadConfigOpen(true)}>
                  Load Config
                </Button>
              </FlexItem>
              <FlexItem>
                <Button variant="secondary" icon={<TrashIcon />} onClick={() => setIsUnloadAllModalOpen(true)} isDisabled={totalModelCount === 0}>
                  Unload All
                </Button>
              </FlexItem>
              <FlexItem>
                <Button variant="primary" icon={<PlusCircleIcon />} onClick={() => setIsLoadModalOpen(true)}>
                  Start Model
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      {/* Scrollable content */}
      <PageSection>
        {/* Cluster Overview */}
        {clusterData.isClusterMode && (
          <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
            <ClusterOverview clusterData={clusterData} />
          </div>
        )}

        {/* GPU Memory Overview */}
        <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
          <GpuMemoryPanel
            onModelClick={handleMemoryBarClick}
            refreshTrigger={gpuRefreshTrigger}
            onMemoryDataChange={handleMemoryDataChange}
            localPodId={clusterData.isClusterMode ? clusterData.clusterStatus?.localPodId : null}
            clusterPodIds={clusterData.isClusterMode ? clusterPodIds : undefined}
          />
        </div>

        {/* Model Management card */}
        <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
          <Card>
            <CardHeader>
              <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
                <FlexItem>
                  <Content component="h2">Model Management</Content>
                </FlexItem>
                <FlexItem>
                  {clusterData.isClusterMode && clusterPodIds.length > 1 && (
                    <FlexItem>
                      <ToggleGroup aria-label="Split view toggle">
                        <ToggleGroupItem
                          icon={<ColumnsIcon />}
                          text="Split View"
                          isSelected={splitViewActive}
                          onChange={() => setSplitViewActive(!splitViewActive)}
                          aria-label="Toggle split view"
                        />
                      </ToggleGroup>
                    </FlexItem>
                  )}
                </FlexItem>
              </Flex>
            </CardHeader>
            <CardBody>
              {clusterData.isClusterMode && splitViewActive && clusterPodIds.length > 1 ? (
                // Split view: two panes side by side, each with its own pod selector
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 'var(--pf-t--global--spacer--lg)', alignItems: 'stretch' }}>
                  <div>
                    <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
                      <PodSelector
                        selectedPodId={selectedPodId}
                        onSelect={setSelectedPodId}
                        isClusterMode={clusterData.isClusterMode}
                        label="Left node"
                      />
                    </div>
                    <NodeModelPane
                      ref={leftPaneRef}
                      podId={effectivePodId}
                      isLocalPod={isLocalPod}
                      isClusterMode={clusterData.isClusterMode}
                      gpuMemoryData={isLocalPod ? gpuMemoryData : null}
                      kvCacheTotalByGpu={isLocalPod ? kvCacheTotalByGpu : {}}
                      memoryUtilizationByInstance={isLocalPod ? memoryUtilizationByInstance : {}}
                      onGpuRefresh={triggerGpuRefresh}
                      onModelsChanged={fetchLocalModels}
                      isSplitView
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '1px', height: '100%', backgroundColor: 'var(--pf-t--global--border--color--default)' }} />
                  </div>
                  <div>
                    <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
                      <PodSelector
                        selectedPodId={splitRightPodId}
                        onSelect={setSplitRightPodId}
                        isClusterMode={clusterData.isClusterMode}
                        label="Right node"
                      />
                    </div>
                    {splitRightPodId && (
                      <NodeModelPane
                        ref={rightPaneRef}
                        podId={splitRightPodId}
                        isLocalPod={isRightLocalPod}
                        isClusterMode={clusterData.isClusterMode}
                        gpuMemoryData={isRightLocalPod ? gpuMemoryData : null}
                        kvCacheTotalByGpu={isRightLocalPod ? kvCacheTotalByGpu : {}}
                        memoryUtilizationByInstance={isRightLocalPod ? memoryUtilizationByInstance : {}}
                        onGpuRefresh={triggerGpuRefresh}
                        onModelsChanged={fetchLocalModels}
                        isSplitView
                      />
                    )}
                  </div>
                </div>
              ) : (
                // Single pane view, with pod selector when in cluster mode
                <div>
                  {clusterData.isClusterMode && (
                    <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
                      <PodSelector
                        selectedPodId={selectedPodId}
                        onSelect={setSelectedPodId}
                        isClusterMode={clusterData.isClusterMode}
                        label="Select node"
                      />
                    </div>
                  )}
                  <NodeModelPane
                    ref={singlePaneRef}
                    podId={effectivePodId}
                    isLocalPod={isLocalPod}
                    isClusterMode={clusterData.isClusterMode}
                    gpuMemoryData={isLocalPod ? gpuMemoryData : null}
                    kvCacheTotalByGpu={isLocalPod ? kvCacheTotalByGpu : {}}
                    memoryUtilizationByInstance={isLocalPod ? memoryUtilizationByInstance : {}}
                    onGpuRefresh={triggerGpuRefresh}
                    onModelsChanged={fetchLocalModels}
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </PageSection>

      <LoadModelDialog
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        onLoad={handleLoadModel}
        onSuccess={handleLoadSuccess}
        isClusterMode={clusterData.isClusterMode}
      />

      <SaveConfigurationDialog
        isOpen={isSaveConfigOpen}
        onClose={() => setIsSaveConfigOpen(false)}
        onSuccess={handleConfigSaved}
        modelCount={totalModelCount}
        isClusterMode={clusterData.isClusterMode}
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
          {clusterData.isClusterMode
            ? `Are you sure you want to unload all models across all ${clusterPodIds.length} pod${clusterPodIds.length !== 1 ? 's' : ''}? This will stop all inference services and free GPU memory on every node.`
            : `Are you sure you want to unload all ${localModels.length} model${localModels.length !== 1 ? 's' : ''}? This will stop all inference services and free GPU memory.`}
        </ModalBody>
        <ModalFooter>
          <Button key="confirm" variant="danger" onClick={handleUnloadAll} isLoading={isUnloadingAll} isDisabled={isUnloadingAll}>
            {isUnloadingAll ? 'Unloading...' : 'Unload All'}
          </Button>
          <Button key="cancel" variant="link" onClick={() => setIsUnloadAllModalOpen(false)} isDisabled={isUnloadingAll}>
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </DndContext>
  )
}

export default ModelManagement
