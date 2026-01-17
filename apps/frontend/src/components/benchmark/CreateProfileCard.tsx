import { useState, useEffect } from 'react'
import {
  Card,
  CardTitle,
  CardBody,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  FormHelperText,
  HelperText,
  HelperTextItem,
  TextInput,
  TextArea,
  Button,
  Alert,
  Flex,
  FlexItem,
} from '@patternfly/react-core'
import { apiClient, extractErrorMessage } from '../../services/api'
import type { ModelInstanceDTO } from '@sardeenz/types'

interface CreateProfileCardProps {
  onProfileCreated: () => void
}

/**
 * Card component for capturing memory profile from a running model.
 * Follows PatternFly 6 patterns.
 */
export function CreateProfileCard({ onProfileCreated }: CreateProfileCardProps) {
  const [runningInstances, setRunningInstances] = useState<ModelInstanceDTO[]>([])
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>('')
  const [profileName, setProfileName] = useState<string>('')
  const [comments, setComments] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Fetch running model instances
  useEffect(() => {
    const fetchInstances = async () => {
      setIsLoading(true)
      try {
        const response = await apiClient.listModels()
        const running = response.models.filter((m) => m.status === 'running')
        setRunningInstances(running)
        if (running.length > 0 && !selectedInstanceId) {
          setSelectedInstanceId(running[0].id)
        }
      } catch (err) {
        console.error('Failed to fetch models:', err)
        setError(extractErrorMessage(err))
      } finally {
        setIsLoading(false)
      }
    }

    fetchInstances()
  }, [])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedInstanceId) {
      setError('Please select a running model')
      return
    }

    setIsSubmitting(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await apiClient.createMemoryProfile({
        instance_id: selectedInstanceId,
        profile_name: profileName || undefined,
        comments: comments || undefined,
      })

      setSuccess(`Profile "${response.profile.profile_name}" created successfully`)
      setProfileName('')
      setComments('')
      onProfileCreated()
    } catch (err) {
      console.error('Failed to create profile:', err)
      setError(extractErrorMessage(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  const selectedInstance = runningInstances.find((m) => m.id === selectedInstanceId)

  return (
    <Card>
      <CardTitle>Capture Memory Profile</CardTitle>
      <CardBody>
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
        {success && (
          <Alert
            variant="success"
            isInline
            title="Success"
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            {success}
          </Alert>
        )}

        <Form onSubmit={handleSubmit}>
          <FormGroup label="Running Model" isRequired fieldId="instance-select">
            <FormSelect
              id="instance-select"
              value={selectedInstanceId}
              onChange={(_event, value) => setSelectedInstanceId(value)}
              aria-label="Select running model"
              isDisabled={isLoading || runningInstances.length === 0}
            >
              {runningInstances.length === 0 ? (
                <FormSelectOption
                  value=""
                  label={isLoading ? 'Loading...' : 'No running models available'}
                  isDisabled
                />
              ) : (
                runningInstances.map((instance) => (
                  <FormSelectOption
                    key={instance.id}
                    value={instance.id}
                    label={`${instance.model_path} (${instance.max_tokens} tokens)`}
                  />
                ))
              )}
            </FormSelect>
          </FormGroup>

          {selectedInstance && (
            <FormGroup label="Model Details" fieldId="model-details">
              <div style={{ fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                <strong>Max Tokens:</strong> {selectedInstance.max_tokens} | <strong>Port:</strong>{' '}
                {selectedInstance.port}
              </div>
            </FormGroup>
          )}

          <FormGroup label="Profile Name" fieldId="profile-name">
            <TextInput
              id="profile-name"
              value={profileName}
              onChange={(_event, value) => setProfileName(value)}
              placeholder="e.g., Production SmolLM @ 4096"
              aria-label="Profile name"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>Optional. Auto-generated if not provided.</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <FormGroup label="Comments" fieldId="comments">
            <TextArea
              id="comments"
              value={comments}
              onChange={(_event, value) => setComments(value)}
              placeholder="e.g., Baseline profile for capacity planning"
              aria-label="Comments"
              resizeOrientation="vertical"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>Optional notes about this profile.</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>

          <Flex>
            <FlexItem>
              <Button
                type="submit"
                variant="primary"
                isDisabled={!selectedInstanceId || isSubmitting}
                isLoading={isSubmitting}
              >
                {isSubmitting ? 'Capturing...' : 'Capture Profile'}
              </Button>
            </FlexItem>
          </Flex>
        </Form>
      </CardBody>
    </Card>
  )
}

export default CreateProfileCard
