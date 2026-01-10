import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Card,
  CardTitle,
  CardBody,
  Progress,
  ProgressMeasureLocation,
  ProgressVariant,
  Button,
  Alert,
  Flex,
  FlexItem,
  Label,
} from '@patternfly/react-core'
import { TimesIcon } from '@patternfly/react-icons'
import { apiClient } from '../../services/api'
import { GpuMemoryPanel } from '../GpuMemoryPanel'

interface BenchmarkProgressProps {
  benchmarkId: string
  onComplete: () => void
  onCancel: () => void
}

interface ProgressData {
  phase: string
  scenarioId?: string
  currentRequest?: number
  totalRequests?: number
  completedScenarios?: number
  totalScenarios?: number
  warmupComplete?: number
  warmupTotal?: number
  inFlightRequests?: number
  message: string
}

interface RequestData {
  scenarioId: string
  ttftMs: number
  tps: number
  success: boolean
}

interface ScenarioInfo {
  modelName: string
  routingMode: string
}

interface ScenarioMetrics {
  recentRequests: RequestData[]
  avgTtft: number | null
  avgTps: number | null
  successCount: number
  failCount: number
}

/**
 * Real-time progress display during benchmark.
 * Subscribes to SSE events for live updates.
 */
export function BenchmarkProgress({ benchmarkId, onComplete, onCancel }: BenchmarkProgressProps) {
  const [phase, setPhase] = useState<string>('starting')
  // Message state kept for potential future UI display (currently commented out in JSX)
  const [_message, setMessage] = useState<string>('Initializing benchmark...')
  const [completedScenarios, setCompletedScenarios] = useState(0)
  const [totalScenarios, setTotalScenarios] = useState(0)
  const [warmupComplete, setWarmupComplete] = useState(0)
  const [warmupTotal, setWarmupTotal] = useState(0)
  const [inFlightRequests, setInFlightRequests] = useState(0)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [benchmarkMode, setBenchmarkMode] = useState<string>('isolated')

  // Scenario metadata (model names, routing modes)
  const [scenarios, setScenarios] = useState<Map<string, ScenarioInfo>>(new Map())

  // Per-scenario total requests for overall progress calculation
  const [scenarioTotals, setScenarioTotals] = useState<Map<string, number>>(new Map())

  // Per-scenario metrics tracking
  const scenarioMetricsRef = useRef<Map<string, ScenarioMetrics>>(new Map())
  const [scenarioMetrics, setScenarioMetrics] = useState<Map<string, ScenarioMetrics>>(new Map())

  const eventSourceRef = useRef<EventSource | null>(null)

  const handleCancel = async () => {
    setIsCancelling(true)
    try {
      await apiClient.deleteBenchmark(benchmarkId)
      onCancel()
    } catch (err) {
      console.error('Failed to cancel benchmark:', err)
      setError('Failed to cancel benchmark')
      setIsCancelling(false)
    }
  }

  const connectToSSE = useCallback(() => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || ''
    // Add auth token for SSE (EventSource can't send Authorization header)
    const token = apiClient.getAuthToken()
    const params = new URLSearchParams()
    if (token) {
      params.set('token', token)
    }
    const queryString = params.toString()
    const url = `${baseUrl}/api/benchmarks/${benchmarkId}/events${queryString ? `?${queryString}` : ''}`
    const eventSource = new EventSource(url)

    eventSource.onopen = () => {
      setIsConnected(true)
      setError(null)
    }

    eventSource.onerror = () => {
      setIsConnected(false)
      // Don't set error immediately - SSE will auto-reconnect
    }

    eventSource.addEventListener('progress', (event) => {
      try {
        const data = JSON.parse(event.data)
        const progressData = data.data as ProgressData | RequestData

        // Check if this is a progress event or a request event
        if ('phase' in progressData) {
          // Progress event
          setPhase(progressData.phase)
          setMessage(progressData.message)

          if (progressData.completedScenarios !== undefined) {
            setCompletedScenarios(progressData.completedScenarios)
          }
          if (progressData.totalScenarios !== undefined) {
            setTotalScenarios(progressData.totalScenarios)
          }

          // Handle warmup progress
          if (progressData.warmupComplete !== undefined) {
            setWarmupComplete(progressData.warmupComplete)
          }
          if (progressData.warmupTotal !== undefined) {
            setWarmupTotal(progressData.warmupTotal)
          }

          // Handle in-flight requests
          if (progressData.inFlightRequests !== undefined) {
            setInFlightRequests(progressData.inFlightRequests)
          }

          // Check for completion
          if (progressData.phase === 'completed' || progressData.phase === 'failed') {
            eventSource.close()
            onComplete()
          }
        } else if ('ttftMs' in progressData) {
          // Request event - update per-scenario rolling averages
          const reqData = progressData as RequestData
          const scenarioId = reqData.scenarioId

          // Get or create metrics for this scenario
          const currentMetrics = scenarioMetricsRef.current.get(scenarioId) || {
            recentRequests: [],
            avgTtft: null,
            avgTps: null,
            successCount: 0,
            failCount: 0,
          }

          // Update recent requests (keep last 10)
          const updated = [...currentMetrics.recentRequests, reqData].slice(-10)

          // Calculate rolling averages from successful requests
          const successfulReqs = updated.filter((r) => r.success)
          let avgTtft: number | null = null
          let avgTps: number | null = null
          if (successfulReqs.length > 0) {
            const ttftSum = successfulReqs.reduce((sum, r) => sum + r.ttftMs, 0)
            const tpsSum = successfulReqs.reduce((sum, r) => sum + r.tps, 0)
            avgTtft = ttftSum / successfulReqs.length
            avgTps = tpsSum / successfulReqs.length
          }

          // Update counts
          const newSuccessCount = currentMetrics.successCount + (reqData.success ? 1 : 0)
          const newFailCount = currentMetrics.failCount + (reqData.success ? 0 : 1)

          // Store updated metrics
          const newMetrics: ScenarioMetrics = {
            recentRequests: updated,
            avgTtft,
            avgTps,
            successCount: newSuccessCount,
            failCount: newFailCount,
          }
          scenarioMetricsRef.current.set(scenarioId, newMetrics)
          setScenarioMetrics(new Map(scenarioMetricsRef.current))
        }
      } catch (err) {
        console.error('Failed to parse SSE event:', err)
      }
    })

    eventSourceRef.current = eventSource
  }, [benchmarkId, onComplete])

  useEffect(() => {
    connectToSSE()

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
      }
    }
  }, [connectToSSE])

  // Fetch benchmark details to get scenario metadata (model names) and total requests
  useEffect(() => {
    apiClient
      .getBenchmark(benchmarkId)
      .then((response) => {
        const scenarioMap = new Map<string, ScenarioInfo>()
        const totalsMap = new Map<string, number>()
        // API returns snake_case fields
        const scenarioList = response.benchmark.scenarios as Array<{
          id: string
          model_name: string
          routing_mode: string
          total_requests: number
        }>
        scenarioList.forEach((s) => {
          scenarioMap.set(s.id, { modelName: s.model_name, routingMode: s.routing_mode })
          totalsMap.set(s.id, s.total_requests)
        })
        setScenarios(scenarioMap)
        setScenarioTotals(totalsMap)
        setBenchmarkMode(response.benchmark.mode)
      })
      .catch((err) => {
        console.error('Failed to fetch benchmark details:', err)
      })
  }, [benchmarkId])

  // Calculate overall progress across all scenarios
  const getOverallProgress = () => {
    // Sum all scenario total requests
    const overallTotal = Array.from(scenarioTotals.values()).reduce((sum, t) => sum + t, 0)

    // Sum completed requests from scenarioMetrics (success + fail)
    const overallCompleted = Array.from(scenarioMetrics.values()).reduce(
      (sum, m) => sum + m.successCount + m.failCount,
      0
    )

    const percent = overallTotal > 0 ? Math.round((overallCompleted / overallTotal) * 100) : 0

    return { completed: overallCompleted, total: overallTotal, percent }
  }

  const getPhaseLabel = () => {
    switch (phase) {
      case 'starting':
        return 'Starting'
      case 'warmup':
        return 'Warmup'
      case 'running':
        return 'Running'
      case 'calculating':
        return 'Calculating'
      case 'completed':
        return 'Completed'
      case 'failed':
        return 'Failed'
      default:
        return phase
    }
  }

  const getPhaseColor = (): 'blue' | 'green' | 'red' | 'orange' | 'grey' => {
    switch (phase) {
      case 'starting':
      case 'warmup':
        return 'blue'
      case 'running':
        return 'blue'
      case 'calculating':
        return 'orange'
      case 'completed':
        return 'green'
      case 'failed':
        return 'red'
      default:
        return 'grey'
    }
  }

  return (
    <>
      <Card>
        <CardTitle>
          <Flex
            justifyContent={{ default: 'justifyContentSpaceBetween' }}
            alignItems={{ default: 'alignItemsCenter' }}
          >
            <FlexItem>Benchmark Progress</FlexItem>
            <FlexItem>
              <Label color={getPhaseColor()}>{getPhaseLabel()}</Label>
            </FlexItem>
          </Flex>
        </CardTitle>
        <CardBody>
          {error && (
            <Alert
              variant="warning"
              isInline
              title="Connection issue"
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            >
              {error}
            </Alert>
          )}

          {/* Warmup progress bar - shown during warmup phase */}
          {phase === 'warmup' && warmupTotal > 0 && (
            <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
              <Progress
                value={Math.round((warmupComplete / warmupTotal) * 100)}
                title="Warmup progress"
                measureLocation={ProgressMeasureLocation.top}
                label={`Warming up: ${warmupComplete}/${warmupTotal} scenarios complete`}
              />
              {inFlightRequests > 0 && (
                <div
                  style={{
                    marginTop: 'var(--pf-t--global--spacer--sm)',
                    color: 'var(--pf-t--global--text--color--subtle)',
                  }}
                >
                  {inFlightRequests} warmup request(s) in progress...
                </div>
              )}
            </div>
          )}

          {/* Request progress bar - shown during running/calculating/completed phases */}
          {phase !== 'warmup' && (
            <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
              {(() => {
                const { completed, total, percent } = getOverallProgress()
                return (
                  <>
                    <Progress
                      value={percent}
                      title="Benchmark progress"
                      measureLocation={ProgressMeasureLocation.top}
                      label={total > 0 ? `Completed ${completed}/${total} requests` : undefined}
                      variant={phase === 'failed' ? ProgressVariant.danger : undefined}
                    />
                    {inFlightRequests > 0 && phase === 'running' && (
                      <div
                        style={{
                          marginTop: 'var(--pf-t--global--spacer--sm)',
                          color: 'var(--pf-t--global--text--color--subtle)',
                        }}
                      >
                        {inFlightRequests} request(s) in progress...
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          <div
            style={{
              marginBottom: 'var(--pf-t--global--spacer--md)',
              color: 'var(--pf-t--global--text--color--subtle)',
            }}
          >
            {!isConnected && phase !== 'completed' && phase !== 'failed' && (
              <span>(reconnecting...)</span>
            )}
          </div>

          {totalScenarios > 1 && (
            <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
              {benchmarkMode === 'contention'
                ? `${totalScenarios} scenarios running concurrently`
                : `Scenario ${completedScenarios + 1} of ${totalScenarios}`}
            </div>
          )}

          {scenarioMetrics.size > 0 && (
            <div style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
              {Array.from(scenarioMetrics.entries()).map(([scenarioId, metrics]) => {
                const scenario = scenarios.get(scenarioId)
                const label = scenario
                  ? `${scenario.modelName} (${scenario.routingMode})`
                  : scenarioId.slice(0, 8)
                return (
                  <div key={scenarioId} style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
                    <div style={{ fontWeight: 'var(--pf-t--global--font--weight--body--bold)' }}>
                      {label}
                    </div>
                    <div style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                      TTFT: {metrics.avgTtft?.toFixed(0) ?? '-'} ms | TPS:{' '}
                      {metrics.avgTps?.toFixed(1) ?? '-'} tok/s |{' '}
                      <span
                        style={{ color: 'var(--pf-t--global--color--status--success--default)' }}
                      >
                        {metrics.successCount + metrics.failCount}
                      </span>
                      /
                      <span
                        style={{
                          color:
                            metrics.failCount > 0
                              ? 'var(--pf-t--global--color--status--danger--default)'
                              : undefined,
                        }}
                      >
                        {scenarioTotals.get(scenarioId) ?? 0}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {phase !== 'completed' && phase !== 'failed' && (
            <Button
              variant="secondary"
              icon={<TimesIcon />}
              onClick={handleCancel}
              isDisabled={isCancelling}
              isLoading={isCancelling}
            >
              {isCancelling ? 'Cancelling...' : 'Cancel Benchmark'}
            </Button>
          )}
        </CardBody>
      </Card>

      {/* GPU Memory Overview - shows real-time GPU and KVCache consumption */}
      <div style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
        <GpuMemoryPanel />
      </div>
    </>
  )
}

export default BenchmarkProgress
