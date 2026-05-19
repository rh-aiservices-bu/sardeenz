import { useState, useCallback } from 'react'
import {
  PageSection,
  Content,
  Tabs,
  Tab,
  TabTitleText,
  Grid,
  GridItem,
  Button,
  Flex,
  FlexItem,
} from '@patternfly/react-core'
import { ArrowLeftIcon } from '@patternfly/react-icons'
import {
  MemoryProfilesTab,
  BenchmarkConfigForm,
  BenchmarkProgress,
  BenchmarkResultsPanel,
  BenchmarkHistoryTable,
} from '../components/benchmark'
import type { BenchmarkFormConfig, InitialBenchmarkConfig } from '../components/benchmark'
import { apiClient, extractErrorMessage } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useNotifications } from '../contexts/NotificationContext'

/** Performance tab view state machine */
type PerformanceView = 'list' | 'form' | 'running' | 'results'

/**
 * Model Benchmark page with Performance and Memory Profiles tabs.
 * Performance tab supports running benchmarks with real-time progress.
 */
function ModelBenchmark() {
  const { canWrite } = useAuth()
  const { addNotification } = useNotifications()
  const [activeTabKey, setActiveTabKey] = useState<string | number>(0)

  // Performance tab state
  const [performanceView, setPerformanceView] = useState<PerformanceView>('list')
  const [currentBenchmarkId, setCurrentBenchmarkId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [prefillConfig, setPrefillConfig] = useState<InitialBenchmarkConfig | null>(null)

  const handleTabClick = (_event: React.MouseEvent<HTMLElement>, tabIndex: string | number) => {
    setActiveTabKey(tabIndex)
  }

  const handleStartNewBenchmark = () => {
    setPrefillConfig(null)
    setPerformanceView('form')
  }

  const handleBackToList = () => {
    setPerformanceView('list')
    setCurrentBenchmarkId(null)
    setPrefillConfig(null)
    setRefreshTrigger((prev) => prev + 1)
  }

  const handleRerunBenchmark = useCallback(async (id: string) => {
    try {
      const response = await apiClient.getBenchmark(id)
      const benchmark = response.benchmark as {
        name?: string
        mode: string
        scenarios: Array<{
          model_path: string
          routing_mode: 'direct' | 'proxy'
          input_tokens: number
          output_tokens: number
          concurrency: number
          total_requests: number
        }>
      }

      // Build initial config from benchmark scenarios
      const config: InitialBenchmarkConfig = {
        name: benchmark.name ? `${benchmark.name} (rerun)` : undefined,
        mode: benchmark.mode as 'isolated' | 'contention',
        scenarios: benchmark.scenarios.map((s) => ({
          modelPath: s.model_path,
          routingMode: s.routing_mode,
          inputTokens: s.input_tokens,
          outputTokens: s.output_tokens,
          concurrency: s.concurrency,
          totalRequests: s.total_requests,
          warmupRequests: 3, // Default if not stored
        })),
      }

      setPrefillConfig(config)
      setPerformanceView('form')
    } catch (err) {
      console.error('Failed to load benchmark for rerun:', err)
    }
  }, [])

  const handleSubmitBenchmark = useCallback(
    async (config: BenchmarkFormConfig) => {
      setIsSubmitting(true)
      try {
        // Build scenarios array from selected models - parameters are now per-model
        const scenarios = config.selectedModels.map((model) => ({
          instanceId: model.instanceId,
          routingMode: model.routingMode,
          inputTokens: model.inputTokens,
          outputTokens: model.outputTokens,
          concurrency: model.concurrency,
          totalRequests: model.totalRequests,
          warmupRequests: model.warmupRequests,
          slaThresholdMs: model.slaThresholdMs,
        }))

        const response = await apiClient.createBenchmark({
          name: config.name,
          mode: config.mode,
          scenarios,
        })
        setCurrentBenchmarkId(response.benchmark.id)
        setPerformanceView('running')
      } catch (err) {
        console.error('Failed to start benchmark:', err)
        addNotification({
          title: 'Failed to start benchmark',
          description: extractErrorMessage(err),
          variant: 'danger',
        })
      } finally {
        setIsSubmitting(false)
      }
    },
    [addNotification]
  )

  const handleBenchmarkComplete = () => {
    setPerformanceView('results')
  }

  const handleBenchmarkCancel = () => {
    setPerformanceView('list')
    setCurrentBenchmarkId(null)
    setRefreshTrigger((prev) => prev + 1)
  }

  const handleViewBenchmark = (id: string) => {
    setCurrentBenchmarkId(id)
    setPerformanceView('results')
  }

  const renderPerformanceTab = () => {
    switch (performanceView) {
      case 'list':
        return (
          <>
            <Flex
              justifyContent={{ default: 'justifyContentFlexEnd' }}
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            >
              <FlexItem>
                <Button
                  variant="primary"
                  onClick={handleStartNewBenchmark}
                  isDisabled={!canWrite}
                  title={!canWrite ? 'You do not have permission to run benchmarks' : undefined}
                >
                  New Benchmark
                </Button>
              </FlexItem>
            </Flex>
            <BenchmarkHistoryTable
              onViewBenchmark={handleViewBenchmark}
              onRerunBenchmark={handleRerunBenchmark}
              refreshTrigger={refreshTrigger}
            />
          </>
        )

      case 'form':
        return (
          <>
            <Button
              variant="link"
              icon={<ArrowLeftIcon />}
              onClick={handleBackToList}
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            >
              Back to History
            </Button>
            <Grid hasGutter>
              <GridItem md={8}>
                <BenchmarkConfigForm
                  onSubmit={handleSubmitBenchmark}
                  isSubmitting={isSubmitting}
                  initialConfig={prefillConfig ?? undefined}
                />
              </GridItem>
            </Grid>
          </>
        )

      case 'running':
        return currentBenchmarkId ? (
          <Grid hasGutter>
            <GridItem md={8}>
              <BenchmarkProgress
                benchmarkId={currentBenchmarkId}
                onComplete={handleBenchmarkComplete}
                onCancel={handleBenchmarkCancel}
              />
            </GridItem>
          </Grid>
        ) : null

      case 'results':
        return currentBenchmarkId ? (
          <>
            <Button
              variant="link"
              icon={<ArrowLeftIcon />}
              onClick={handleBackToList}
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            >
              Back to History
            </Button>
            <BenchmarkResultsPanel
              benchmarkId={currentBenchmarkId}
              onRerun={() => handleRerunBenchmark(currentBenchmarkId)}
            />
          </>
        ) : null
    }
  }

  return (
    <PageSection hasShadowBottom>
      <Content component="h1" style={{ marginBottom: 'var(--pf-t--global--spacer--lg)' }}>
        Model Benchmark
      </Content>

      <Tabs activeKey={activeTabKey} onSelect={handleTabClick} aria-label="Benchmark tabs">
        <Tab
          eventKey={0}
          title={<TabTitleText>Performance</TabTitleText>}
          aria-label="Performance benchmarking"
        >
          <div style={{ paddingTop: 'var(--pf-t--global--spacer--md)' }}>
            {renderPerformanceTab()}
          </div>
        </Tab>
        <Tab
          eventKey={1}
          title={<TabTitleText>Memory Profiles</TabTitleText>}
          aria-label="Memory profiles for capacity planning"
        >
          <div style={{ paddingTop: 'var(--pf-t--global--spacer--md)' }}>
            <MemoryProfilesTab />
          </div>
        </Tab>
      </Tabs>
    </PageSection>
  )
}

export default ModelBenchmark
