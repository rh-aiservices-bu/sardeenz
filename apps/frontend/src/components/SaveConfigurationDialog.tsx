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
} from '@patternfly/react-core'
import { apiClient, extractErrorMessage } from '../services/api'
import { useAuth } from '../contexts/AuthContext'

interface SaveConfigurationDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  modelCount: number
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
}: SaveConfigurationDialogProps) {
  const { canWrite } = useAuth()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
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
