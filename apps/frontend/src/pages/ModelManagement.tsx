import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  PageSection,
  Content,
  Grid,
  GridItem,
  Card,
  CardBody,
  Button,
  Spinner,
  EmptyState,
  EmptyStateBody,
  EmptyStateActions,
  EmptyStateFooter,
  Flex,
  FlexItem,
  ClipboardCopy,
  ClipboardCopyVariant,
} from '@patternfly/react-core'
import { PlusCircleIcon, CubesIcon, SaveIcon, UploadIcon } from '@patternfly/react-icons'
import { apiClient } from '../services/api'
import type { ModelInstanceDTO, LoadModelRequest } from '@sardeenz/types'
import {
  ModelCard,
  LoadModelDialog,
  GpuMemoryPanel,
  SaveConfigurationDialog,
  LoadConfigurationDialog,
} from '../components'
import { useNotifications } from '../contexts/NotificationContext'

function ModelManagement() {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)
  const [unloadingInstanceId, setUnloadingInstanceId] = useState<string | null>(null)
  const [isSaveConfigOpen, setIsSaveConfigOpen] = useState(false)
  const [isLoadConfigOpen, setIsLoadConfigOpen] = useState(false)

  const { addNotification } = useNotifications()

  // Count running models for configuration save
  const runningModelCount = useMemo(
    () => models.filter((m) => m.status === 'running').length,
    [models]
  )

  const inferenceUrl = useMemo(() => `${window.location.origin}/v1`, [])

  const fetchModels = useCallback(async () => {
    try {
      const response = await apiClient.listModels()
      setModels(response.models)
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

  const handleLoadModel = async (request: LoadModelRequest) => {
    // Start the load and return instance_id for SSE subscription
    // The LoadModelDialog handles the loading state and success/failure
    const result = await apiClient.loadModel(request)
    return { instance_id: result.instance_id }
  }

  const handleLoadSuccess = () => {
    // Refresh the model list when a model is successfully loaded
    fetchModels()
    addNotification({
      title: 'Model loaded',
      description: 'Model is now ready for inference',
      variant: 'success',
    })
  }

  const handleUnloadModel = async (instanceId: string, modelPath: string, isFailed: boolean) => {
    setUnloadingInstanceId(instanceId)
    try {
      await apiClient.unloadModelByInstanceId(instanceId)
      addNotification({
        title: isFailed ? 'Model removed' : 'Model unloaded',
        description: isFailed
          ? `Successfully removed: ${modelPath}`
          : `Successfully unloaded: ${modelPath}`,
        variant: 'success',
      })
      await fetchModels()
    } catch (err) {
      addNotification({
        title: isFailed ? 'Failed to remove model' : 'Failed to unload model',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'danger',
      })
    } finally {
      setUnloadingInstanceId(null)
    }
  }

  const handleConfigSaved = () => {
    addNotification({
      title: 'Configuration saved',
      description: 'Model configuration saved successfully',
      variant: 'success',
    })
  }

  const handleConfigLoadStarted = (message: string) => {
    addNotification({
      title: 'Loading configuration',
      description: message,
      variant: 'info',
    })
    // Refresh models list after a delay to show updated state
    setTimeout(fetchModels, 2000)
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
    <>
      <PageSection>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Content component="h1">Model Placement Management</Content>
            <Content component="p" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              Inference URL:{' '}
              <ClipboardCopy
                isReadOnly
                hoverTip="Copy"
                clickTip="Copied"
                variant={ClipboardCopyVariant.inline}
              >
                {inferenceUrl}
              </ClipboardCopy>
            </Content>
          </FlexItem>
          <FlexItem>
            <Flex gap={{ default: 'gapSm' }}>
              <FlexItem>
                <Button
                  variant="secondary"
                  icon={<SaveIcon />}
                  onClick={() => setIsSaveConfigOpen(true)}
                  isDisabled={runningModelCount === 0}
                >
                  Save Config
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="secondary"
                  icon={<UploadIcon />}
                  onClick={() => setIsLoadConfigOpen(true)}
                >
                  Load Config
                </Button>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="primary"
                  icon={<PlusCircleIcon />}
                  onClick={() => setIsLoadModalOpen(true)}
                >
                  Start Model
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>

        {/* GPU Memory Overview Panel */}
        <div style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
          <GpuMemoryPanel />
        </div>

        {models.length === 0 ? (
          <Card style={{ marginTop: 'var(--pf-t--global--spacer--xl)' }}>
            <CardBody>
              <EmptyState titleText="No models started" icon={CubesIcon}>
                <EmptyStateBody>Start a model to get started with inference.</EmptyStateBody>
                <EmptyStateFooter>
                  <EmptyStateActions>
                    <Button
                      variant="primary"
                      onClick={() => setIsLoadModalOpen(true)}
                      icon={<PlusCircleIcon />}
                    >
                      Start Model
                    </Button>
                  </EmptyStateActions>
                </EmptyStateFooter>
              </EmptyState>
            </CardBody>
          </Card>
        ) : (
          <Grid hasGutter style={{ marginTop: 'var(--pf-t--global--spacer--xl)' }}>
            {models.map((model) => (
              <GridItem key={model.id} span={12} lg={6} xl={4}>
                <ModelCard
                  model={model}
                  onUnload={handleUnloadModel}
                  isUnloading={unloadingInstanceId === model.id}
                />
              </GridItem>
            ))}
          </Grid>
        )}
      </PageSection>

      <LoadModelDialog
        isOpen={isLoadModalOpen}
        onClose={() => setIsLoadModalOpen(false)}
        onLoad={handleLoadModel}
        onSuccess={handleLoadSuccess}
      />

      <SaveConfigurationDialog
        isOpen={isSaveConfigOpen}
        onClose={() => setIsSaveConfigOpen(false)}
        onSuccess={handleConfigSaved}
        modelCount={runningModelCount}
      />

      <LoadConfigurationDialog
        isOpen={isLoadConfigOpen}
        onClose={() => setIsLoadConfigOpen(false)}
        onLoadStarted={handleConfigLoadStarted}
        currentModelCount={runningModelCount}
      />
    </>
  )
}

export default ModelManagement
