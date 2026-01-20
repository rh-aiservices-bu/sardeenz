import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Form,
  FormGroup,
  TextInput,
  TextArea,
  NumberInput,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Alert,
  Progress,
  ProgressMeasureLocation,
  Radio,
  Checkbox,
  Flex,
  FlexItem,
  Spinner,
  Breadcrumb,
  BreadcrumbItem,
} from '@patternfly/react-core'
import type {
  LoadModelRequest,
  ModelStatus,
  GpuAvailabilityResponse,
  LocalModelInfo,
  ModelSourceType,
} from '@sardeenz/types'
import { useInstanceEvents } from '../hooks/useInstanceEvents'
import { LogViewer } from './LogViewer'
import { apiClient, type MemoryCheckResponse } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

/** Dialog phase state machine */
type DialogPhase = 'form' | 'loading' | 'success' | 'failed'

interface LoadModelDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Callback when dialog should close */
  onClose: () => void
  /** Callback to load a model. Must return the instance_id for SSE subscription */
  onLoad: (request: LoadModelRequest) => Promise<{ instance_id: string }>
  /** Called after successful model load */
  onSuccess?: () => void
}

/**
 * Modal dialog for loading a new model instance.
 * Shows real-time logs during model loading via SSE.
 *
 * State machine: form → loading → success/failed
 * - form: User enters model configuration
 * - loading: Model is loading, showing real-time logs
 * - success: Model loaded successfully, auto-closes after 2s
 * - failed: Model failed to load, shows error and logs
 */
export function LoadModelDialog({ isOpen, onClose, onLoad, onSuccess }: LoadModelDialogProps) {
  // Role-based access control
  const { canWrite } = useAuth()

  // Form state
  const [modelPath, setModelPath] = useState('')
  const [maxTokens, setMaxTokens] = useState(4096)
  const [extraArgs, setExtraArgs] = useState('')
  const [validated, setValidated] = useState<'default' | 'error'>('default')

  // Source type and served model name state
  const [sourceType, setSourceType] = useState<ModelSourceType>('huggingface')
  const [servedModelName, setServedModelName] = useState('')
  const [servedModelNameValidated, setServedModelNameValidated] = useState<'default' | 'error'>(
    'default'
  )

  // Local models state
  const [localModelsEnabled, setLocalModelsEnabled] = useState(false)
  const [localModels, setLocalModels] = useState<LocalModelInfo[]>([])
  const [isLoadingLocalModels, setIsLoadingLocalModels] = useState(false)
  const [selectedLocalModel, setSelectedLocalModel] = useState<LocalModelInfo | null>(null)
  const [currentSubpath, setCurrentSubpath] = useState<string>('')
  const [localModelsBasePath, setLocalModelsBasePath] = useState<string>('')

  // GPU selection state
  const [gpuAvailability, setGpuAvailability] = useState<GpuAvailabilityResponse | null>(null)
  const [isLoadingGpus, setIsLoadingGpus] = useState(false)
  const [gpuSelectionMode, setGpuSelectionMode] = useState<'auto' | 'manual'>('auto')
  const [selectedGpuIds, setSelectedGpuIds] = useState<number[]>([])
  const [tensorParallelSize, setTensorParallelSize] = useState(1)

  // Memory check state
  const [memoryCheck, setMemoryCheck] = useState<MemoryCheckResponse | null>(null)
  const [isCheckingMemory, setIsCheckingMemory] = useState(false)
  const memoryCheckTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sleep mode state (enabled by default)
  const [enableSleepMode, setEnableSleepMode] = useState(true)

  // GPU info state (needed for memory check)
  const [gpuName, setGpuName] = useState<string | null>(null)

  // Loading state
  const [phase, setPhase] = useState<DialogPhase>('form')
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // SSE connection for live logs and progress - only active during loading phase
  const { isConnected, logs, progress, progressMessage, reconnect } = useInstanceEvents({
    instanceId: phase === 'loading' ? instanceId : null,
    eventTypes: ['log', 'status', 'progress'],
    replayLogs: true,
    onStatusChange: (status) => {
      if (status.data.currentStatus === ('running' as ModelStatus)) {
        setPhase('success')
        onSuccess?.()
        // Auto-close after 2 seconds on success
        setTimeout(() => {
          handleClose()
        }, 2000)
      } else if (status.data.currentStatus === ('failed' as ModelStatus)) {
        setPhase('failed')
        setErrorMessage(status.data.errorMessage || 'Model failed to load')
      }
    },
  })

  // Fetch GPU info and availability when dialog opens
  useEffect(() => {
    if (isOpen) {
      // Fetch GPU availability for selection UI
      if (!gpuAvailability) {
        setIsLoadingGpus(true)
        apiClient
          .getAvailableGpus()
          .then((availability) => {
            setGpuAvailability(availability)
            // Set GPU name for memory check from first GPU
            if (availability.gpus.length > 0) {
              setGpuName(availability.gpus[0].name)
            }
          })
          .catch((err) => console.error('Failed to fetch GPU availability:', err))
          .finally(() => setIsLoadingGpus(false))
      }
    }
  }, [isOpen, gpuAvailability])

  // Check local models availability when dialog opens
  useEffect(() => {
    if (isOpen) {
      apiClient
        .getLocalModelsStatus()
        .then((status) => {
          setLocalModelsEnabled(status.enabled)
        })
        .catch(() => setLocalModelsEnabled(false))
    }
  }, [isOpen])

  // Fetch local models when source type changes to 'local' or when browsing subdirectories
  useEffect(() => {
    if (sourceType === 'local' && localModelsEnabled) {
      setIsLoadingLocalModels(true)
      apiClient
        .listLocalModels(currentSubpath || undefined)
        .then((response) => {
          setLocalModels(response.models)
          setLocalModelsBasePath(response.base_path)
        })
        .catch((err) => console.error('Failed to fetch local models:', err))
        .finally(() => setIsLoadingLocalModels(false))
    }
  }, [sourceType, localModelsEnabled, currentSubpath])

  // Auto-fill served model name when model path changes (for HuggingFace only)
  useEffect(() => {
    if (sourceType === 'huggingface' && modelPath.trim()) {
      setServedModelName(modelPath.trim())
    }
  }, [sourceType, modelPath])

  // Debounced memory check when model path or max tokens changes
  useEffect(() => {
    // Clear previous timeout
    if (memoryCheckTimeoutRef.current) {
      clearTimeout(memoryCheckTimeoutRef.current)
    }

    // Only check if we have a valid model path, GPU name, and dialog is in form phase
    if (!modelPath.trim() || !gpuName || phase !== 'form') {
      setMemoryCheck(null)
      return
    }

    // Debounce the API call by 500ms
    setIsCheckingMemory(true)
    memoryCheckTimeoutRef.current = setTimeout(async () => {
      try {
        const result = await apiClient.checkBeforeLoad({
          model_path: modelPath.trim(),
          max_tokens: maxTokens,
          gpu_name: gpuName,
        })
        setMemoryCheck(result)
      } catch (err) {
        console.error('Failed to check memory:', err)
        // Don't show error - just clear the check
        setMemoryCheck(null)
      } finally {
        setIsCheckingMemory(false)
      }
    }, 500)

    return () => {
      if (memoryCheckTimeoutRef.current) {
        clearTimeout(memoryCheckTimeoutRef.current)
      }
    }
  }, [modelPath, maxTokens, gpuName, phase])

  /** Parse extra args textarea into array, filtering empty lines */
  const parseExtraArgs = (text: string): string[] => {
    return text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  /** Handle GPU checkbox toggle */
  const handleGpuToggle = (gpuId: number, checked: boolean) => {
    if (checked) {
      const newSelected = [...selectedGpuIds, gpuId].sort((a, b) => a - b)
      setSelectedGpuIds(newSelected)
      // Auto-set tensor parallel size to match GPU count
      setTensorParallelSize(newSelected.length)
    } else {
      const newSelected = selectedGpuIds.filter((id) => id !== gpuId)
      setSelectedGpuIds(newSelected)
      // Reset tensor parallel size if fewer than 2 GPUs selected
      if (newSelected.length < 2) {
        setTensorParallelSize(1)
      } else {
        setTensorParallelSize(newSelected.length)
      }
    }
  }

  const handleSubmit = async () => {
    if (!modelPath.trim()) {
      setValidated('error')
      return
    }

    if (!servedModelName.trim()) {
      setServedModelNameValidated('error')
      return
    }

    setPhase('loading')
    setErrorMessage(null)

    try {
      const parsedArgs = parseExtraArgs(extraArgs)

      // Build the request with GPU selection
      const request: LoadModelRequest = {
        model_path: modelPath.trim(),
        max_tokens: maxTokens,
        extra_args: parsedArgs.length > 0 ? parsedArgs : undefined,
        source_type: sourceType,
        served_model_name: servedModelName.trim(),
      }

      // Include GPU selection if manual mode
      if (gpuSelectionMode === 'manual' && selectedGpuIds.length > 0) {
        request.gpu_ids = selectedGpuIds
        if (selectedGpuIds.length > 1) {
          request.tensor_parallel_size = tensorParallelSize
        }
      }

      // Include sleep mode option
      if (enableSleepMode) {
        request.enable_sleep_mode = true
      }

      const result = await onLoad(request)

      // Start listening for events from this instance
      setInstanceId(result.instance_id)
    } catch (err) {
      setPhase('failed')
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start model load')
    }
  }

  const handleClose = useCallback(() => {
    // Reset all state
    setModelPath('')
    setMaxTokens(4096)
    setExtraArgs('')
    setValidated('default')
    setPhase('form')
    setInstanceId(null)
    setErrorMessage(null)
    setMemoryCheck(null)
    setIsCheckingMemory(false)
    // Reset GPU selection state
    setGpuAvailability(null)
    setGpuSelectionMode('auto')
    setSelectedGpuIds([])
    setTensorParallelSize(1)
    // Reset source type and local models state
    setSourceType('huggingface')
    setServedModelName('')
    setServedModelNameValidated('default')
    setSelectedLocalModel(null)
    setLocalModels([])
    setCurrentSubpath('')
    setLocalModelsBasePath('')
    setEnableSleepMode(true)
    onClose()
  }, [onClose])

  const handleRetry = () => {
    setPhase('form')
    setInstanceId(null)
    setErrorMessage(null)
  }

  const handleModelPathChange = (_event: React.FormEvent, value: string) => {
    setModelPath(value)
    if (value.trim()) {
      setValidated('default')
    }
  }

  // Modal title based on phase
  const getTitle = () => {
    switch (phase) {
      case 'form':
        return 'Start Model'
      case 'loading':
        return `Starting: ${modelPath}`
      case 'success':
        return 'Model Started'
      case 'failed':
        return 'Start Failed'
    }
  }

  return (
    <Modal variant={ModalVariant.medium} isOpen={isOpen} onClose={handleClose}>
      <ModalHeader title={getTitle()} />
      <ModalBody>
        {phase === 'form' && (
          <>
            <Form>
              {/* Model Source Type */}
              <FormGroup label="Model Source" fieldId="source-type">
                <Flex gap={{ default: 'gapMd' }}>
                  <FlexItem>
                    <Radio
                      id="source-huggingface"
                      name="source-type"
                      label="HuggingFace"
                      isChecked={sourceType === 'huggingface'}
                      onChange={() => {
                        setSourceType('huggingface')
                        setModelPath('')
                        setServedModelName('')
                        setSelectedLocalModel(null)
                        setValidated('default')
                      }}
                    />
                  </FlexItem>
                  {localModelsEnabled && (
                    <FlexItem>
                      <Radio
                        id="source-local"
                        name="source-type"
                        label="Local Path"
                        isChecked={sourceType === 'local'}
                        onChange={() => {
                          setSourceType('local')
                          setModelPath('')
                          setServedModelName('')
                          setValidated('default')
                        }}
                      />
                    </FlexItem>
                  )}
                </Flex>
              </FormGroup>

              {/* Model Path - conditional based on source type */}
              {sourceType === 'huggingface' ? (
                <FormGroup label="Model Path" isRequired fieldId="model-path">
                  <TextInput
                    id="model-path"
                    value={modelPath}
                    onChange={handleModelPathChange}
                    placeholder="e.g., HuggingFaceTB/SmolLM2-135M-Instruct"
                    validated={validated}
                    aria-describedby="model-path-helper"
                  />
                  {validated === 'error' && (
                    <FormHelperText>
                      <HelperText>
                        <HelperTextItem variant="error">Model path is required</HelperTextItem>
                      </HelperText>
                    </FormHelperText>
                  )}
                </FormGroup>
              ) : (
                <FormGroup label="Select Local Model" isRequired fieldId="local-model">
                  {/* Breadcrumb navigation */}
                  <Breadcrumb style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
                    <BreadcrumbItem
                      onClick={() => {
                        setCurrentSubpath('')
                        setSelectedLocalModel(null)
                        setModelPath('')
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {localModelsBasePath
                        ? localModelsBasePath.split('/').pop() || 'models'
                        : 'Loading...'}
                    </BreadcrumbItem>
                    {currentSubpath
                      .split('/')
                      .filter(Boolean)
                      .map((segment, index, segments) => {
                        const pathUpToSegment = segments.slice(0, index + 1).join('/')
                        const isLast = index === segments.length - 1
                        return (
                          <BreadcrumbItem
                            key={pathUpToSegment}
                            isActive={isLast && !selectedLocalModel}
                            onClick={() => {
                              if (!isLast || selectedLocalModel) {
                                setCurrentSubpath(pathUpToSegment)
                                setSelectedLocalModel(null)
                                setModelPath('')
                              }
                            }}
                            style={{
                              cursor: isLast && !selectedLocalModel ? 'default' : 'pointer',
                            }}
                          >
                            {segment}
                          </BreadcrumbItem>
                        )
                      })}
                    {selectedLocalModel && (
                      <BreadcrumbItem isActive>{selectedLocalModel.name}</BreadcrumbItem>
                    )}
                  </Breadcrumb>

                  {isLoadingLocalModels ? (
                    <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                      <FlexItem>
                        <Spinner size="md" />
                      </FlexItem>
                      <FlexItem>Loading local models...</FlexItem>
                    </Flex>
                  ) : localModels.length > 0 ? (
                    <>
                      {/* Directory list */}
                      <div
                        style={{
                          border: '1px solid var(--pf-t--global--border--color--default)',
                          borderRadius: 'var(--pf-t--global--border--radius--small)',
                          maxHeight: '200px',
                          overflowY: 'auto',
                        }}
                      >
                        {localModels.map((model) => (
                          <Flex
                            key={model.path}
                            alignItems={{ default: 'alignItemsCenter' }}
                            onClick={() => {
                              if (model.has_config) {
                                // Model folder: select it
                                setSelectedLocalModel(model)
                                setModelPath(model.path)
                                setServedModelName(model.name) // Auto-fill with folder name
                                setValidated('default')
                              } else {
                                // Regular folder: navigate into it
                                const relativePath = currentSubpath
                                  ? `${currentSubpath}/${model.name}`
                                  : model.name
                                setCurrentSubpath(relativePath)
                                setSelectedLocalModel(null)
                                setModelPath('')
                              }
                            }}
                            style={{
                              padding: 'var(--pf-t--global--spacer--sm)',
                              borderBottom: '1px solid var(--pf-t--global--border--color--default)',
                              cursor: 'pointer',
                              backgroundColor:
                                selectedLocalModel?.path === model.path
                                  ? 'var(--pf-t--global--background--color--primary--default)'
                                  : undefined,
                            }}
                          >
                            <FlexItem grow={{ default: 'grow' }}>
                              <span
                                style={{
                                  fontWeight:
                                    selectedLocalModel?.path === model.path ? 'bold' : 'normal',
                                }}
                              >
                                {model.name}
                              </span>
                              {model.has_config ? (
                                <span
                                  style={{
                                    marginLeft: 'var(--pf-t--global--spacer--sm)',
                                    fontSize: 'var(--pf-t--global--font--size--xs)',
                                    color: 'var(--pf-t--global--color--status--success--default)',
                                  }}
                                >
                                  (model)
                                </span>
                              ) : (
                                <span
                                  style={{
                                    marginLeft: 'var(--pf-t--global--spacer--sm)',
                                    fontSize: 'var(--pf-t--global--font--size--xs)',
                                    color: 'var(--pf-t--global--text--color--subtle)',
                                  }}
                                >
                                  (folder)
                                </span>
                              )}
                            </FlexItem>
                          </Flex>
                        ))}
                      </div>

                      {validated === 'error' && (
                        <FormHelperText>
                          <HelperText>
                            <HelperTextItem variant="error">Please select a model</HelperTextItem>
                          </HelperText>
                        </FormHelperText>
                      )}
                    </>
                  ) : (
                    <Alert variant="warning" isInline title="No directories found">
                      No subdirectories found in this path.
                    </Alert>
                  )}
                </FormGroup>
              )}

              {/* Served Model Name */}
              <FormGroup label="Served Model Name" isRequired fieldId="served-model-name">
                <TextInput
                  id="served-model-name"
                  value={servedModelName}
                  onChange={(_event, value) => {
                    setServedModelName(value)
                    if (value.trim()) {
                      setServedModelNameValidated('default')
                    }
                  }}
                  placeholder={
                    sourceType === 'huggingface'
                      ? 'Auto-filled from model path'
                      : 'Enter a name for this model'
                  }
                  validated={servedModelNameValidated}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem
                      variant={servedModelNameValidated === 'error' ? 'error' : undefined}
                    >
                      {servedModelNameValidated === 'error'
                        ? 'Served model name is required'
                        : `This name is used for inference requests (--served-model-name).${sourceType === 'huggingface' ? ' Auto-filled from HuggingFace ID.' : ''}`}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>

              <FormGroup label="Max Tokens" fieldId="max-tokens">
                <NumberInput
                  value={maxTokens}
                  onMinus={() => setMaxTokens(Math.max(128, maxTokens - 512))}
                  onPlus={() => setMaxTokens(Math.min(1000000, maxTokens + 512))}
                  onChange={(event) => {
                    const inputValue = (event.target as HTMLInputElement).value
                    // Allow empty or any numeric input during typing
                    if (inputValue === '' || !isNaN(Number(inputValue))) {
                      setMaxTokens(inputValue === '' ? 0 : Number(inputValue))
                    }
                  }}
                  onBlur={(event) => {
                    const value = Number((event.target as HTMLInputElement).value)
                    // Clamp to valid range on blur, reset to min if invalid
                    if (isNaN(value) || value < 128) {
                      setMaxTokens(128)
                    } else if (value > 1000000) {
                      setMaxTokens(1000000)
                    }
                  }}
                  min={128}
                  max={1000000}
                  inputName="max-tokens"
                  inputAriaLabel="Max tokens"
                />
              </FormGroup>

              {/* GPU Selection */}
              <FormGroup label="GPU Selection" fieldId="gpu-selection">
                {isLoadingGpus ? (
                  <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                    <FlexItem>
                      <Spinner size="md" />
                    </FlexItem>
                    <FlexItem>Loading GPU information...</FlexItem>
                  </Flex>
                ) : gpuAvailability && gpuAvailability.gpus.length > 1 ? (
                  <>
                    <Flex direction={{ default: 'column' }} gap={{ default: 'gapSm' }}>
                      <FlexItem>
                        <Radio
                          id="gpu-auto"
                          name="gpu-selection-mode"
                          label={`Auto (recommended: GPU ${gpuAvailability.recommendation.gpu_id} - ${gpuAvailability.recommendation.free_memory_gb.toFixed(1)} GB free)`}
                          isChecked={gpuSelectionMode === 'auto'}
                          onChange={() => {
                            setGpuSelectionMode('auto')
                            setSelectedGpuIds([])
                            setTensorParallelSize(1)
                          }}
                        />
                      </FlexItem>
                      <FlexItem>
                        <Radio
                          id="gpu-manual"
                          name="gpu-selection-mode"
                          label="Manual selection"
                          isChecked={gpuSelectionMode === 'manual'}
                          onChange={() => setGpuSelectionMode('manual')}
                        />
                      </FlexItem>
                    </Flex>

                    {gpuSelectionMode === 'manual' && (
                      <div
                        style={{
                          marginTop: 'var(--pf-t--global--spacer--sm)',
                          marginLeft: 'var(--pf-t--global--spacer--lg)',
                        }}
                      >
                        <Flex direction={{ default: 'column' }} gap={{ default: 'gapXs' }}>
                          {gpuAvailability.gpus.map((gpu) => (
                            <FlexItem key={gpu.index}>
                              <Checkbox
                                id={`gpu-${gpu.index}`}
                                label={
                                  <span>
                                    GPU {gpu.index}: {gpu.name}
                                    <span
                                      style={{
                                        color: 'var(--pf-t--global--text--color--subtle)',
                                        marginLeft: 'var(--pf-t--global--spacer--sm)',
                                      }}
                                    >
                                      ({(gpu.memory_free_mb / 1024).toFixed(1)} GB free of{' '}
                                      {(gpu.memory_total_mb / 1024).toFixed(0)} GB)
                                    </span>
                                    {gpu.recommended && (
                                      <span
                                        style={{
                                          color:
                                            'var(--pf-t--global--color--status--success--default)',
                                          marginLeft: 'var(--pf-t--global--spacer--sm)',
                                        }}
                                      >
                                        (recommended)
                                      </span>
                                    )}
                                  </span>
                                }
                                isChecked={selectedGpuIds.includes(gpu.index)}
                                onChange={(_event, checked) => handleGpuToggle(gpu.index, checked)}
                              />
                            </FlexItem>
                          ))}
                        </Flex>

                        {selectedGpuIds.length > 1 && (
                          <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
                            <FormGroup label="Tensor Parallel Size" fieldId="tensor-parallel-size">
                              <NumberInput
                                value={tensorParallelSize}
                                onMinus={() =>
                                  setTensorParallelSize(Math.max(1, tensorParallelSize - 1))
                                }
                                onPlus={() =>
                                  setTensorParallelSize(
                                    Math.min(selectedGpuIds.length, tensorParallelSize + 1)
                                  )
                                }
                                onChange={(event) => {
                                  const value = Number((event.target as HTMLInputElement).value)
                                  if (
                                    !isNaN(value) &&
                                    value >= 1 &&
                                    value <= selectedGpuIds.length
                                  ) {
                                    setTensorParallelSize(value)
                                  }
                                }}
                                min={1}
                                max={selectedGpuIds.length}
                                inputName="tensor-parallel-size"
                                inputAriaLabel="Tensor parallel size"
                              />
                              <FormHelperText>
                                <HelperText>
                                  <HelperTextItem>
                                    Number of GPUs to split the model across. Usually equals the
                                    number of selected GPUs.
                                  </HelperTextItem>
                                </HelperText>
                              </FormHelperText>
                            </FormGroup>

                            <Alert
                              variant="info"
                              isInline
                              title="Tensor Parallelism"
                              style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}
                            >
                              Tensor parallelism with kvcached is a recent feature. Results may
                              vary.
                            </Alert>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : gpuAvailability ? (
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        Single GPU detected: {gpuAvailability.gpus[0]?.name} (
                        {((gpuAvailability.gpus[0]?.memory_free_mb ?? 0) / 1024).toFixed(1)} GB
                        free)
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                ) : null}
              </FormGroup>

              <FormGroup fieldId="enable-sleep-mode">
                <Checkbox
                  id="enable-sleep-mode"
                  label="Enable Sleep Mode"
                  description="Allows model to be put to sleep to free GPU memory (~90%) while keeping it loaded for quick wake-up"
                  isChecked={enableSleepMode}
                  onChange={(_event, checked) => setEnableSleepMode(checked)}
                />
              </FormGroup>

              <FormGroup label="Additional vLLM Arguments" fieldId="extra-args">
                <TextArea
                  id="extra-args"
                  value={extraArgs}
                  onChange={(_event, value) => setExtraArgs(value)}
                  placeholder={`--served-model-name=MyModel\n--tensor-parallel-size=2\n--max-num-seqs=256\n--trust-remote-code`}
                  aria-label="Additional vLLM CLI arguments, one per line"
                  rows={4}
                  resizeOrientation="vertical"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Enter one argument per line. Some arguments like --gpu-memory-utilization are
                      managed by the system and will be ignored.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </Form>

            {/* Memory check warning */}
            {memoryCheck && (
              <Alert
                variant={
                  memoryCheck.warning_level === 'danger'
                    ? 'danger'
                    : memoryCheck.warning_level === 'caution'
                      ? 'warning'
                      : 'info'
                }
                isInline
                title={
                  memoryCheck.warning_level === 'danger'
                    ? 'Memory Warning'
                    : memoryCheck.warning_level === 'caution'
                      ? 'Memory Caution'
                      : memoryCheck.has_profile
                        ? 'Memory OK'
                        : 'No Memory Profile'
                }
                style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}
              >
                {memoryCheck.message}
              </Alert>
            )}
            {isCheckingMemory && modelPath.trim() && (
              <div
                style={{
                  marginTop: 'var(--pf-t--global--spacer--md)',
                  color: 'var(--pf-t--global--text--color--subtle)',
                  fontSize: 'var(--pf-t--global--font--size--sm)',
                }}
              >
                Checking memory requirements...
              </div>
            )}
          </>
        )}

        {(phase === 'loading' || phase === 'failed') && (
          <>
            <Progress
              aria-label="Model loading progress"
              value={phase === 'failed' ? 100 : (progress ?? undefined)}
              measureLocation={ProgressMeasureLocation.none}
              variant={phase === 'failed' ? 'danger' : undefined}
              style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}
            />

            {phase === 'loading' && progressMessage && (
              <div
                style={{
                  marginBottom: 'var(--pf-t--global--spacer--md)',
                  color: 'var(--pf-t--global--text--color--subtle)',
                  fontSize: 'var(--pf-t--global--font--size--sm)',
                }}
              >
                {progressMessage}
              </div>
            )}

            {phase === 'failed' && errorMessage && (
              <Alert
                variant="danger"
                isInline
                title="Model loading failed"
                style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
              >
                {errorMessage}
              </Alert>
            )}

            <LogViewer
              logs={logs}
              isLoading={phase === 'loading'}
              isConnected={isConnected}
              collapsedLineCount={3}
              onReconnect={reconnect}
              defaultExpanded={phase === 'failed'}
            />
          </>
        )}

        {phase === 'success' && (
          <Alert variant="success" isInline title="Model loaded successfully">
            The model is now ready for inference. This dialog will close automatically.
          </Alert>
        )}
      </ModalBody>

      <ModalFooter>
        {phase === 'form' && (
          <>
            <Button
              variant="primary"
              onClick={handleSubmit}
              isDisabled={!canWrite}
              title={!canWrite ? 'You do not have permission to start models' : undefined}
            >
              Start Model
            </Button>
            <Button variant="link" onClick={handleClose}>
              Cancel
            </Button>
          </>
        )}

        {phase === 'loading' && (
          <Button variant="link" onClick={handleClose}>
            Run in Background
          </Button>
        )}

        {phase === 'failed' && (
          <>
            <Button variant="primary" onClick={handleRetry}>
              Try Again
            </Button>
            <Button variant="link" onClick={handleClose}>
              Close
            </Button>
          </>
        )}

        {phase === 'success' && (
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        )}
      </ModalFooter>
    </Modal>
  )
}

export default LoadModelDialog
