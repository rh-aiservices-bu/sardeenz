import { useCallback, useEffect, useState, useRef } from 'react'
import {
  PageSection,
  Content,
  Card,
  CardTitle,
  CardBody,
  Grid,
  GridItem,
  Button,
  Spinner,
  Flex,
  FlexItem,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Progress,
  ProgressMeasureLocation,
  Label,
  LabelGroup,
  MenuToggle,
  Select,
  SelectOption,
  Divider,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core'
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table'
import { SyncIcon, ExclamationCircleIcon } from '@patternfly/react-icons'
import { apiClient, type NvidiaSmiInfo, type GpuStatus, type GpuProcess } from '../services/api'
import { useClusterStatus } from '../hooks/useClusterStatus'
import { PodSelector } from '../components/PodSelector'

type RefreshInterval = 'none' | '5s' | '15s' | '30s' | '1min'

const REFRESH_INTERVALS: Record<RefreshInterval, number | null> = {
  none: null,
  '5s': 5000,
  '15s': 15000,
  '30s': 30000,
  '1min': 60000,
}

const REFRESH_LABELS: Record<RefreshInterval, string> = {
  none: 'None',
  '5s': '5 seconds',
  '15s': '15 seconds',
  '30s': '30 seconds',
  '1min': '1 minute',
}

function getSecondsSinceUpdate(timestamp: string): number {
  return Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000)
}

function getTemperatureColor(temp: string): 'green' | 'yellow' | 'orange' | 'red' {
  const value = parseInt(temp, 10)
  if (isNaN(value)) return 'green'
  if (value < 50) return 'green'
  if (value < 70) return 'yellow'
  if (value < 85) return 'orange'
  return 'red'
}

function getUtilizationColor(util: string): 'green' | 'yellow' | 'orange' | 'red' {
  const value = parseInt(util, 10)
  if (isNaN(value)) return 'green'
  if (value < 50) return 'green'
  if (value < 75) return 'yellow'
  if (value < 90) return 'orange'
  return 'red'
}

function GpuCard({ gpu }: { gpu: GpuStatus }) {
  const memoryPercent = Math.round((gpu.memoryUsedMB / gpu.memoryTotalMB) * 100)

  return (
    <Card>
      <CardTitle>
        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
          <FlexItem>
            <strong>GPU {gpu.index}:</strong> {gpu.name}
          </FlexItem>
          <FlexItem>
            <LabelGroup>
              <Label color={getTemperatureColor(gpu.temperature)}>{gpu.temperature}</Label>
              <Label color={getUtilizationColor(gpu.gpuUtilization)}>
                GPU: {gpu.gpuUtilization}
              </Label>
            </LabelGroup>
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <Grid hasGutter>
          <GridItem span={12}>
            <Content component="h4" style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
              Memory Usage
            </Content>
            <Progress
              value={memoryPercent}
              title="GPU Memory"
              label={`${gpu.memoryUsed} / ${gpu.memoryTotal}`}
              measureLocation={ProgressMeasureLocation.outside}
            />
          </GridItem>

          <GridItem span={12}>
            <Divider />
          </GridItem>

          <GridItem span={6}>
            <DescriptionList isCompact isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Fan</DescriptionListTerm>
                <DescriptionListDescription>{gpu.fan}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Perf State</DescriptionListTerm>
                <DescriptionListDescription>{gpu.performanceState}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Power</DescriptionListTerm>
                <DescriptionListDescription>
                  {gpu.powerUsage} / {gpu.powerCap}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </GridItem>

          <GridItem span={6}>
            <DescriptionList isCompact isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Bus ID</DescriptionListTerm>
                <DescriptionListDescription>{gpu.busId}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Display</DescriptionListTerm>
                <DescriptionListDescription>{gpu.displayActive}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Compute Mode</DescriptionListTerm>
                <DescriptionListDescription>{gpu.computeMode}</DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
          </GridItem>
        </Grid>
      </CardBody>
    </Card>
  )
}

function ProcessTable({ processes }: { processes: GpuProcess[] }) {
  if (processes.length === 0) {
    return (
      <Card>
        <CardTitle>GPU Processes</CardTitle>
        <CardBody>
          <EmptyState titleText="No GPU processes" variant="xs">
            <EmptyStateBody>No processes are currently using the GPU.</EmptyStateBody>
          </EmptyState>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardTitle>GPU Processes</CardTitle>
      <CardBody>
        <Table aria-label="GPU processes" variant="compact">
          <Thead>
            <Tr>
              <Th>GPU</Th>
              <Th>GI ID</Th>
              <Th>CI ID</Th>
              <Th>PID</Th>
              <Th>Type</Th>
              <Th>Process Name</Th>
              <Th>GPU Memory</Th>
            </Tr>
          </Thead>
          <Tbody>
            {processes.map((proc, index) => {
              const isVllm =
                proc.processName.toLowerCase().includes('vllm') || proc.processName.includes('VLLM')

              return (
                <Tr key={`${proc.pid}-${index}`}>
                  <Td dataLabel="GPU">{proc.gpu}</Td>
                  <Td dataLabel="GI ID">{proc.gi}</Td>
                  <Td dataLabel="CI ID">{proc.ci}</Td>
                  <Td dataLabel="PID">{proc.pid}</Td>
                  <Td dataLabel="Type">
                    <Label color={proc.type === 'C' ? 'blue' : 'grey'}>
                      {proc.type === 'C' ? 'Compute' : 'Graphics'}
                    </Label>
                  </Td>
                  <Td dataLabel="Process Name">
                    {isVllm ? <strong>{proc.processName}</strong> : proc.processName}
                  </Td>
                  <Td dataLabel="GPU Memory">{proc.gpuMemory}</Td>
                </Tr>
              )
            })}
          </Tbody>
        </Table>
      </CardBody>
    </Card>
  )
}

function GpuInfo() {
  const [gpuInfo, setGpuInfo] = useState<NvidiaSmiInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>('none')
  const [isRefreshSelectOpen, setIsRefreshSelectOpen] = useState(false)
  const [secondsSinceUpdate, setSecondsSinceUpdate] = useState(0)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const [selectedPodId, setSelectedPodId] = useState<string | undefined>(undefined)

  const { isClusterMode, clusterStatus } = useClusterStatus()

  // Auto-select local pod on first cluster status load
  useEffect(() => {
    if (isClusterMode && clusterStatus?.localPodId && !selectedPodId) {
      setSelectedPodId(clusterStatus.localPodId)
    }
  }, [isClusterMode, clusterStatus?.localPodId, selectedPodId])

  const fetchGpuInfo = useCallback(async () => {
    try {
      setError(null)
      const info = isClusterMode && selectedPodId
        ? await apiClient.getClusterPodGpuInfo(selectedPodId)
        : await apiClient.getGpuInfo()
      setGpuInfo(info)
      setSecondsSinceUpdate(0)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch GPU info')
    } finally {
      setLoading(false)
    }
  }, [isClusterMode, selectedPodId])

  // Fetch on mount and when selected pod changes
  useEffect(() => {
    setLoading(true)
    setGpuInfo(null)
    fetchGpuInfo()
  }, [fetchGpuInfo])

  // Set up refresh interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    const interval = REFRESH_INTERVALS[refreshInterval]
    if (interval !== null) {
      intervalRef.current = setInterval(fetchGpuInfo, interval)
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [refreshInterval, fetchGpuInfo])

  // Update "seconds since update" counter
  useEffect(() => {
    const timer = setInterval(() => {
      if (gpuInfo) {
        setSecondsSinceUpdate(getSecondsSinceUpdate(gpuInfo.timestamp))
      }
    }, 1000)

    return () => clearInterval(timer)
  }, [gpuInfo])

  const handleRefreshClick = () => {
    setLoading(true)
    fetchGpuInfo()
  }

  const handleRefreshIntervalSelect = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined
  ) => {
    setRefreshInterval(value as RefreshInterval)
    setIsRefreshSelectOpen(false)
  }

  if (loading && !gpuInfo) {
    return (
      <PageSection>
        <Flex justifyContent={{ default: 'justifyContentCenter' }}>
          <FlexItem>
            <Spinner size="xl" aria-label="Loading GPU info" />
          </FlexItem>
        </Flex>
      </PageSection>
    )
  }

  if (error && !gpuInfo) {
    return (
      <PageSection>
        <EmptyState
          titleText="Failed to load GPU info"
          icon={ExclamationCircleIcon}
          status="danger"
        >
          <EmptyStateBody>{error}</EmptyStateBody>
        </EmptyState>
      </PageSection>
    )
  }

  return (
    <>
      <PageSection hasShadowBottom>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
              <FlexItem>
                <Content component="h1">GPU Info</Content>
              </FlexItem>
              {isClusterMode && (
                <FlexItem>
                  <PodSelector
                    selectedPodId={selectedPodId}
                    onSelect={(podId) => setSelectedPodId(podId)}
                    isClusterMode={isClusterMode}
                    label="Select pod"
                  />
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
          <FlexItem>
            <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapMd' }}>
              {gpuInfo && (
                <FlexItem>
                  <Content
                    component="small"
                    style={{ color: 'var(--pf-t--global--color--nonstatus--gray--default)' }}
                  >
                    Last updated: {secondsSinceUpdate}s ago
                  </Content>
                </FlexItem>
              )}
              <FlexItem>
                <Select
                  id="refresh-interval-select"
                  isOpen={isRefreshSelectOpen}
                  selected={refreshInterval}
                  onSelect={handleRefreshIntervalSelect}
                  onOpenChange={(isOpen) => setIsRefreshSelectOpen(isOpen)}
                  toggle={(toggleRef) => (
                    <MenuToggle
                      ref={toggleRef}
                      onClick={() => setIsRefreshSelectOpen(!isRefreshSelectOpen)}
                      isExpanded={isRefreshSelectOpen}
                    >
                      Refresh: {REFRESH_LABELS[refreshInterval]}
                    </MenuToggle>
                  )}
                  shouldFocusToggleOnSelect
                >
                  {Object.entries(REFRESH_LABELS).map(([key, label]) => (
                    <SelectOption key={key} value={key}>
                      {label}
                    </SelectOption>
                  ))}
                </Select>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="secondary"
                  icon={<SyncIcon />}
                  onClick={handleRefreshClick}
                  isLoading={loading}
                  isDisabled={loading}
                >
                  Refresh
                </Button>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </PageSection>

      {gpuInfo && (
        <>
          <PageSection>
            <Card>
              <CardTitle>Driver Information</CardTitle>
              <CardBody>
                <DescriptionList isHorizontal columnModifier={{ default: '3Col' }}>
                  <DescriptionListGroup>
                    <DescriptionListTerm>NVIDIA-SMI</DescriptionListTerm>
                    <DescriptionListDescription>
                      {gpuInfo.driver.nvidiaSmiVersion}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Driver Version</DescriptionListTerm>
                    <DescriptionListDescription>
                      {gpuInfo.driver.driverVersion}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>CUDA Version</DescriptionListTerm>
                    <DescriptionListDescription>
                      {gpuInfo.driver.cudaVersion}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </CardBody>
            </Card>
          </PageSection>

          <PageSection>
            <Grid hasGutter>
              {gpuInfo.gpus.map((gpu) => (
                <GridItem key={gpu.index} span={12} xl={6}>
                  <GpuCard gpu={gpu} />
                </GridItem>
              ))}
            </Grid>
          </PageSection>

          <PageSection>
            <ProcessTable processes={gpuInfo.processes} />
          </PageSection>
        </>
      )}
    </>
  )
}

export default GpuInfo
