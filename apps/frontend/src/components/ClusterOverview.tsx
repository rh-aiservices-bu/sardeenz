import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardBody,
  CardTitle,
  Gallery,
  Label,
  Flex,
  FlexItem,
  Spinner,
  Content,
  ExpandableSection,
  Progress,
  ProgressMeasureLocation,
  ProgressVariant,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
} from '@patternfly/react-core'
import {
  ServerIcon,
  CpuIcon,
  CubesIcon,
} from '@patternfly/react-icons'
import { apiClient, type ClusterPod, type ClusterPodGpu, type ClusterModelInstance } from '../services/api'
import type { UseClusterStatusReturn } from '../hooks/useClusterStatus'

const POD_POLL_INTERVAL_MS = 10_000

interface ClusterOverviewProps {
  clusterData: UseClusterStatusReturn
}

/**
 * Cluster overview with summary cards and per-pod detail panels.
 * Shows each pod's role, health, GPUs, and loaded models.
 */
export function ClusterOverview({ clusterData }: ClusterOverviewProps) {
  const { clusterStatus, isLoading, error } = clusterData
  const [pods, setPods] = useState<ClusterPod[]>([])
  const [podsLoading, setPodsLoading] = useState(true)

  const fetchPods = useCallback(async () => {
    try {
      const response = await apiClient.getClusterPods()
      setPods(response.pods)
    } catch {
      // Keep stale data on error
    } finally {
      setPodsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!clusterStatus?.isClusterMode) return
    fetchPods()
    const timer = window.setInterval(fetchPods, POD_POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [clusterStatus?.isClusterMode, fetchPods])

  if (isLoading) {
    return (
      <Flex justifyContent={{ default: 'justifyContentCenter' }}>
        <FlexItem>
          <Spinner size="lg" aria-label="Loading cluster status" />
        </FlexItem>
      </Flex>
    )
  }

  if (error || !clusterStatus) {
    return null
  }

  return (
    <div style={{ marginBottom: 'var(--pf-t--global--spacer--lg)' }}>
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsCenter' }}
        style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
      >
        <FlexItem>
          <Content component="h2">Cluster Overview</Content>
        </FlexItem>
        <FlexItem>
          <Flex spaceItems={{ default: 'spaceItemsSm' }}>
            <FlexItem>
              <Label color={getHealthColor(clusterStatus.health)} isCompact>
                {clusterStatus.health}
              </Label>
            </FlexItem>
            <FlexItem>
              <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                {clusterStatus.podCount} pod{clusterStatus.podCount !== 1 ? 's' : ''} | {clusterStatus.totalModelsLoaded} model{clusterStatus.totalModelsLoaded !== 1 ? 's' : ''} | {clusterStatus.totalGpus} GPU{clusterStatus.totalGpus !== 1 ? 's' : ''}
              </span>
            </FlexItem>
          </Flex>
        </FlexItem>
      </Flex>

      <SummaryCards clusterStatus={clusterStatus} />

      {podsLoading ? (
        <Flex justifyContent={{ default: 'justifyContentCenter' }} style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
          <FlexItem><Spinner size="md" aria-label="Loading pods" /></FlexItem>
        </Flex>
      ) : (
        <PodDetailCards pods={pods} leaderId={clusterStatus.leaderId} />
      )}
    </div>
  )
}

function SummaryCards({ clusterStatus }: { clusterStatus: { leaderId: string; leaderAddress: string | null; healthyPodCount: number; podCount: number; totalModelsLoaded: number; totalGpus: number; term: number } }) {
  return (
    <Gallery hasGutter minWidths={{ default: '200px' }}>
      <Card isCompact>
        <CardTitle>Leader</CardTitle>
        <CardBody>
          <span style={{ fontFamily: 'var(--pf-t--global--font--family--mono)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
            {clusterStatus.leaderId}
          </span>
          {clusterStatus.leaderAddress && (
            <div style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
              {clusterStatus.leaderAddress}
            </div>
          )}
        </CardBody>
      </Card>
      <Card isCompact>
        <CardTitle>Pods</CardTitle>
        <CardBody>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--2xl)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
            {clusterStatus.healthyPodCount}
          </span>
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}> / {clusterStatus.podCount} healthy</span>
        </CardBody>
      </Card>
      <Card isCompact>
        <CardTitle>Models</CardTitle>
        <CardBody>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--2xl)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
            {clusterStatus.totalModelsLoaded}
          </span>
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}> loaded across cluster</span>
        </CardBody>
      </Card>
      <Card isCompact>
        <CardTitle>GPUs</CardTitle>
        <CardBody>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--2xl)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
            {clusterStatus.totalGpus}
          </span>
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}> total | Term {clusterStatus.term}</span>
        </CardBody>
      </Card>
    </Gallery>
  )
}

function PodDetailCards({ pods, leaderId }: { pods: ClusterPod[]; leaderId: string }) {
  const [expandedPods, setExpandedPods] = useState<Set<string>>(() => new Set(pods.map((p) => p.podId)))

  // Auto-expand newly discovered pods
  useEffect(() => {
    setExpandedPods((prev) => {
      const next = new Set(prev)
      for (const pod of pods) {
        if (!next.has(pod.podId)) next.add(pod.podId)
      }
      return next
    })
  }, [pods])

  if (pods.length === 0) return null

  // Sort: leader first, then by podId
  const sorted = [...pods].sort((a, b) => {
    if (a.podId === leaderId) return -1
    if (b.podId === leaderId) return 1
    return a.podId.localeCompare(b.podId)
  })

  return (
    <div style={{ marginTop: 'var(--pf-t--global--spacer--md)', display: 'flex', flexDirection: 'column', gap: 'var(--pf-t--global--spacer--sm)' }}>
      {sorted.map((pod) => (
        <PodCard
          key={pod.podId}
          pod={pod}
          isLeader={pod.podId === leaderId}
          isExpanded={expandedPods.has(pod.podId)}
          onToggle={() => {
            setExpandedPods((prev) => {
              const next = new Set(prev)
              if (next.has(pod.podId)) next.delete(pod.podId)
              else next.add(pod.podId)
              return next
            })
          }}
        />
      ))}
    </div>
  )
}

function PodCard({ pod, isLeader, isExpanded, onToggle }: { pod: ClusterPod; isLeader: boolean; isExpanded: boolean; onToggle: () => void }) {
  const totalVram = pod.gpus.reduce((sum, g) => sum + g.totalVramMB, 0)
  const usedVram = pod.gpus.reduce((sum, g) => sum + g.usedVramMB, 0)
  const vramPercent = totalVram > 0 ? Math.round((usedVram / totalVram) * 100) : 0

  const toggleContent = (
    <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
      <FlexItem>
        <ServerIcon />
      </FlexItem>
      <FlexItem>
        <span style={{ fontFamily: 'var(--pf-t--global--font--family--mono)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
          {pod.podId}
        </span>
      </FlexItem>
      <FlexItem>
        <Label color={getHealthColor(pod.status)} isCompact>{pod.status}</Label>
      </FlexItem>
      {isLeader && (
        <FlexItem>
          <Label color="blue" isCompact>leader</Label>
        </FlexItem>
      )}
      <FlexItem>
        <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
          {pod.gpus.length} GPU{pod.gpus.length !== 1 ? 's' : ''} · {pod.models.length} model{pod.models.length !== 1 ? 's' : ''} · VRAM {vramPercent}%
        </span>
      </FlexItem>
    </Flex>
  )

  return (
    <Card isCompact>
      <CardBody style={{ padding: 'var(--pf-t--global--spacer--sm) var(--pf-t--global--spacer--md)' }}>
        <ExpandableSection
          toggleContent={toggleContent}
          isExpanded={isExpanded}
          onToggle={onToggle}
          isIndented
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pf-t--global--spacer--md)', paddingTop: 'var(--pf-t--global--spacer--sm)' }}>
            <GpuSection gpus={pod.gpus} />
            <ModelSection models={pod.models} />
          </div>
        </ExpandableSection>
      </CardBody>
    </Card>
  )
}

function GpuSection({ gpus }: { gpus: ClusterPodGpu[] }) {
  if (gpus.length === 0) {
    return (
      <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
        No GPU data available
      </span>
    )
  }

  return (
    <div>
      <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
        <FlexItem><CpuIcon /></FlexItem>
        <FlexItem>
          <Content component="h4" style={{ margin: 0 }}>GPUs</Content>
        </FlexItem>
      </Flex>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pf-t--global--spacer--sm)' }}>
        {gpus.map((gpu) => {
          const usedPct = gpu.totalVramMB > 0 ? Math.round((gpu.usedVramMB / gpu.totalVramMB) * 100) : 0
          const freeMB = gpu.totalVramMB - gpu.usedVramMB
          const variant = usedPct > 90 ? ProgressVariant.danger : usedPct > 70 ? ProgressVariant.warning : undefined
          return (
            <div key={gpu.gpuId}>
              <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} style={{ marginBottom: '2px' }}>
                <FlexItem>
                  <span style={{ fontSize: 'var(--pf-t--global--font--size--sm)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
                    GPU {gpu.gpuId}: {gpu.name}
                  </span>
                </FlexItem>
                <FlexItem>
                  <span style={{ fontSize: 'var(--pf-t--global--font--size--sm)', color: 'var(--pf-t--global--text--color--subtle)' }}>
                    {formatMB(freeMB)} free / {formatMB(gpu.totalVramMB)} · {gpu.utilization}% util · {gpu.temperature}°C
                  </span>
                </FlexItem>
              </Flex>
              <Progress
                value={usedPct}
                measureLocation={ProgressMeasureLocation.none}
                variant={variant}
                aria-label={`GPU ${gpu.gpuId} VRAM usage`}
                style={{ height: '8px' }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModelSection({ models }: { models: ClusterModelInstance[] }) {
  if (models.length === 0) {
    return (
      <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem><CubesIcon /></FlexItem>
        <FlexItem>
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
            No models loaded
          </span>
        </FlexItem>
      </Flex>
    )
  }

  return (
    <div>
      <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }} style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
        <FlexItem><CubesIcon /></FlexItem>
        <FlexItem>
          <Content component="h4" style={{ margin: 0 }}>Models</Content>
        </FlexItem>
      </Flex>
      <DescriptionList isHorizontal isCompact columnModifier={{ default: '2Col' }}>
        {models.map((model) => (
          <DescriptionListGroup key={model.instanceId}>
            <DescriptionListTerm>
              <span style={{ fontFamily: 'var(--pf-t--global--font--family--mono)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
                {model.modelName}
              </span>
            </DescriptionListTerm>
            <DescriptionListDescription>
              <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                <FlexItem>
                  <Label color={getModelStatusColor(model.status)} isCompact>{model.status}</Label>
                </FlexItem>
                <FlexItem>
                  <span style={{ fontSize: 'var(--pf-t--global--font--size--sm)', color: 'var(--pf-t--global--text--color--subtle)' }}>
                    GPU {model.gpuIds.join(', ')} · port {model.port}
                  </span>
                </FlexItem>
              </Flex>
            </DescriptionListDescription>
          </DescriptionListGroup>
        ))}
      </DescriptionList>
    </div>
  )
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function getHealthColor(status: string): 'green' | 'orange' | 'red' {
  switch (status) {
    case 'healthy':
      return 'green'
    case 'degraded':
    case 'suspect':
      return 'orange'
    default:
      return 'red'
  }
}

function getModelStatusColor(status: string): 'green' | 'blue' | 'orange' | 'red' | 'grey' {
  switch (status) {
    case 'running':
      return 'green'
    case 'loading':
      return 'blue'
    case 'sleeping':
      return 'orange'
    case 'failed':
    case 'error':
      return 'red'
    default:
      return 'grey'
  }
}

export default ClusterOverview
