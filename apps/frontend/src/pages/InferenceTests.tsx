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
import { CubesIcon } from '@patternfly/react-icons'
import { apiClient } from '../services/api'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { useNotifications } from '../contexts/NotificationContext'
import { ModelChatCard } from '../components/inference/ModelChatCard'

function InferenceTests() {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)

  const { addNotification } = useNotifications()

  const fetchModels = useCallback(async () => {
    try {
      const response = await apiClient.listModels()
      // Filter to only show running models
      const runningModels = response.models.filter((m) => m.status === 'running')
      setModels(runningModels)
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
          {models.map((model) => (
            <GridItem key={model.id} span={12} lg={6}>
              <ModelChatCard model={model} />
            </GridItem>
          ))}
        </Grid>
      )}
    </PageSection>
  )
}

export default InferenceTests
