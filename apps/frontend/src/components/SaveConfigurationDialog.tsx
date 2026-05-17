import { useState } from 'react'
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
  FormHelperText,
  HelperText,
  HelperTextItem,
  Alert,
  FormSelect,
  FormSelectOption,
  NumberInput,
} from '@patternfly/react-core'
import { apiClient, extractErrorMessage } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

interface SaveConfigurationDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  modelCount: number
  isClusterMode?: boolean
}

/**
 * Dialog for saving the current model configuration.
 * Captures all running models with their settings.
 */
export function SaveConfigurationDialog({
  isOpen,
  onClose,
  onSuccess,
  modelCount,
  isClusterMode,
}: SaveConfigurationDialogProps) {
  const { canWrite } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [placementStrategy, setPlacementStrategy] = useState('')
  const [minKvCacheMb, setMinKvCacheMb] = useState<number | undefined>(undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validated, setValidated] = useState<'default' | 'error'>('default')

  const handleSave = async () => {
    if (!name.trim()) {
      setValidated('error')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      await apiClient.saveConfiguration({
        name: name.trim(),
        description: description.trim() || undefined,
      })
      onSuccess()
      handleClose()
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsSaving(false)
    }
  }

  const handleClose = () => {
    setName('')
    setDescription('')
    setPlacementStrategy('')
    setMinKvCacheMb(undefined)
    setError(null)
    setValidated('default')
    onClose()
  }

  return (
    <Modal
      variant={ModalVariant.small}
      isOpen={isOpen}
      onClose={handleClose}
      aria-labelledby="save-config-modal-title"
      aria-describedby="save-config-modal-body"
    >
      <ModalHeader title="Save Configuration" labelId="save-config-modal-title" />
      <ModalBody id="save-config-modal-body">
        {error && (
          <Alert
            variant="danger"
            isInline
            title="Error"
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            {error}
          </Alert>
        )}

        <Form>
          <FormGroup label="Configuration Name" isRequired fieldId="config-name">
            <TextInput
              id="config-name"
              value={name}
              onChange={(_e, value) => {
                setName(value)
                if (value.trim()) setValidated('default')
              }}
              validated={validated}
              placeholder="e.g., Production Setup"
            />
            {validated === 'error' && (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem variant="error">Name is required</HelperTextItem>
                </HelperText>
              </FormHelperText>
            )}
          </FormGroup>

          <FormGroup label="Description" fieldId="config-description">
            <TextArea
              id="config-description"
              value={description}
              onChange={(_e, value) => setDescription(value)}
              placeholder="Optional description"
              rows={3}
            />
          </FormGroup>

          {isClusterMode && (
            <>
              <FormGroup label="Placement Strategy" fieldId="placement-strategy">
                <FormSelect
                  id="placement-strategy"
                  value={placementStrategy}
                  onChange={(_e, value) => setPlacementStrategy(value)}
                >
                  <FormSelectOption value="" label="None (manual placement)" />
                  <FormSelectOption value="balanced" label="Balanced (spread evenly)" />
                  <FormSelectOption value="maximize-models" label="Maximize Models (pack GPUs)" />
                </FormSelect>
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Strategy used when applying this preset to the cluster
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>

              <FormGroup label="Min KV Cache (MB)" fieldId="min-kv-cache">
                <NumberInput
                  id="min-kv-cache"
                  value={minKvCacheMb ?? 0}
                  min={0}
                  max={65536}
                  onMinus={() => setMinKvCacheMb(Math.max(0, (minKvCacheMb ?? 0) - 256))}
                  onPlus={() => setMinKvCacheMb(Math.min(65536, (minKvCacheMb ?? 0) + 256))}
                  onChange={(event) => {
                    const value = parseInt((event.target as HTMLInputElement).value, 10)
                    if (!isNaN(value)) {
                      setMinKvCacheMb(Math.max(0, Math.min(65536, value)))
                    }
                  }}
                  unit="MB"
                  unitPosition="after"
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      Minimum free KV cache headroom per GPU after placement (0 to disable)
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </>
          )}
        </Form>

        <Alert
          variant="info"
          isInline
          title={`${modelCount} model${modelCount !== 1 ? 's' : ''} will be saved`}
          style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}
        >
          The current running models and their settings will be captured.
        </Alert>
      </ModalBody>

      <ModalFooter>
        <Button
          variant="primary"
          onClick={handleSave}
          isLoading={isSaving}
          isDisabled={isSaving || !canWrite}
          title={!canWrite ? 'You do not have permission to save configurations' : undefined}
        >
          Save Configuration
        </Button>
        <Button variant="link" onClick={handleClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
