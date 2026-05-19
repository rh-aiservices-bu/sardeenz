import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardHeader,
  CardBody,
  CardTitle,
  Gallery,
  Label,
  Flex,
  FlexItem,
  Spinner,
  Content,
  Button,
} from '@patternfly/react-core'
import {
  ServerIcon,
  CubesIcon,
  CopyIcon,
  CheckIcon,
} from '@patternfly/react-icons'
import { apiClient, type ClusterPod, type ClusterModelInstance } from '../services/api'
import type { UseClusterStatusReturn } from '../hooks/useClusterStatus'

const POD_POLL_INTERVAL_MS = 10_000

interface ClusterOverviewProps {
  clusterData: UseClusterStatusReturn
}

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
      <Card>
        <CardHeader>
          <Content component="h2">Cluster Overview</Content>
        </CardHeader>
        <CardBody>
          <Flex justifyContent={{ default: 'justifyContentCenter' }}>
            <FlexItem>
              <Spinner size="lg" aria-label="Loading cluster status" />
            </FlexItem>
          </Flex>
        </CardBody>
      </Card>
    )
  }

  if (error || !clusterStatus) {
    return null
  }

  return (
    <Card>
      <CardHeader
        actions={{
          actions: (
            <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
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
          ),
        }}
      >
        <Content component="h2">Cluster Overview</Content>
      </CardHeader>
      <CardBody>
        <SummaryCards clusterStatus={clusterStatus} />

        {podsLoading ? (
          <Flex justifyContent={{ default: 'justifyContentCenter' }} style={{ marginTop: 'var(--pf-t--global--spacer--md)' }}>
            <FlexItem><Spinner size="md" aria-label="Loading pods" /></FlexItem>
          </Flex>
        ) : (
          <PodSections pods={pods} leaderId={clusterStatus.leaderId} />
        )}
      </CardBody>
    </Card>
  )
}

function SummaryCards({ clusterStatus }: { clusterStatus: { leaderId: string; leaderAddress: string | null; healthyPodCount: number; podCount: number; totalModelsLoaded: number; totalGpus: number; term: number } }) {
  return (
    <Gallery hasGutter minWidths={{ default: '200px' }} style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}>
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
          {/* term = Raft election term; increments each time the cluster elects a new leader */}
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}> total | Term {clusterStatus.term}</span>
        </CardBody>
      </Card>
    </Gallery>
  )
}

function PodSections({ pods, leaderId }: { pods: ClusterPod[]; leaderId: string }) {
  const [expandedPods, setExpandedPods] = useState<Set<string>>(new Set())

  if (pods.length === 0) return null

  const sorted = [...pods].sort((a, b) => {
    if (a.podId === leaderId) return -1
    if (b.podId === leaderId) return 1
    return a.podId.localeCompare(b.podId)
  })

  const toggle = (podId: string) => {
    setExpandedPods((prev) => {
      const next = new Set(prev)
      if (next.has(podId)) next.delete(podId)
      else next.add(podId)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--pf-t--global--spacer--sm)' }}>
      {sorted.map((pod) => (
        <PodSection
          key={pod.podId}
          pod={pod}
          isLeader={pod.podId === leaderId}
          isExpanded={expandedPods.has(pod.podId)}
          onToggle={() => toggle(pod.podId)}
        />
      ))}
    </div>
  )
}

function PodSection({ pod, isLeader, isExpanded, onToggle }: { pod: ClusterPod; isLeader: boolean; isExpanded: boolean; onToggle: () => void }) {
  const totalVram = pod.gpus.reduce((sum, g) => sum + g.totalVramMB, 0)
  const usedVram = pod.gpus.reduce((sum, g) => sum + g.usedVramMB, 0)
  const vramPercent = totalVram > 0 ? Math.round((usedVram / totalVram) * 100) : 0

  return (
    <div style={{ marginBottom: 'var(--pf-t--global--spacer--xs)' }}>
      {/* Header — same style as NodeGroup in GpuMemoryPanel */}
      <div
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle() }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--pf-t--global--spacer--sm)',
          padding: '8px 12px',
          background: 'var(--pf-t--global--background--color--secondary--default)',
          border: '1px solid var(--pf-t--global--border--color--default)',
          borderRadius: isExpanded ? '6px 6px 0 0' : '6px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: '10px', color: 'var(--pf-t--global--text--color--subtle)', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)', width: '14px' }}>
          ▼
        </span>
        <ServerIcon style={{ color: 'var(--pf-t--global--text--color--subtle)' }} />
        <span style={{ fontFamily: 'var(--pf-t--global--font--family--mono)', fontSize: 'var(--pf-t--global--font--size--sm)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
          {pod.podId}
        </span>
        <Label color={getHealthColor(pod.status)} isCompact>{pod.status}</Label>
        {isLeader && <Label color="blue" isCompact>leader</Label>}
        <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--xs)', marginLeft: 'auto' }}>
          {pod.gpus.length} GPU{pod.gpus.length !== 1 ? 's' : ''} · {pod.models.length} model{pod.models.length !== 1 ? 's' : ''} · VRAM {vramPercent}%
        </span>
      </div>

      {/* Expanded content — model grid */}
      {isExpanded && (
        <div
          style={{
            padding: 'var(--pf-t--global--spacer--sm)',
            border: '1px solid var(--pf-t--global--border--color--default)',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
          }}
        >
          <ModelGrid models={pod.models} />
        </div>
      )}
    </div>
  )
}

function ModelGrid({ models }: { models: ClusterModelInstance[] }) {
  if (models.length === 0) {
    return (
      <Flex spaceItems={{ default: 'spaceItemsXs' }} alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem><CubesIcon style={{ color: 'var(--pf-t--global--text--color--subtle)' }} /></FlexItem>
        <FlexItem>
          <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--sm)' }}>
            No models loaded
          </span>
        </FlexItem>
      </Flex>
    )
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
        gap: 'var(--pf-t--global--spacer--sm)',
      }}
    >
      {models.map((model) => (
        <ModelCard key={model.instanceId} model={model} />
      ))}
    </div>
  )
}

function ModelCard({ model }: { model: ClusterModelInstance }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(model.modelName)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      style={{
        border: '1px solid var(--pf-t--global--border--color--default)',
        borderRadius: '6px',
        padding: '10px 12px',
        background: 'var(--pf-t--global--background--color--primary--default)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px', flexWrap: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--pf-t--global--font--family--mono)', fontSize: 'var(--pf-t--global--font--size--sm)', fontWeight: 'var(--pf-t--global--font--weight--bold)', wordBreak: 'break-all', minWidth: 0 }}>
          {model.modelName}
        </span>
        <Button
          variant="plain"
          aria-label="Copy model name"
          onClick={handleCopy}
          style={{ padding: '2px', flexShrink: 0, color: copied ? 'var(--pf-t--global--color--status--success--default)' : 'var(--pf-t--global--text--color--subtle)' }}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </Button>
      </div>
      <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem>
          <Label color={getModelStatusColor(model.status)} isCompact>{model.status}</Label>
        </FlexItem>
        <FlexItem>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--text--color--subtle)' }}>
            GPU {model.gpuIds.join(', ')} · port {model.port}
            {model.tensorParallelSize > 1 ? ` · TP${model.tensorParallelSize}` : ''}
          </span>
        </FlexItem>
      </Flex>
    </div>
  )
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
