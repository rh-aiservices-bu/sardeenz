import { useCallback, useEffect, useState } from 'react'
import {
  PageSection,
  Content,
  Grid,
  GridItem,
  Card,
  CardTitle,
  CardBody,
  CardFooter,
  Button,
  Spinner,
  EmptyState,
  EmptyStateBody,
  EmptyStateActions,
  EmptyStateFooter,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  TextArea,
  Checkbox,
  Alert,
  CodeBlock,
  CodeBlockCode,
} from '@patternfly/react-core'
import { CubesIcon } from '@patternfly/react-icons'
import { apiClient, extractErrorDetails } from '../services/api'
import type {
  ModelInstanceDTO,
  ChatCompletionResponse,
  ChatCompletionRequest,
} from '@sardeenz/types'
import { useNotifications } from '../contexts/NotificationContext'

interface ModelTestState {
  prompt: string
  useDirectCall: boolean
  isSubmitting: boolean
  result: ChatCompletionResponse | null
  error: string | null
  errorStatusCode?: number
  latencyMs?: number
}

function InferenceTests() {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [testStates, setTestStates] = useState<Map<string, ModelTestState>>(new Map())

  const { addNotification } = useNotifications()

  const fetchModels = useCallback(async () => {
    try {
      const response = await apiClient.listModels()
      // Filter to only show running models
      const runningModels = response.models.filter((m) => m.status === 'running')
      setModels(runningModels)

      // Initialize test state for new models
      setTestStates((prev) => {
        const newStates = new Map(prev)
        runningModels.forEach((model) => {
          if (!newStates.has(model.id)) {
            newStates.set(model.id, {
              prompt: 'Explain why the sky is blue',
              useDirectCall: false,
              isSubmitting: false,
              result: null,
              error: null,
            })
          }
        })
        // Remove states for models that are no longer running
        const runningModelIds = new Set(runningModels.map((m) => m.id))
        Array.from(newStates.keys()).forEach((id) => {
          if (!runningModelIds.has(id)) {
            newStates.delete(id)
          }
        })
        return newStates
      })
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

  const updateTestState = (modelId: string, updates: Partial<ModelTestState>) => {
    setTestStates((prev) => {
      const newStates = new Map(prev)
      const currentState = newStates.get(modelId)
      if (currentState) {
        newStates.set(modelId, { ...currentState, ...updates })
      }
      return newStates
    })
  }

  const handleSendInference = async (model: ModelInstanceDTO) => {
    const state = testStates.get(model.id)
    if (!state || !state.prompt.trim()) {
      addNotification({
        title: 'Invalid prompt',
        description: 'Please enter a prompt',
        variant: 'warning',
      })
      return
    }

    updateTestState(model.id, {
      isSubmitting: true,
      result: null,
      error: null,
      latencyMs: undefined,
    })

    const startTime = performance.now()

    try {
      // Build base request - use model_name (from --served-model-name or defaults to model_path)
      const request: ChatCompletionRequest = {
        model: model.model_name,
        messages: [{ role: 'user' as const, content: state.prompt }],
        max_tokens: 512,
        temperature: 0.7,
      }

      // If model doesn't have chat template, include chat_template field in request
      // NOTE: Requires models to be started with --trust-request-chat-template flag
      if (model.has_chat_template === false) {
        request.chat_template =
          "{% for m in messages %}{{ m.role|upper }}: {{ m.content }}\n{% endfor %}ASSISTANT:"
      }

      let response: ChatCompletionResponse
      if (state.useDirectCall) {
        response = await apiClient.sendChatCompletionDirect(model.port, request)
      } else {
        response = await apiClient.sendChatCompletionViaProxy(request)
      }

      const endTime = performance.now()
      const latencyMs = Math.round(endTime - startTime)

      updateTestState(model.id, {
        isSubmitting: false,
        result: response,
        error: null,
        latencyMs,
      })
    } catch (err) {
      const endTime = performance.now()
      const latencyMs = Math.round(endTime - startTime)
      const errorDetails = extractErrorDetails(err)

      updateTestState(model.id, {
        isSubmitting: false,
        result: null,
        error: errorDetails.message,
        errorStatusCode: errorDetails.statusCode,
        latencyMs,
      })

      addNotification({
        title: errorDetails.statusCode ? `Error ${errorDetails.statusCode}` : 'Inference failed',
        description: errorDetails.message,
        variant: 'danger',
      })
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
    <PageSection>
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsCenter' }}
        style={{ marginBottom: 'var(--pf-t--global--spacer--lg)' }}
      >
        <FlexItem>
          <Content component="h1">Inference Tests</Content>
        </FlexItem>
      </Flex>

      {models.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState titleText="No active models" icon={CubesIcon}>
              <EmptyStateBody>
                Load a model from the Model Management page to start testing inference.
              </EmptyStateBody>
              <EmptyStateFooter>
                <EmptyStateActions>
                  <Button component="a" href="/">
                    Go to Model Management
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            </EmptyState>
          </CardBody>
        </Card>
      ) : (
        <Grid hasGutter>
          {models.map((model) => {
            const state = testStates.get(model.id)
            if (!state) return null

            return (
              <GridItem key={model.id} span={12} lg={6}>
                <Card isFullHeight>
                  <CardTitle>
                    <Flex
                      justifyContent={{ default: 'justifyContentSpaceBetween' }}
                      alignItems={{ default: 'alignItemsCenter' }}
                    >
                      <FlexItem>
                        <strong>{model.model_path.split('/').pop()}</strong>
                      </FlexItem>
                      <FlexItem>
                        <span style={{ fontSize: 'var(--pf-t--global--font--size--body--sm)' }}>
                          Port: {model.port}
                        </span>
                      </FlexItem>
                    </Flex>
                  </CardTitle>
                  <CardBody>
                    <Form>
                      <FormGroup label="Prompt" isRequired>
                        <TextArea
                          value={state.prompt}
                          onChange={(_event, value) =>
                            updateTestState(model.id, { prompt: value })
                          }
                          rows={3}
                          isDisabled={state.isSubmitting}
                          aria-label="Inference prompt"
                        />
                      </FormGroup>

                      <FormGroup>
                        <Checkbox
                          id={`direct-call-${model.id}`}
                          label="Direct port-based routing"
                          description={
                            state.useDirectCall
                              ? `Direct routing to port ${model.port} (bypasses model name lookup)`
                              : 'Routes via model name lookup in proxy'
                          }
                          isChecked={state.useDirectCall}
                          onChange={(_event, checked) =>
                            updateTestState(model.id, { useDirectCall: checked })
                          }
                          isDisabled={state.isSubmitting}
                        />
                      </FormGroup>

                      <Button
                        variant="primary"
                        onClick={() => handleSendInference(model)}
                        isLoading={state.isSubmitting}
                        isDisabled={state.isSubmitting || !state.prompt.trim()}
                      >
                        {state.isSubmitting ? 'Sending...' : 'Send'}
                      </Button>
                    </Form>

                    {state.error && (
                      <Alert
                        variant="danger"
                        title={state.errorStatusCode ? `Error ${state.errorStatusCode}` : 'Error'}
                        isExpandable={state.error.length > 100}
                        style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}
                      >
                        {state.error}
                      </Alert>
                    )}

                    {state.result && (
                      <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
                        <strong>Response:</strong>
                        {model.has_chat_template === false && (
                          <div style={{ fontSize: 'var(--pf-t--global--font--size--body--sm)', color: 'var(--pf-t--global--color--status--warning--default)' }}>
                            ⚠️ Model uses manual template wrapping
                          </div>
                        )}
                        <CodeBlock style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
                          <CodeBlockCode>
                            {state.result.choices[0]?.message?.content || 'No response'}
                          </CodeBlockCode>
                        </CodeBlock>
                      </div>
                    )}
                  </CardBody>

                  {(state.result || state.latencyMs) && (
                    <CardFooter>
                      <Flex>
                        {state.latencyMs !== undefined && (
                          <FlexItem>
                            <span
                              style={{ fontSize: 'var(--pf-t--global--font--size--body--sm)' }}
                            >
                              Latency: {state.latencyMs}ms
                            </span>
                          </FlexItem>
                        )}
                        {state.result?.usage && (
                          <FlexItem>
                            <span
                              style={{ fontSize: 'var(--pf-t--global--font--size--body--sm)' }}
                            >
                              Tokens: {state.result.usage.prompt_tokens} prompt /{' '}
                              {state.result.usage.completion_tokens} completion
                            </span>
                          </FlexItem>
                        )}
                      </Flex>
                    </CardFooter>
                  )}
                </Card>
              </GridItem>
            )
          })}
        </Grid>
      )}
    </PageSection>
  )
}

export default InferenceTests
