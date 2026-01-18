import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardTitle,
  CardBody,
  Grid,
  GridItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Alert,
  Spinner,
  Label,
  Flex,
  FlexItem,
  Tabs,
  Tab,
  TabTitleText,
  Button,
  Dropdown,
  DropdownItem,
  DropdownList,
  MenuToggle,
} from '@patternfly/react-core'
import { ExportIcon, RedoIcon } from '@patternfly/react-icons'
import { ResponsiveBar } from '@nivo/bar'
import { apiClient, extractErrorMessage, type BenchmarkSummary } from '../../services/api'

interface BenchmarkResultsPanelProps {
  benchmarkId: string
  /** Callback to trigger rerunning this benchmark configuration */
  onRerun?: () => void
}

interface ScenarioMetrics {
  scenario_id: string
  model_path: string
  model_name: string
  ttft_p50?: number
  ttft_p90?: number
  ttft_p99?: number
  tps_p50?: number
  tps_p90?: number
  tps_p99?: number
  e2e_p50?: number
  e2e_p90?: number
  e2e_p99?: number
  goodput_percent?: number
  total_requests: number
  successful_requests: number
  failed_requests: number
  requests_per_second?: number
}

interface BenchmarkDetails extends BenchmarkSummary {
  scenarios: Array<{
    id: string
    model_path: string
    model_name: string
    routing_mode: 'direct' | 'proxy'
    input_tokens: number
    output_tokens: number
    concurrency: number
    total_requests: number
    status: string
    metrics?: ScenarioMetrics
  }>
}

/**
 * Display benchmark results with summary cards and charts.
 * Uses Nivo charts for visualization.
 */
export function BenchmarkResultsPanel({ benchmarkId, onRerun }: BenchmarkResultsPanelProps) {
  const [benchmark, setBenchmark] = useState<BenchmarkDetails | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeChartTab, setActiveChartTab] = useState<string | number>(0)
  const [isExportOpen, setIsExportOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = useCallback(
    async (format: 'csv' | 'json') => {
      setIsExportOpen(false)
      setIsExporting(true)
      try {
        const blob = await apiClient.exportBenchmark(benchmarkId, format)
        const name = benchmark?.name || benchmarkId.slice(0, 8)
        const filename = `benchmark-${name}-${new Date().toISOString().slice(0, 10)}.${format}`

        // Create download link
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } catch (err) {
        console.error('Export failed:', err)
      } finally {
        setIsExporting(false)
      }
    },
    [benchmarkId, benchmark?.name]
  )

  useEffect(() => {
    const fetchBenchmark = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const response = await apiClient.getBenchmark(benchmarkId)
        setBenchmark(response.benchmark as BenchmarkDetails)
      } catch (err) {
        console.error('Failed to fetch benchmark:', err)
        setError(extractErrorMessage(err))
      } finally {
        setIsLoading(false)
      }
    }

    fetchBenchmark()
  }, [benchmarkId])

  if (isLoading) {
    return (
      <Card>
        <CardBody>
          <Flex justifyContent={{ default: 'justifyContentCenter' }}>
            <Spinner size="lg" />
          </Flex>
        </CardBody>
      </Card>
    )
  }

  if (error) {
    return (
      <Alert variant="danger" isInline title="Failed to load results">
        {error}
      </Alert>
    )
  }

  if (!benchmark) {
    return (
      <Alert variant="info" isInline title="No data">
        Benchmark data not available.
      </Alert>
    )
  }

  const scenariosWithMetrics = benchmark.scenarios.filter((s) => s.metrics)

  // Prepare chart data - include routing mode suffix and handle duplicates
  // Pre-compute unique labels to handle same model with same routing mode
  const labelCounts = new Map<string, number>()
  const scenarioLabels = scenariosWithMetrics.map((s) => {
    const baseName = s.model_name || s.model_path.split('/').pop() || 'Unknown'
    const suffix = s.routing_mode === 'proxy' ? ' (proxy)' : ' (direct)'
    const baseLabel = baseName + suffix

    const count = (labelCounts.get(baseLabel) || 0) + 1
    labelCounts.set(baseLabel, count)

    return count > 1 ? `${baseLabel} (${count})` : baseLabel
  })

  const ttftChartData = scenariosWithMetrics.map((s, i) => ({
    model: scenarioLabels[i],
    P50: s.metrics?.ttft_p50 ?? 0,
    P90: s.metrics?.ttft_p90 ?? 0,
    P99: s.metrics?.ttft_p99 ?? 0,
  }))

  const tpsChartData = scenariosWithMetrics.map((s, i) => ({
    model: scenarioLabels[i],
    P50: s.metrics?.tps_p50 ?? 0,
    P90: s.metrics?.tps_p90 ?? 0,
    P99: s.metrics?.tps_p99 ?? 0,
  }))

  const goodputChartData = scenariosWithMetrics.map((s, i) => ({
    model: scenarioLabels[i],
    Goodput: s.metrics?.goodput_percent ?? 0,
  }))

  // Only show Goodput tab if at least one scenario has SLA threshold configured
  const hasGoodputData = scenariosWithMetrics.some(
    (s) => s.metrics?.goodput_percent !== undefined && s.metrics?.goodput_percent !== null
  )

  const getStatusColor = (): 'green' | 'red' | 'blue' | 'orange' => {
    switch (benchmark.status) {
      case 'completed':
        return 'green'
      case 'failed':
      case 'cancelled':
        return 'red'
      case 'running':
        return 'blue'
      default:
        return 'orange'
    }
  }

  const formatDuration = (seconds?: number) => {
    if (seconds === undefined) return '-'
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}m ${secs.toFixed(0)}s`
  }

  const successRate = benchmark.total_requests
    ? (((benchmark.successful_requests ?? 0) / benchmark.total_requests) * 100).toFixed(1)
    : '-'

  return (
    <div>
      {/* Action Buttons */}
      <Flex
        justifyContent={{ default: 'justifyContentFlexEnd' }}
        style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
      >
        {onRerun && (
          <FlexItem>
            <Button variant="secondary" icon={<RedoIcon />} onClick={onRerun}>
              Rerun Configuration
            </Button>
          </FlexItem>
        )}
        <FlexItem>
          <Dropdown
            isOpen={isExportOpen}
            onSelect={() => setIsExportOpen(false)}
            onOpenChange={(isOpen) => setIsExportOpen(isOpen)}
            toggle={(toggleRef) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsExportOpen(!isExportOpen)}
                isExpanded={isExportOpen}
                isDisabled={isExporting}
                icon={<ExportIcon />}
              >
                {isExporting ? 'Exporting...' : 'Export'}
              </MenuToggle>
            )}
          >
            <DropdownList>
              <DropdownItem key="csv" onClick={() => handleExport('csv')}>
                Export as CSV
              </DropdownItem>
              <DropdownItem key="json" onClick={() => handleExport('json')}>
                Export as JSON
              </DropdownItem>
            </DropdownList>
          </Dropdown>
        </FlexItem>
      </Flex>

      {/* Summary Cards */}
      <Grid hasGutter style={{ marginBottom: 'var(--pf-t--global--spacer--lg)' }}>
        <GridItem md={3}>
          <Card isCompact>
            <CardBody>
              <DescriptionList isCompact>
                <DescriptionListGroup>
                  <DescriptionListTerm>Status</DescriptionListTerm>
                  <DescriptionListDescription>
                    <Label color={getStatusColor()}>{benchmark.status}</Label>
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </GridItem>
        <GridItem md={3}>
          <Card isCompact>
            <CardBody>
              <DescriptionList isCompact>
                <DescriptionListGroup>
                  <DescriptionListTerm>Duration</DescriptionListTerm>
                  <DescriptionListDescription>
                    {formatDuration(benchmark.duration_seconds)}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </GridItem>
        <GridItem md={3}>
          <Card isCompact>
            <CardBody>
              <DescriptionList isCompact>
                <DescriptionListGroup>
                  <DescriptionListTerm>Success Rate</DescriptionListTerm>
                  <DescriptionListDescription>{successRate}%</DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </GridItem>
        <GridItem md={3}>
          <Card isCompact>
            <CardBody>
              <DescriptionList isCompact>
                <DescriptionListGroup>
                  <DescriptionListTerm>Total Requests</DescriptionListTerm>
                  <DescriptionListDescription>
                    {benchmark.successful_requests ?? 0} / {benchmark.total_requests ?? 0}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </GridItem>
      </Grid>

      {/* Charts */}
      {scenariosWithMetrics.length > 0 && (
        <Card>
          <CardTitle>Performance Metrics</CardTitle>
          <CardBody>
            <Tabs
              activeKey={activeChartTab}
              onSelect={(_event, tabIndex) => setActiveChartTab(tabIndex)}
            >
              <Tab eventKey={0} title={<TabTitleText>TTFT (ms)</TabTitleText>}>
                <div style={{ height: 300, marginTop: 'var(--pf-t--global--spacer--md)' }}>
                  <ResponsiveBar
                    data={ttftChartData}
                    keys={['P50', 'P90', 'P99']}
                    indexBy="model"
                    margin={{ top: 20, right: 130, bottom: 50, left: 60 }}
                    padding={0.3}
                    groupMode="grouped"
                    colors={{ scheme: 'nivo' }}
                    axisBottom={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: 'Model',
                      legendPosition: 'middle',
                      legendOffset: 40,
                    }}
                    axisLeft={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: 'Time to First Token (ms)',
                      legendPosition: 'middle',
                      legendOffset: -50,
                    }}
                    legends={[
                      {
                        dataFrom: 'keys',
                        anchor: 'bottom-right',
                        direction: 'column',
                        justify: false,
                        translateX: 120,
                        translateY: 0,
                        itemsSpacing: 2,
                        itemWidth: 100,
                        itemHeight: 20,
                        itemDirection: 'left-to-right',
                        symbolSize: 20,
                      },
                    ]}
                    animate={true}
                    enableLabel={false}
                    valueFormat=",.0f"
                  />
                </div>
              </Tab>
              <Tab eventKey={1} title={<TabTitleText>TPS (tokens/s)</TabTitleText>}>
                <div style={{ height: 300, marginTop: 'var(--pf-t--global--spacer--md)' }}>
                  <ResponsiveBar
                    data={tpsChartData}
                    keys={['P50', 'P90', 'P99']}
                    indexBy="model"
                    margin={{ top: 20, right: 130, bottom: 50, left: 60 }}
                    padding={0.3}
                    groupMode="grouped"
                    colors={{ scheme: 'nivo' }}
                    axisBottom={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: 'Model',
                      legendPosition: 'middle',
                      legendOffset: 40,
                    }}
                    axisLeft={{
                      tickSize: 5,
                      tickPadding: 5,
                      tickRotation: 0,
                      legend: 'Tokens per Second',
                      legendPosition: 'middle',
                      legendOffset: -50,
                    }}
                    legends={[
                      {
                        dataFrom: 'keys',
                        anchor: 'bottom-right',
                        direction: 'column',
                        justify: false,
                        translateX: 120,
                        translateY: 0,
                        itemsSpacing: 2,
                        itemWidth: 100,
                        itemHeight: 20,
                        itemDirection: 'left-to-right',
                        symbolSize: 20,
                      },
                    ]}
                    animate={true}
                    enableLabel={false}
                    valueFormat=",.1f"
                  />
                </div>
              </Tab>
              {hasGoodputData && (
                <Tab eventKey={2} title={<TabTitleText>Goodput (%)</TabTitleText>}>
                  <div style={{ height: 300, marginTop: 'var(--pf-t--global--spacer--md)' }}>
                    <ResponsiveBar
                      data={goodputChartData}
                      keys={['Goodput']}
                      indexBy="model"
                      margin={{ top: 20, right: 60, bottom: 50, left: 60 }}
                      padding={0.3}
                      colors={{ scheme: 'nivo' }}
                      valueScale={{ type: 'linear', max: 100 }}
                      axisBottom={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Model',
                        legendPosition: 'middle',
                        legendOffset: 40,
                      }}
                      axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: 'Goodput (%)',
                        legendPosition: 'middle',
                        legendOffset: -50,
                      }}
                      animate={true}
                      label={(d) => `${d.value}%`}
                    />
                  </div>
                </Tab>
              )}
            </Tabs>
          </CardBody>
        </Card>
      )}

      {/* Per-Scenario Details */}
      <Card style={{ marginTop: 'var(--pf-t--global--spacer--lg)' }}>
        <CardTitle>Scenario Details</CardTitle>
        <CardBody>
          {benchmark.scenarios.map((scenario) => (
            <div
              key={scenario.id}
              style={{
                padding: 'var(--pf-t--global--spacer--md)',
                borderBottom: '1px solid var(--pf-t--global--border--color--default)',
              }}
            >
              <Flex
                justifyContent={{ default: 'justifyContentSpaceBetween' }}
                alignItems={{ default: 'alignItemsCenter' }}
              >
                <FlexItem>
                  <strong>{scenario.model_name || scenario.model_path}</strong>
                  <span
                    style={{
                      marginLeft: 'var(--pf-t--global--spacer--sm)',
                      color: 'var(--pf-t--global--text--color--subtle)',
                    }}
                  >
                    {scenario.input_tokens} input / {scenario.output_tokens} output tokens,
                    concurrency {scenario.concurrency}
                  </span>
                </FlexItem>
                <FlexItem>
                  <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                    <FlexItem>
                      <Label
                        color={scenario.routing_mode === 'proxy' ? 'purple' : 'teal'}
                        isCompact
                      >
                        {scenario.routing_mode === 'proxy' ? 'Proxy' : 'Direct'}
                      </Label>
                    </FlexItem>
                    <FlexItem>
                      <Label
                        color={
                          scenario.status === 'completed'
                            ? 'green'
                            : scenario.status === 'failed'
                              ? 'red'
                              : 'blue'
                        }
                      >
                        {scenario.status}
                      </Label>
                    </FlexItem>
                  </Flex>
                </FlexItem>
              </Flex>
              {scenario.metrics && (
                <DescriptionList
                  isHorizontal
                  isCompact
                  style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}
                >
                  <DescriptionListGroup>
                    <DescriptionListTerm>TTFT P50/P90/P99</DescriptionListTerm>
                    <DescriptionListDescription>
                      {scenario.metrics.ttft_p50?.toFixed(0) ?? '-'} /{' '}
                      {scenario.metrics.ttft_p90?.toFixed(0) ?? '-'} /{' '}
                      {scenario.metrics.ttft_p99?.toFixed(0) ?? '-'} ms
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>TPS P50/P90/P99</DescriptionListTerm>
                    <DescriptionListDescription>
                      {scenario.metrics.tps_p50?.toFixed(1) ?? '-'} /{' '}
                      {scenario.metrics.tps_p90?.toFixed(1) ?? '-'} /{' '}
                      {scenario.metrics.tps_p99?.toFixed(1) ?? '-'} tokens/s
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Requests</DescriptionListTerm>
                    <DescriptionListDescription>
                      {scenario.metrics.successful_requests} / {scenario.metrics.total_requests}{' '}
                      successful
                      {scenario.metrics.requests_per_second &&
                        ` (${scenario.metrics.requests_per_second.toFixed(1)} req/s)`}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              )}
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}

export default BenchmarkResultsPanel
