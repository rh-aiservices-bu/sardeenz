import { useState, useEffect } from 'react'
import {
  Card,
  CardTitle,
  CardBody,
  Form,
  FormGroup,
  FormSection,
  TextInput,
  NumberInput,
  Switch,
  Button,
  Alert,
  Flex,
  FlexItem,
  Checkbox,
  Slider,
  SliderOnChangeEvent,
  FormHelperText,
  HelperText,
  HelperTextItem,
  ToggleGroup,
  ToggleGroupItem,
} from '@patternfly/react-core'
import { CopyIcon } from '@patternfly/react-icons'
import { apiClient, extractErrorMessage } from '../../services/api'
import type { ModelInstanceDTO, RoutingMode } from '@sardeenz/types'

/** Token step values for logarithmic-like distribution on sliders */
const INPUT_TOKEN_STEPS = [64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384]
const OUTPUT_TOKEN_STEPS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768]

/** Find the closest step index for a given token value */
const findStepIndex = (value: number, steps: number[]): number => {
  let closest = 0
  let minDiff = Math.abs(steps[0] - value)
  for (let i = 1; i < steps.length; i++) {
    const diff = Math.abs(steps[i] - value)
    if (diff < minDiff) {
      minDiff = diff
      closest = i
    }
  }
  return closest
}

/** Format token value for slider label display */
const formatTokens = (value: number): string => {
  if (value >= 1024) return `${value / 1024}K`
  return String(value)
}

/** Default parameter values for new model selections */
const DEFAULT_PARAMS = {
  inputTokens: 512,
  outputTokens: 128,
  concurrency: 4,
  totalRequests: 50,
  warmupRequests: 3,
  slaThresholdMs: undefined as number | undefined,
}

/** Selected model with routing mode and per-model test parameters */
export interface SelectedModel {
  instanceId: string
  routingMode: RoutingMode
  // Per-model test parameters
  inputTokens: number
  outputTokens: number
  concurrency: number
  totalRequests: number
  warmupRequests: number
  slaThresholdMs?: number
}

/** Initial config for prefilling the form (e.g., from a previous benchmark) */
export interface InitialBenchmarkConfig {
  name?: string
  mode: 'isolated' | 'contention'
  scenarios: Array<{
    modelPath: string
    routingMode: RoutingMode
    inputTokens: number
    outputTokens: number
    concurrency: number
    totalRequests: number
    warmupRequests: number
  }>
}

interface BenchmarkConfigFormProps {
  onSubmit: (config: BenchmarkFormConfig) => void
  isSubmitting: boolean
  /** Optional initial config to prefill the form (for rerunning a benchmark) */
  initialConfig?: InitialBenchmarkConfig
}

export interface BenchmarkFormConfig {
  name?: string
  mode: 'isolated' | 'contention'
  selectedModels: SelectedModel[]
  // Parameters are now per-model in selectedModels
}

/**
 * Form to configure benchmark parameters.
 * Follows PatternFly 6 patterns.
 */
export function BenchmarkConfigForm({ onSubmit, isSubmitting, initialConfig }: BenchmarkConfigFormProps) {
  // Running instances
  const [runningInstances, setRunningInstances] = useState<ModelInstanceDTO[]>([])
  const [isLoadingInstances, setIsLoadingInstances] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state
  const [name, setName] = useState(initialConfig?.name || '')
  const [mode, setMode] = useState<'isolated' | 'contention'>(initialConfig?.mode || 'contention')
  const [selectedModels, setSelectedModels] = useState<SelectedModel[]>([])
  // Track which models have their parameter section expanded
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set())
  // Track if initial config has been applied (to avoid re-applying on re-renders)
  const [hasAppliedInitialConfig, setHasAppliedInitialConfig] = useState(false)

  // Fetch running instances
  useEffect(() => {
    const fetchInstances = async () => {
      setIsLoadingInstances(true)
      setLoadError(null)
      try {
        const response = await apiClient.listModels()
        const running = response.models.filter((m) => m.status === 'running')
        setRunningInstances(running)

        // If we have an initial config to apply, match scenarios to running instances
        if (initialConfig && !hasAppliedInitialConfig && running.length > 0) {
          const matchedModels: SelectedModel[] = []

          for (const scenario of initialConfig.scenarios) {
            // Find running instance with matching model_path
            const instance = running.find((i) => i.model_path === scenario.modelPath)
            if (instance) {
              matchedModels.push({
                instanceId: instance.id,
                routingMode: scenario.routingMode,
                inputTokens: scenario.inputTokens,
                outputTokens: scenario.outputTokens,
                concurrency: scenario.concurrency,
                totalRequests: scenario.totalRequests,
                warmupRequests: scenario.warmupRequests,
              })
            }
          }

          if (matchedModels.length > 0) {
            setSelectedModels(matchedModels)
            setExpandedModels(new Set(matchedModels.map((m) => m.instanceId)))
          }
          setHasAppliedInitialConfig(true)
        } else if (!initialConfig && running.length > 0 && selectedModels.length === 0) {
          // Pre-select first instance if no initial config and nothing selected
          const firstId = running[0].id
          setSelectedModels([{ instanceId: firstId, routingMode: 'direct', ...DEFAULT_PARAMS }])
          setExpandedModels(new Set([firstId]))
        }
      } catch (err) {
        console.error('Failed to fetch models:', err)
        setLoadError(extractErrorMessage(err))
      } finally {
        setIsLoadingInstances(false)
      }
    }

    fetchInstances()
  }, [initialConfig, hasAppliedInitialConfig])

  const handleInstanceToggle = (instanceId: string, checked: boolean) => {
    if (checked) {
      setSelectedModels([...selectedModels, { instanceId, routingMode: 'direct', ...DEFAULT_PARAMS }])
      // Auto-expand the newly selected model
      setExpandedModels((prev) => new Set([...prev, instanceId]))
    } else {
      setSelectedModels(selectedModels.filter((m) => m.instanceId !== instanceId))
      // Collapse when deselected
      setExpandedModels((prev) => {
        const next = new Set(prev)
        next.delete(instanceId)
        return next
      })
    }
  }

  const handleModelConfigChange = (instanceId: string, updates: Partial<SelectedModel>) => {
    setSelectedModels(
      selectedModels.map((m) => (m.instanceId === instanceId ? { ...m, ...updates } : m))
    )
  }

  const handleCopyToAll = (sourceInstanceId: string) => {
    const sourceModel = selectedModels.find((m) => m.instanceId === sourceInstanceId)
    if (!sourceModel) return

    const { instanceId: _id, routingMode: _route, ...params } = sourceModel
    setSelectedModels(
      selectedModels.map((m) => ({ ...m, ...params }))
    )
  }

  const toggleModelExpanded = (instanceId: string) => {
    setExpandedModels((prev) => {
      const next = new Set(prev)
      if (next.has(instanceId)) {
        next.delete(instanceId)
      } else {
        next.add(instanceId)
      }
      return next
    })
  }

  const handleRoutingModeChange = (instanceId: string, routingMode: RoutingMode) => {
    setSelectedModels(
      selectedModels.map((m) => (m.instanceId === instanceId ? { ...m, routingMode } : m))
    )
  }

  const isInstanceSelected = (instanceId: string): boolean => {
    return selectedModels.some((m) => m.instanceId === instanceId)
  }

  const getTokenValidationError = (instanceId: string, inputTokens: number, outputTokens: number): string | null => {
    const instance = runningInstances.find((i) => i.id === instanceId)
    if (!instance) return null

    const totalTokens = inputTokens + outputTokens
    if (totalTokens > instance.max_tokens) {
      return `Combined tokens (${totalTokens.toLocaleString()}) exceeds model max (${instance.max_tokens.toLocaleString()})`
    }
    return null
  }

  const getRoutingMode = (instanceId: string): RoutingMode => {
    return selectedModels.find((m) => m.instanceId === instanceId)?.routingMode || 'direct'
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    onSubmit({
      name: name.trim() || undefined,
      mode,
      selectedModels,
    })
  }

  const hasTokenErrors = selectedModels.some((model) => {
    const instance = runningInstances.find((i) => i.id === model.instanceId)
    return instance && model.inputTokens + model.outputTokens > instance.max_tokens
  })

  const isValid = selectedModels.length > 0 && !hasTokenErrors

  // Calculate estimated total duration across all models
  const estimatedDurationSeconds = selectedModels.reduce((sum, model) => {
    return (
      sum +
      Math.ceil(
        ((model.warmupRequests + model.totalRequests) *
          (model.inputTokens + model.outputTokens) *
          0.05) /
          model.concurrency
      )
    )
  }, 0)

  return (
    <Card>
      <CardTitle>Configure Benchmark</CardTitle>
      <CardBody>
        {loadError && (
          <Alert variant="danger" isInline title="Failed to load models">
            {loadError}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <FormSection title="Models to Benchmark">
            {isLoadingInstances ? (
              <div>Loading running models...</div>
            ) : runningInstances.length === 0 ? (
              <Alert variant="info" isInline title="No running models">
                Start a model first to run benchmarks.
              </Alert>
            ) : (
              <FormGroup fieldId="model-selection" role="group" aria-label="Select models">
                {runningInstances.map((instance) => {
                  const isSelected = isInstanceSelected(instance.id)
                  const isExpanded = expandedModels.has(instance.id)
                  const modelConfig = selectedModels.find((m) => m.instanceId === instance.id)

                  return (
                    <div
                      key={instance.id}
                      style={{
                        marginBottom: 'var(--pf-t--global--spacer--md)',
                        borderBottom: '1px solid var(--pf-t--global--border--color--default)',
                        paddingBottom: 'var(--pf-t--global--spacer--md)',
                      }}
                    >
                      <Flex alignItems={{ default: 'alignItemsCenter' }}>
                        <FlexItem>
                          <Checkbox
                            id={`model-${instance.id}`}
                            label={`${instance.model_path} (${instance.max_tokens} tokens)`}
                            isChecked={isSelected}
                            onChange={(_event, checked) => handleInstanceToggle(instance.id, checked)}
                          />
                        </FlexItem>
                        {isSelected && (
                          <>
                            <FlexItem>
                              <ToggleGroup aria-label="Routing mode" isCompact>
                                <ToggleGroupItem
                                  text="Direct"
                                  buttonId={`routing-direct-${instance.id}`}
                                  isSelected={getRoutingMode(instance.id) === 'direct'}
                                  onChange={() => handleRoutingModeChange(instance.id, 'direct')}
                                />
                                <ToggleGroupItem
                                  text="Proxy"
                                  buttonId={`routing-proxy-${instance.id}`}
                                  isSelected={getRoutingMode(instance.id) === 'proxy'}
                                  onChange={() => handleRoutingModeChange(instance.id, 'proxy')}
                                />
                              </ToggleGroup>
                            </FlexItem>
                            <FlexItem>
                              <Button
                                variant="link"
                                size="sm"
                                onClick={() => toggleModelExpanded(instance.id)}
                              >
                                {isExpanded ? 'Hide parameters' : 'Show parameters'}
                              </Button>
                            </FlexItem>
                          </>
                        )}
                      </Flex>

                      {isSelected && modelConfig && isExpanded && (
                        <div style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
                          <div
                            style={{
                              marginLeft: 'var(--pf-t--global--spacer--xl)',
                              padding: 'var(--pf-t--global--spacer--md)',
                              backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
                              borderRadius: 'var(--pf-t--global--border--radius--small)',
                            }}
                          >
                            <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
                              <FlexItem>
                                <FormGroup label="Input Tokens" fieldId={`input-tokens-${instance.id}`}>
                                  <Slider
                                    id={`input-tokens-${instance.id}`}
                                    value={findStepIndex(modelConfig.inputTokens, INPUT_TOKEN_STEPS)}
                                    min={0}
                                    max={INPUT_TOKEN_STEPS.length - 1}
                                    step={1}
                                    showTicks
                                    customSteps={INPUT_TOKEN_STEPS.map((val, idx) => ({
                                      value: idx,
                                      label: formatTokens(val),
                                    }))}
                                    onChange={(_event: SliderOnChangeEvent, index: number) =>
                                      handleModelConfigChange(instance.id, { inputTokens: INPUT_TOKEN_STEPS[index] })
                                    }
                                  />
                                </FormGroup>
                              </FlexItem>

                              <FlexItem>
                                <FormGroup label="Output Tokens" fieldId={`output-tokens-${instance.id}`}>
                                  <Slider
                                    id={`output-tokens-${instance.id}`}
                                    value={findStepIndex(modelConfig.outputTokens, OUTPUT_TOKEN_STEPS)}
                                    min={0}
                                    max={OUTPUT_TOKEN_STEPS.length - 1}
                                    step={1}
                                    showTicks
                                    customSteps={OUTPUT_TOKEN_STEPS.map((val, idx) => ({
                                      value: idx,
                                      label: formatTokens(val),
                                    }))}
                                    onChange={(_event: SliderOnChangeEvent, index: number) =>
                                      handleModelConfigChange(instance.id, { outputTokens: OUTPUT_TOKEN_STEPS[index] })
                                    }
                                  />
                                  {(() => {
                                    const tokenError = getTokenValidationError(
                                      instance.id,
                                      modelConfig.inputTokens,
                                      modelConfig.outputTokens
                                    )
                                    return tokenError ? (
                                      <FormHelperText>
                                        <HelperText>
                                          <HelperTextItem variant="error">{tokenError}</HelperTextItem>
                                        </HelperText>
                                      </FormHelperText>
                                    ) : (
                                      <FormHelperText>
                                        <HelperText>
                                          <HelperTextItem>
                                            Total: {(modelConfig.inputTokens + modelConfig.outputTokens).toLocaleString()} / {instance.max_tokens.toLocaleString()} tokens
                                          </HelperTextItem>
                                        </HelperText>
                                      </FormHelperText>
                                    )
                                  })()}
                                </FormGroup>
                              </FlexItem>

                              <FlexItem>
                                <Flex gap={{ default: 'gapLg' }}>
                                  <FlexItem>
                                    <FormGroup label="Concurrency" fieldId={`concurrency-${instance.id}`}>
                                      <NumberInput
                                        id={`concurrency-${instance.id}`}
                                        value={modelConfig.concurrency}
                                        min={1}
                                        max={32}
                                        onMinus={() =>
                                          handleModelConfigChange(instance.id, {
                                            concurrency: Math.max(1, modelConfig.concurrency - 1),
                                          })
                                        }
                                        onPlus={() =>
                                          handleModelConfigChange(instance.id, {
                                            concurrency: Math.min(32, modelConfig.concurrency + 1),
                                          })
                                        }
                                        onChange={(event) => {
                                          const value = Number((event.target as HTMLInputElement).value)
                                          if (!isNaN(value)) {
                                            handleModelConfigChange(instance.id, { concurrency: value })
                                          }
                                        }}
                                        inputName={`concurrency-${instance.id}`}
                                        inputAriaLabel="Concurrent requests"
                                      />
                                    </FormGroup>
                                  </FlexItem>

                                  <FlexItem>
                                    <FormGroup label="Total Requests" fieldId={`total-requests-${instance.id}`}>
                                      <NumberInput
                                        id={`total-requests-${instance.id}`}
                                        value={modelConfig.totalRequests}
                                        min={10}
                                        max={500}
                                        onMinus={() =>
                                          handleModelConfigChange(instance.id, {
                                            totalRequests: Math.max(10, modelConfig.totalRequests - 10),
                                          })
                                        }
                                        onPlus={() =>
                                          handleModelConfigChange(instance.id, {
                                            totalRequests: Math.min(500, modelConfig.totalRequests + 10),
                                          })
                                        }
                                        onChange={(event) => {
                                          const value = Number((event.target as HTMLInputElement).value)
                                          if (!isNaN(value)) {
                                            handleModelConfigChange(instance.id, { totalRequests: value })
                                          }
                                        }}
                                        inputName={`total-requests-${instance.id}`}
                                        inputAriaLabel="Total measured requests"
                                      />
                                    </FormGroup>
                                  </FlexItem>

                                  <FlexItem>
                                    <FormGroup label="Warmup" fieldId={`warmup-${instance.id}`}>
                                      <NumberInput
                                        id={`warmup-${instance.id}`}
                                        value={modelConfig.warmupRequests}
                                        min={1}
                                        max={10}
                                        onMinus={() =>
                                          handleModelConfigChange(instance.id, {
                                            warmupRequests: Math.max(1, modelConfig.warmupRequests - 1),
                                          })
                                        }
                                        onPlus={() =>
                                          handleModelConfigChange(instance.id, {
                                            warmupRequests: Math.min(10, modelConfig.warmupRequests + 1),
                                          })
                                        }
                                        onChange={(event) => {
                                          const value = Number((event.target as HTMLInputElement).value)
                                          if (!isNaN(value)) {
                                            handleModelConfigChange(instance.id, { warmupRequests: value })
                                          }
                                        }}
                                        inputName={`warmup-${instance.id}`}
                                        inputAriaLabel="Warmup requests"
                                      />
                                    </FormGroup>
                                  </FlexItem>

                                  <FlexItem>
                                    <FormGroup label="SLA Threshold (ms)" fieldId={`sla-${instance.id}`}>
                                      <NumberInput
                                        id={`sla-${instance.id}`}
                                        value={modelConfig.slaThresholdMs ?? 0}
                                        min={0}
                                        max={60000}
                                        onMinus={() => {
                                          const current = modelConfig.slaThresholdMs ?? 0
                                          const newVal = Math.max(0, current - 500)
                                          handleModelConfigChange(instance.id, {
                                            slaThresholdMs: newVal === 0 ? undefined : newVal,
                                          })
                                        }}
                                        onPlus={() => {
                                          const current = modelConfig.slaThresholdMs ?? 0
                                          const newVal = current === 0 ? 1000 : Math.min(60000, current + 500)
                                          handleModelConfigChange(instance.id, { slaThresholdMs: newVal })
                                        }}
                                        onChange={(event) => {
                                          const value = Number((event.target as HTMLInputElement).value)
                                          if (!isNaN(value) && value >= 0 && value <= 60000) {
                                            handleModelConfigChange(instance.id, {
                                              slaThresholdMs: value === 0 ? undefined : value,
                                            })
                                          }
                                        }}
                                        inputName={`sla-${instance.id}`}
                                        inputAriaLabel="SLA threshold in milliseconds"
                                      />
                                      <FormHelperText>
                                        <HelperText>
                                          <HelperTextItem>
                                            {modelConfig.slaThresholdMs
                                              ? `Goodput: requests fully completing within ${modelConfig.slaThresholdMs}ms`
                                              : 'Optional: Set to enable goodput metric'}
                                          </HelperTextItem>
                                        </HelperText>
                                      </FormHelperText>
                                    </FormGroup>
                                  </FlexItem>
                                </Flex>
                              </FlexItem>

                              {selectedModels.length > 1 && (
                                <FlexItem>
                                  <Button
                                    variant="link"
                                    icon={<CopyIcon />}
                                    onClick={() => handleCopyToAll(instance.id)}
                                  >
                                    Copy to all models
                                  </Button>
                                </FlexItem>
                              )}
                            </Flex>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Direct: connect to vLLM instance port. Proxy: route through unified endpoint.
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            )}
          </FormSection>

          <FormSection title="Benchmark Mode">
            <FormGroup fieldId="mode-toggle">
              <Switch
                id="mode-toggle"
                label={mode === 'contention' ? 'Contention mode (parallel scenarios)' : 'Isolated mode (sequential scenarios)'}
                isChecked={mode === 'contention'}
                onChange={(_event, checked) => setMode(checked ? 'contention' : 'isolated')}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {mode === 'isolated'
                      ? 'Run each model scenario separately for clean measurements'
                      : 'Run all model scenarios simultaneously to test GPU contention'}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          </FormSection>

          <FormSection title="Optional Settings">
            <FormGroup label="Benchmark Name" fieldId="benchmark-name">
              <TextInput
                id="benchmark-name"
                value={name}
                onChange={(_event, value) => setName(value)}
                placeholder="e.g., Baseline performance test"
                aria-label="Benchmark name"
              />
            </FormGroup>
          </FormSection>

          <Flex style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
            <FlexItem>
              <Button
                type="submit"
                variant="primary"
                isDisabled={!isValid || isSubmitting}
                isLoading={isSubmitting}
              >
                {isSubmitting ? 'Starting...' : 'Start Benchmark'}
              </Button>
            </FlexItem>
            <FlexItem>
              <div style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                Estimated total duration: ~{estimatedDurationSeconds}s ({selectedModels.length} model{selectedModels.length !== 1 ? 's' : ''})
              </div>
            </FlexItem>
          </Flex>
        </Form>
      </CardBody>
    </Card>
  )
}

export default BenchmarkConfigForm
