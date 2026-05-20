import { useState, useEffect, useCallback } from 'react'
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Spinner,
  Alert,
  DataList,
  DataListItem,
  DataListItemRow,
  DataListItemCells,
  DataListCell,
  DataListAction,
  EmptyState,
  EmptyStateBody,
  Label,
  Flex,
  FlexItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  ExpandableSection,
} from '@patternfly/react-core'
import { TrashIcon, UploadIcon } from '@patternfly/react-icons'
import {
  apiClient,
  extractErrorMessage,
  type SavedModelConfigurationResponse,
} from '../services/api'
import { useAuth } from '../contexts/AuthContext'

export interface ConfigLoadStartedInfo {
  message: string
  configurationId: string
  configurationName: string
  expectedModelCount: number
  skippedPods?: string[]
}

interface LoadConfigurationDialogProps {
  isOpen: boolean
  onClose: () => void
  onLoadStarted: (info: ConfigLoadStartedInfo) => void
  currentModelCount: number
}

/**
 * Dialog for loading a saved model configuration.
 * Lists all saved configurations and allows selecting one to load.
 */
export function LoadConfigurationDialog({
  isOpen,
  onClose,
  onLoadStarted,
  currentModelCount,
}: LoadConfigurationDialogProps) {
  const { canWrite } = useAuth()
  const [configurations, setConfigurations] = useState<SavedModelConfigurationResponse[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedConfig, setSelectedConfig] = useState<SavedModelConfigurationResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoadingDetails, setIsLoadingDetails] = useState(false)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)
  const [isLoadingConfig, setIsLoadingConfig] = useState(false)
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(true)

  const fetchConfigurations = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiClient.listConfigurations()
      setConfigurations(response.configurations)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      fetchConfigurations()
      setSelectedConfig(null)
    }
  }, [isOpen, fetchConfigurations])

  const handleSelectConfig = async (config: SavedModelConfigurationResponse) => {
    setIsLoadingDetails(true)
    setError(null)
    try {
      const response = await apiClient.getConfiguration(config.id)
      setSelectedConfig(response.configuration)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsLoadingDetails(false)
    }
  }

  const handleDeleteConfig = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeleting(id)
    setError(null)
    try {
      await apiClient.deleteConfiguration(id)
      setConfigurations((prev) => prev.filter((c) => c.id !== id))
      if (selectedConfig?.id === id) setSelectedConfig(null)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsDeleting(null)
    }
  }

  const handleLoadConfig = async () => {
    if (!selectedConfig) return
    setIsLoadingConfig(true)
    setError(null)
    try {
      const response = await apiClient.loadConfiguration(selectedConfig.id)
      onLoadStarted({
        message: response.message,
        configurationId: response.configuration_id,
        configurationName: response.configuration_name,
        expectedModelCount: response.loaded_model_count ?? selectedConfig.entries?.length ?? 0,
        skippedPods: response.skipped_pods,
      })
      onClose()
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsLoadingConfig(false)
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <Modal
      variant={ModalVariant.large}
      isOpen={isOpen}
      onClose={onClose}
      aria-labelledby="load-config-modal-title"
      aria-describedby="load-config-modal-body"
    >
      <ModalHeader title="Load Configuration" labelId="load-config-modal-title" />
      <ModalBody id="load-config-modal-body">
        {error && (
          <Alert
            variant="danger"
            isInline
            title="Error"
            actionClose={<Button variant="plain" onClick={() => setError(null)} />}
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            {error}
          </Alert>
        )}

        {currentModelCount > 0 && (
          <Alert
            variant="warning"
            isInline
            title="Current models will be unloaded"
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            Loading a configuration will unload all {currentModelCount} currently running model(s)
            first.
          </Alert>
        )}

        {isLoading ? (
          <Flex justifyContent={{ default: 'justifyContentCenter' }}>
            <FlexItem>
              <Spinner aria-label="Loading configurations" />
            </FlexItem>
          </Flex>
        ) : configurations.length === 0 ? (
          <EmptyState titleText="No saved configurations" headingLevel="h4">
            <EmptyStateBody>
              Save your current model setup to create a configuration.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Flex direction={{ default: 'column' }} gap={{ default: 'gapMd' }}>
            <FlexItem>
              <DataList aria-label="Saved configurations" isCompact>
                {configurations.map((config) => (
                  <DataListItem key={config.id} aria-labelledby={`config-${config.id}`}>
                    <DataListItemRow>
                      <DataListItemCells
                        dataListCells={[
                          <DataListCell key="name" width={3}>
                            <Flex
                              alignItems={{ default: 'alignItemsCenter' }}
                              gap={{ default: 'gapSm' }}
                            >
                              <FlexItem>
                                <strong id={`config-${config.id}`}>{config.name}</strong>
                              </FlexItem>
                              <FlexItem>
                                <Label isCompact>{config.model_count} models</Label>
                              </FlexItem>
                            </Flex>
                            {config.description && (
                              <div
                                style={{
                                  color: 'var(--pf-t--global--text--color--subtle)',
                                  marginTop: 'var(--pf-t--global--spacer--xs)',
                                }}
                              >
                                {config.description}
                              </div>
                            )}
                          </DataListCell>,
                          <DataListCell key="date" width={2}>
                            {formatDate(config.created_at)}
                          </DataListCell>,
                        ]}
                      />
                      <DataListAction
                        aria-label="Actions"
                        id={`action-${config.id}`}
                        aria-labelledby={`config-${config.id} action-${config.id}`}
                      >
                        <Button
                          variant="secondary"
                          onClick={() => handleSelectConfig(config)}
                          isDisabled={isLoadingDetails}
                          isLoading={isLoadingDetails && selectedConfig?.id === config.id}
                        >
                          Select
                        </Button>
                        <Button
                          variant="plain"
                          aria-label={`Delete ${config.name}`}
                          onClick={(e) => handleDeleteConfig(config.id, e)}
                          isLoading={isDeleting === config.id}
                          isDisabled={isDeleting !== null || !canWrite}
                          title={
                            !canWrite
                              ? 'You do not have permission to delete configurations'
                              : undefined
                          }
                        >
                          <TrashIcon />
                        </Button>
                      </DataListAction>
                    </DataListItemRow>
                  </DataListItem>
                ))}
              </DataList>
            </FlexItem>

            {selectedConfig && selectedConfig.entries && (
              <FlexItem>
                <ExpandableSection
                  toggleText={`Configuration Details: ${selectedConfig.name}`}
                  isExpanded={isDetailsExpanded}
                  onToggle={(_e, expanded) => setIsDetailsExpanded(expanded)}
                >
                  <DescriptionList isHorizontal isCompact>
                    {selectedConfig.entries.map((entry, idx) => (
                      <DescriptionListGroup key={entry.id}>
                        <DescriptionListTerm>Model {idx + 1}</DescriptionListTerm>
                        <DescriptionListDescription>
                          <div>
                            <strong>{entry.model_path}</strong>
                          </div>
                          <div>Max Tokens: {entry.max_tokens}</div>
                          {entry.pod_id && (
                            <div>Pod: {entry.pod_id}</div>
                          )}
                          {entry.gpu_ids && entry.gpu_ids.length > 0 && (
                            <div>GPUs: {entry.gpu_ids.join(', ')}</div>
                          )}
                          {entry.tensor_parallel_size > 1 && (
                            <div>Tensor Parallel: {entry.tensor_parallel_size}</div>
                          )}
                        </DescriptionListDescription>
                      </DescriptionListGroup>
                    ))}
                  </DescriptionList>
                </ExpandableSection>
              </FlexItem>
            )}
          </Flex>
        )}
      </ModalBody>

      <ModalFooter>
        <Button
          variant="primary"
          icon={<UploadIcon />}
          onClick={handleLoadConfig}
          isLoading={isLoadingConfig}
          isDisabled={!selectedConfig || isLoadingConfig || !canWrite}
          title={!canWrite ? 'You do not have permission to load configurations' : undefined}
        >
          Load Configuration
        </Button>
        <Button variant="link" onClick={onClose}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  )
}
