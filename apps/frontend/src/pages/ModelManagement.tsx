import { useCallback, useEffect, useState } from 'react'
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
} from '@patternfly/react-core'
import { PlusCircleIcon, CubesIcon } from '@patternfly/react-icons'
import { apiClient } from '../services/api'
import type { ModelInstanceDTO, LoadModelRequest } from '@sardeenz/types'
import { ModelCard, LoadModelDialog } from '../components'
import { useNotifications } from '../contexts/NotificationContext'

function ModelManagement() {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [isLoadModalOpen, setIsLoadModalOpen] = useState(false)

  const { addNotification } = useNotifications()

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

  const handleUnloadModel = async (modelPath: string) => {
    try {
      await apiClient.unloadModel(modelPath)
      addNotification({
        title: 'Model unloaded',
        description: `Successfully unloaded: ${modelPath}`,
        variant: 'success',
      })
      await fetchModels()
    } catch (err) {
      addNotification({
        title: 'Failed to unload model',
        description: err instanceof Error ? err.message : 'Unknown error',
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
    <>
      <PageSection>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Content component="h1">Model Management</Content>
          </FlexItem>
          <FlexItem>
            <Button
              variant="primary"
              icon={<PlusCircleIcon />}
              onClick={() => setIsLoadModalOpen(true)}
            >
              Load Model
            </Button>
          </FlexItem>
        </Flex>

        {models.length === 0 ? (
          <Card style={{ marginTop: 'var(--pf-t--global--spacer--xl)' }}>
            <CardBody>
              <EmptyState titleText="No models loaded" icon={CubesIcon}>
                <EmptyStateBody>Load a model to get started with inference.</EmptyStateBody>
                <EmptyStateFooter>
                  <EmptyStateActions>
                    <Button
                      variant="primary"
                      onClick={() => setIsLoadModalOpen(true)}
                      icon={<PlusCircleIcon />}
                    >
                      Load Model
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
                <ModelCard model={model} onUnload={handleUnloadModel} />
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
    </>
  )
}

export default ModelManagement
