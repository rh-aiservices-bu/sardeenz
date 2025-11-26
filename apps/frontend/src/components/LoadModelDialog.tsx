import { useState, useCallback } from 'react'
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
  NumberInput,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Alert,
  Progress,
  ProgressMeasureLocation,
} from '@patternfly/react-core'
import type { LoadModelRequest, ModelStatus } from '@sardeenz/types'
import { useInstanceEvents } from '../hooks/useInstanceEvents'
import { LogViewer } from './LogViewer'

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
export function LoadModelDialog({
  isOpen,
  onClose,
  onLoad,
  onSuccess,
}: LoadModelDialogProps) {
  // Form state
  const [modelPath, setModelPath] = useState('')
  const [maxTokens, setMaxTokens] = useState(4096)
  const [validated, setValidated] = useState<'default' | 'error'>('default')

  // Loading state
  const [phase, setPhase] = useState<DialogPhase>('form')
  const [instanceId, setInstanceId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // SSE connection for live logs - only active during loading phase
  const { isConnected, logs, reconnect } = useInstanceEvents({
    instanceId: phase === 'loading' ? instanceId : null,
    eventTypes: ['log', 'status'],
    replayLogs: true,
    onStatusChange: (status) => {
      if (status.data.currentStatus === ('active' as ModelStatus)) {
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

  const handleSubmit = async () => {
    if (!modelPath.trim()) {
      setValidated('error')
      return
    }

    setPhase('loading')
    setErrorMessage(null)

    try {
      const result = await onLoad({
        model_path: modelPath.trim(),
        max_tokens: maxTokens,
      })

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
    setValidated('default')
    setPhase('form')
    setInstanceId(null)
    setErrorMessage(null)
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
        return 'Load Model'
      case 'loading':
        return `Loading: ${modelPath}`
      case 'success':
        return 'Model Loaded'
      case 'failed':
        return 'Load Failed'
    }
  }

  return (
    <Modal
      variant={ModalVariant.medium}
      isOpen={isOpen}
      onClose={handleClose}
    >
      <ModalHeader title={getTitle()} />
      <ModalBody>
        {phase === 'form' && (
          <Form>
            <FormGroup label="Model Path" isRequired fieldId="model-path">
              <TextInput
                id="model-path"
                value={modelPath}
                onChange={handleModelPathChange}
                placeholder="e.g., meta-llama/Llama-3.2-1B"
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

            <FormGroup label="Max Tokens" fieldId="max-tokens">
              <NumberInput
                value={maxTokens}
                onMinus={() => setMaxTokens(Math.max(512, maxTokens - 512))}
                onPlus={() => setMaxTokens(Math.min(32768, maxTokens + 512))}
                onChange={(event) => {
                  const value = Number((event.target as HTMLInputElement).value)
                  if (!isNaN(value) && value >= 512 && value <= 32768) {
                    setMaxTokens(value)
                  }
                }}
                min={512}
                max={32768}
                inputName="max-tokens"
                inputAriaLabel="Max tokens"
              />
            </FormGroup>
          </Form>
        )}

        {(phase === 'loading' || phase === 'failed') && (
          <>
            <Progress
              aria-label="Model loading progress"
              value={phase === 'failed' ? 100 : undefined}
              measureLocation={ProgressMeasureLocation.none}
              variant={phase === 'failed' ? 'danger' : undefined}
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            />

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
            <Button variant="primary" onClick={handleSubmit}>
              Load Model
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
