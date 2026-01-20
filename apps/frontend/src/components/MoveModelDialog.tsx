import { useState, useEffect } from 'react'
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  NumberInput,
  Alert,
  Progress,
  ProgressVariant,
  ProgressMeasureLocation,
  HelperText,
  HelperTextItem,
  Flex,
  FlexItem,
  Label,
  Checkbox,
  Spinner,
} from '@patternfly/react-core'
import type { ModelInstanceDTO, MultiGpuMemoryUsageResponse, PerGpuMetrics } from '@sardeenz/types'
import { apiClient } from '../services/api'
import { useMoveEvents } from '../hooks/useMoveEvents'
import { useNotifications } from '../contexts/NotificationContext'

interface MoveModelDialogProps {
  isOpen: boolean
  onClose: () => void
  model: ModelInstanceDTO | null
  preselectedGpuIds?: number[]
  gpuMemoryData: MultiGpuMemoryUsageResponse | null
  onMoveComplete?: () => void
}

export function MoveModelDialog({
  isOpen,
  onClose,
  model,
  preselectedGpuIds,
  gpuMemoryData,
  onMoveComplete,
}: MoveModelDialogProps) {
  const { addNotification } = useNotifications()
  const [selectedGpuIds, setSelectedGpuIds] = useState<number[]>([])
  const [drainTimeoutSeconds, setDrainTimeoutSeconds] = useState(60)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [moveId, setMoveId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Fresh model data fetched when modal opens
  const [freshModel, setFreshModel] = useState<ModelInstanceDTO | null>(null)
  const [isLoadingModel, setIsLoadingModel] = useState(false)

  // Subscribe to move progress events
  const {
    currentPhase,
    progress,
    message,
    error: moveError,
  } = useMoveEvents({
    moveId,
    onComplete: (event) => {
      if (event.phase === 'completed') {
        addNotification({
          title: 'Model moved successfully',
          description: `${model?.model_name} moved to GPU ${selectedGpuIds.join(', ')}`,
          variant: 'success',
        })
        onMoveComplete?.()
        // Clear state and close - setMoveId(null) triggers SSE cleanup
        setIsSubmitting(false)
        setMoveId(null)
        onClose()
      } else if (event.phase === 'failed') {
        addNotification({
          title: 'Move failed',
          description: event.error || event.message,
          variant: 'danger',
        })
        setIsSubmitting(false)
        setMoveId(null)
      }
    },
  })

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (isOpen && model) {
      // If preselected GPUs provided (from drag-drop), use them
      // Otherwise default to empty
      setSelectedGpuIds(preselectedGpuIds || [])
      setDrainTimeoutSeconds(60)
      setSubmitError(null)
      setMoveId(null)
      setIsSubmitting(false)
    }
  }, [isOpen, model, preselectedGpuIds])

  // Fetch fresh model data when dialog opens to get accurate memory metrics
  useEffect(() => {
    if (isOpen && model) {
      setIsLoadingModel(true)
      apiClient
        .listModels()
        .then((response) => {
          // Find the model by ID in the list
          const found = response.models.find((m) => m.id === model.id)
          setFreshModel(found ?? null)
        })
        .catch((err) => console.error('Failed to fetch fresh model data:', err))
        .finally(() => setIsLoadingModel(false))
    } else {
      setFreshModel(null)
    }
  }, [isOpen, model])

  // Use fresh model data if available, otherwise fall back to prop
  const currentModel = freshModel ?? model

  const handleClose = () => {
    // Always clear moveId to trigger SSE cleanup
    setMoveId(null)
    // Only close dialog if not in the middle of submitting
    if (!isSubmitting) {
      onClose()
    }
  }

  const handleSubmit = async () => {
    if (!model || selectedGpuIds.length === 0) return

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await apiClient.moveModel(model.id, {
        target_gpu_ids: selectedGpuIds,
        drain_timeout_ms: drainTimeoutSeconds * 1000,
      })
      setMoveId(response.move_id)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initiate move'
      setSubmitError(message)
      setIsSubmitting(false)
    }
  }

  const handleGpuToggle = (gpuId: number) => {
    if (currentModel?.tensor_parallel_size === 1) {
      // Single GPU: radio behavior
      setSelectedGpuIds([gpuId])
    } else {
      // Tensor parallel: checkbox behavior
      setSelectedGpuIds((prev) =>
        prev.includes(gpuId) ? prev.filter((id) => id !== gpuId) : [...prev, gpuId]
      )
    }
  }

  // Calculate required memory based on source model
  // Priority: 1) Live GPU memory from gpuMemoryData, 2) memory_metrics, 3) memory_baseline_by_gpu
  const requiredMemoryGb = (() => {
    // First, try to get live memory from gpuMemoryData (most accurate)
    if (gpuMemoryData && currentModel) {
      let totalMemory = 0
      for (const gpu of gpuMemoryData.gpus) {
        for (const modelMemory of gpu.models) {
          if (modelMemory.instance_id === currentModel.id) {
            totalMemory += modelMemory.gpu_memory_gb
          }
        }
      }
      if (totalMemory > 0) {
        return totalMemory
      }
    }

    // Fallback to memory_metrics from model instance
    if (currentModel?.memory_metrics?.total_gpu_memory_gib) {
      return currentModel.memory_metrics.total_gpu_memory_gib
    }

    // Fallback to memory_baseline_by_gpu
    if (
      currentModel?.memory_baseline_by_gpu &&
      Object.keys(currentModel.memory_baseline_by_gpu).length > 0
    ) {
      return Math.max(...Object.values(currentModel.memory_baseline_by_gpu))
    }

    return null
  })()

  // Check if a GPU has sufficient free memory
  // In virtual GPU mode, all vGPUs share the same physical memory, so when moving
  // the source model's memory will be freed. We add back the required memory since
  // moving doesn't duplicate the model.
  const hasEnoughMemory = (gpu: PerGpuMetrics) => {
    // If memory is unknown, allow selection (we can't determine if it fits)
    if (requiredMemoryGb === null) return true

    if (gpuMemoryData?.is_virtual_gpu_mode) {
      // In vGPU mode: effective free = current free + model's memory (will be freed)
      const effectiveFreeGb = gpu.free_gb + requiredMemoryGb
      return effectiveFreeGb >= requiredMemoryGb
    }
    return gpu.free_gb >= requiredMemoryGb
  }

  // Check if GPU is source GPU (can't move to same GPU)
  const isSourceGpu = (gpuIndex: number) => currentModel?.gpu_ids.includes(gpuIndex) ?? false

  // Validate selection
  const isValidSelection =
    selectedGpuIds.length === (currentModel?.tensor_parallel_size ?? 1) &&
    !selectedGpuIds.some(isSourceGpu)

  const isMoving = moveId !== null

  return (
    <Modal variant={ModalVariant.medium} isOpen={isOpen} onClose={handleClose}>
      <ModalHeader
        title={`Move Model: ${currentModel?.model_name || ''}`}
        description={isMoving ? undefined : 'Select target GPU(s) for the model'}
      />
      <ModalBody>
        {isMoving ? (
          // Show progress during move
          <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
            <FlexItem>
              <Progress
                value={progress}
                title={message || `Phase: ${currentPhase}`}
                measureLocation={ProgressMeasureLocation.outside}
                variant={
                  currentPhase === 'failed'
                    ? ProgressVariant.danger
                    : currentPhase === 'completed'
                      ? ProgressVariant.success
                      : undefined
                }
              />
            </FlexItem>
            {moveError && (
              <FlexItem>
                <Alert variant="danger" isInline title="Error">
                  {moveError}
                </Alert>
              </FlexItem>
            )}
          </Flex>
        ) : (
          // Show GPU selection form
          <Form>
            {submitError && (
              <Alert
                variant="danger"
                isInline
                title="Error"
                style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
              >
                {submitError}
              </Alert>
            )}

            <FormGroup label="Current GPU(s)" fieldId="current-gpu">
              <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                {currentModel?.gpu_ids.map((gpuId) => (
                  <FlexItem key={gpuId}>
                    <Label color="blue">GPU {gpuId}</Label>
                  </FlexItem>
                ))}
              </Flex>
            </FormGroup>

            <FormGroup label="Target GPU(s)" fieldId="target-gpu" isRequired>
              <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsSm' }}>
                {gpuMemoryData?.gpus.map((gpu) => {
                  const isSource = isSourceGpu(gpu.gpu_index)
                  const hasMemory = hasEnoughMemory(gpu)
                  const isDisabled = isSource || !hasMemory
                  const isSelected = selectedGpuIds.includes(gpu.gpu_index)

                  return (
                    <FlexItem key={gpu.gpu_index}>
                      <Checkbox
                        id={`gpu-${gpu.gpu_index}`}
                        label={
                          <Flex
                            spaceItems={{ default: 'spaceItemsSm' }}
                            alignItems={{ default: 'alignItemsCenter' }}
                          >
                            <FlexItem>
                              GPU {gpu.gpu_index}: {gpu.name}
                            </FlexItem>
                            <FlexItem>
                              <Label color={hasMemory ? 'green' : 'orange'} isCompact>
                                {gpu.free_gb.toFixed(1)} GB free
                              </Label>
                            </FlexItem>
                            {isSource && (
                              <FlexItem>
                                <Label color="grey" isCompact>
                                  Current
                                </Label>
                              </FlexItem>
                            )}
                          </Flex>
                        }
                        isChecked={isSelected}
                        onChange={() => handleGpuToggle(gpu.gpu_index)}
                        isDisabled={isDisabled}
                      />
                      {!hasMemory && !isSource && requiredMemoryGb !== null && (
                        <HelperText>
                          <HelperTextItem variant="warning">
                            Needs {requiredMemoryGb.toFixed(1)} GB, only {gpu.free_gb.toFixed(1)} GB
                            free
                          </HelperTextItem>
                        </HelperText>
                      )}
                    </FlexItem>
                  )
                })}
              </Flex>
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {currentModel?.tensor_parallel_size && currentModel.tensor_parallel_size > 1
                      ? `Select ${currentModel.tensor_parallel_size} GPUs for tensor parallel`
                      : 'Select a different GPU'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>

            <FormGroup label="Drain timeout" fieldId="drain-timeout">
              <NumberInput
                id="drain-timeout"
                value={drainTimeoutSeconds}
                min={10}
                max={300}
                onMinus={() => setDrainTimeoutSeconds(Math.max(10, drainTimeoutSeconds - 10))}
                onPlus={() => setDrainTimeoutSeconds(Math.min(300, drainTimeoutSeconds + 10))}
                onChange={(event) => {
                  const value = parseInt((event.target as HTMLInputElement).value, 10)
                  if (!isNaN(value)) {
                    setDrainTimeoutSeconds(Math.max(10, Math.min(300, value)))
                  }
                }}
                unit="seconds"
                unitPosition="after"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    Time to wait for active requests to complete before force-switching
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>

            <FormGroup label="Estimated memory required" fieldId="memory-estimate">
              {isLoadingModel ? (
                <Spinner size="md" />
              ) : requiredMemoryGb !== null ? (
                <Label color="blue">{requiredMemoryGb.toFixed(1)} GB</Label>
              ) : (
                <Label color="orange">Unknown</Label>
              )}
            </FormGroup>
          </Form>
        )}
      </ModalBody>
      <ModalFooter>
        {isMoving ? (
          <Button variant="secondary" onClick={handleClose} isDisabled={currentPhase !== 'failed'}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              isDisabled={!isValidSelection || isSubmitting}
              isLoading={isSubmitting}
            >
              Move
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  )
}
