import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Card,
  CardHeader,
  CardBody,
  Flex,
  FlexItem,
  MenuToggle,
  Select,
  SelectOption,
  Spinner,
  Content,
  Alert,
  Label,
} from '@patternfly/react-core'
import { MoonIcon, ServerIcon } from '@patternfly/react-icons'
import { ResponsiveBar } from '@nivo/bar'
import type { MultiGpuMemoryUsageResponse, PerGpuMetrics } from '@sardeenz/types'
import { apiClient } from '../services/api'

// Refresh interval options
const REFRESH_OPTIONS = [
  { value: null, label: 'None' },
  { value: 5000, label: '5s' },
  { value: 15000, label: '15s' },
  { value: 30000, label: '30s' },
  { value: 60000, label: '1m' },
]

// Color constants
const KVCACHE_COLORS = {
  Prealloc: '#F0AB00', // Yellow
  Used: '#0066CC', // Blue
  Free: '#6A6E73', // Gray
}

const FREE_COLOR = '#D2D2D2' // Light gray for free space

// Pattern definition for sleeping models (diagonal hatching)
const SLEEPING_PATTERN_DEFS = [
  {
    id: 'sleeping-pattern',
    type: 'patternLines' as const,
    background: 'inherit',
    color: 'rgba(0, 0, 0, 0.3)',
    rotation: -45,
    lineWidth: 3,
    spacing: 8,
  },
]

// Nivo tooltip theme - detects PatternFly dark mode for proper styling
const getTooltipTheme = () => {
  const isDark = document.documentElement.classList.contains('pf-v6-theme-dark')
  return {
    tooltip: {
      container: {
        background: isDark ? '#1f1f1f' : '#ffffff',
        color: isDark ? '#e0e0e0' : '#151515',
        padding: '8px 12px',
        borderRadius: '4px',
        border: isDark ? '1px solid #3c3f42' : '1px solid #d2d2d2',
        boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
      },
    },
  }
}

const formatGb = (value: number) => `${value.toFixed(2)} GB`

function buildGpuBarData(gpu: PerGpuMetrics) {
  const { models } = gpu
  const modelsMemory = models.reduce((sum, m) => sum + m.gpu_memory_gb, 0)
  const otherMemory = Math.max(0, gpu.used_gb - modelsMemory)
  const freeMemory = gpu.free_gb

  const dataObj: Record<string, number | string> = { id: 'GPU' }
  const keys: string[] = []
  const colors: Record<string, string> = {}
  const fill: Array<{ match: { id: string }; id: string }> = []

  models.forEach((model) => {
    const key = model.display_name
    dataObj[key] = Number(model.gpu_memory_gb.toFixed(2))
    keys.push(key)
    colors[key] = model.color

    if (model.is_sleeping) {
      fill.push({ match: { id: key }, id: 'sleeping-pattern' })
    }
  })

  if (otherMemory > 0.01) {
    dataObj['Other'] = Number(otherMemory.toFixed(2))
    keys.push('Other')
    colors['Other'] = '#8B8D8F'
  }

  dataObj['Free'] = Number(freeMemory.toFixed(2))
  keys.push('Free')
  colors['Free'] = FREE_COLOR

  return { data: [dataObj], keys, colors, fill }
}

function buildKvcacheData(gpu: PerGpuMetrics) {
  const kvcache = gpu.kvcache
  const hasModels = gpu.models.length > 0
  if (!kvcache || kvcache.total_gb === 0 || !hasModels) return null

  return [
    {
      id: 'KVCache',
      Prealloc: Number(kvcache.prealloc_gb.toFixed(2)),
      Used: Number(kvcache.used_gb.toFixed(2)),
      Free: Number(kvcache.free_gb.toFixed(2)),
    },
  ]
}

// ---------------------------------------------------------------------------
// GpuCard — renders one GPU as a compact card with stacked VRAM bar
// ---------------------------------------------------------------------------
function GpuCard({
  gpu,
  onModelClick,
}: {
  gpu: PerGpuMetrics
  onModelClick?: (instanceId: string) => void
}) {
  const gpuData = useMemo(() => buildGpuBarData(gpu), [gpu])
  const kvcacheData = useMemo(() => buildKvcacheData(gpu), [gpu])
  const usedPct = gpu.total_gb > 0 ? Math.round((gpu.used_gb / gpu.total_gb) * 100) : 0

  return (
    <div
      style={{
        border: '1px solid var(--pf-t--global--border--color--default)',
        borderRadius: '6px',
        padding: '10px 12px',
        background: 'var(--pf-t--global--background--color--primary--default)',
      }}
    >
      {/* Header */}
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--sm)', fontWeight: 'var(--pf-t--global--font--weight--bold)' }}>
            GPU {gpu.gpu_index}: {gpu.name}
          </span>
        </FlexItem>
        <FlexItem>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--text--color--subtle)' }}>
            {gpu.utilization_percent.toFixed(0)}% util · {(gpu as PerGpuMetrics & { temperature?: number }).temperature ?? '—'}°C
          </span>
        </FlexItem>
      </Flex>

      {/* VRAM info */}
      <div style={{ fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--text--color--subtle)', margin: '4px 0' }}>
        VRAM: {formatGb(gpu.used_gb)} / {formatGb(gpu.total_gb)} — {usedPct}%
      </div>

      {/* Stacked VRAM bar */}
      <div style={{ height: '24px' }}>
        <ResponsiveBar
          data={gpuData.data}
          keys={gpuData.keys}
          indexBy="id"
          layout="horizontal"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          padding={0}
          colors={(bar) => gpuData.colors[bar.id as string] || '#ccc'}
          defs={SLEEPING_PATTERN_DEFS}
          fill={gpuData.fill}
          borderRadius={4}
          enableLabel={false}
          enableGridY={false}
          enableGridX={false}
          axisTop={null}
          axisRight={null}
          axisBottom={null}
          axisLeft={null}
          theme={getTooltipTheme()}
          onClick={(bar) => {
            const model = gpu.models.find((m) => m.display_name === bar.id)
            if (model && onModelClick) {
              onModelClick(model.instance_id)
            }
          }}
          onMouseEnter={(_bar, event) => {
            const isClickable = gpu.models.some((m) => m.display_name === (_bar as { id: string }).id)
            if (isClickable && onModelClick) {
              ;(event.target as HTMLElement).style.cursor = 'pointer'
            }
          }}
          onMouseLeave={(_bar, event) => {
            ;(event.target as HTMLElement).style.cursor = 'default'
          }}
        />
      </div>

      {/* Model legend */}
      <Flex
        flexWrap={{ default: 'wrap' }}
        style={{
          marginTop: '4px',
          columnGap: 'var(--pf-t--global--spacer--sm)',
          rowGap: '2px',
        }}
      >
        {gpu.models.map((model) => (
          <FlexItem key={`${model.instance_id}-${model.model_path}`}>
            <span
              onClick={() => onModelClick?.(model.instance_id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onModelClick?.(model.instance_id)
              }}
              role={onModelClick ? 'button' : undefined}
              tabIndex={onModelClick ? 0 : undefined}
              aria-label={onModelClick ? `Go to ${model.display_name}` : undefined}
              style={{
                cursor: onModelClick ? 'pointer' : 'default',
                fontSize: 'var(--pf-t--global--font--size--xs)',
                opacity: model.is_sleeping ? 0.7 : 1,
              }}
            >
              <span style={{ color: model.color }}>●</span> {model.display_name}
              {model.is_sleeping && (
                <MoonIcon
                  style={{
                    marginLeft: '3px',
                    fontSize: '10px',
                    color: 'var(--pf-t--global--text--color--subtle)',
                  }}
                />
              )}{' '}
              ({formatGb(model.gpu_memory_gb)})
            </span>
          </FlexItem>
        ))}
        {gpuData.keys.includes('Other') && (
          <FlexItem>
            <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)' }}>
              <span style={{ color: '#8B8D8F' }}>●</span> Other
            </span>
          </FlexItem>
        )}
        <FlexItem>
          <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)' }}>
            <span style={{ color: FREE_COLOR }}>●</span> Free ({formatGb(gpu.free_gb)})
          </span>
        </FlexItem>
      </Flex>

      {/* KVCache mini-bar */}
      {kvcacheData && gpu.kvcache && (
        <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid var(--pf-t--global--border--color--default)' }}>
          <div style={{ fontSize: 'var(--pf-t--global--font--size--xs)', color: 'var(--pf-t--global--text--color--subtle)', marginBottom: '2px' }}>
            KVCache: {formatGb(gpu.kvcache.used_gb)} / {formatGb(gpu.kvcache.total_gb)}
          </div>
          <div style={{ height: '12px' }}>
            <ResponsiveBar
              data={kvcacheData}
              keys={['Prealloc', 'Used', 'Free']}
              indexBy="id"
              layout="horizontal"
              margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
              padding={0}
              colors={(bar) => KVCACHE_COLORS[bar.id as keyof typeof KVCACHE_COLORS] || '#ccc'}
              borderRadius={3}
              enableLabel={false}
              enableGridY={false}
              enableGridX={false}
              axisTop={null}
              axisRight={null}
              axisBottom={null}
              axisLeft={null}
              theme={getTooltipTheme()}
            />
          </div>
          <Flex gap={{ default: 'gapSm' }} style={{ marginTop: '2px' }}>
            <FlexItem>
              <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)' }}>
                <span style={{ color: KVCACHE_COLORS.Prealloc }}>●</span> Prealloc ({formatGb(gpu.kvcache.prealloc_gb)})
              </span>
            </FlexItem>
            <FlexItem>
              <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)' }}>
                <span style={{ color: KVCACHE_COLORS.Used }}>●</span> Used ({formatGb(gpu.kvcache.used_gb)})
              </span>
            </FlexItem>
            <FlexItem>
              <span style={{ fontSize: 'var(--pf-t--global--font--size--xs)' }}>
                <span style={{ color: KVCACHE_COLORS.Free }}>●</span> Free ({formatGb(gpu.kvcache.free_gb)})
              </span>
            </FlexItem>
          </Flex>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GpuGrid — responsive CSS grid of GpuCards
// ---------------------------------------------------------------------------
function GpuGrid({
  gpus,
  onModelClick,
}: {
  gpus: PerGpuMetrics[]
  onModelClick?: (instanceId: string) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 'var(--pf-t--global--spacer--sm)',
      }}
    >
      {gpus.map((gpu) => (
        <GpuCard key={gpu.gpu_index} gpu={gpu} onModelClick={onModelClick} />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// NodeGroup — collapsible group header + GPU grid for one pod
// ---------------------------------------------------------------------------
function NodeGroup({
  podId,
  data,
  isLeader,
  isExpanded,
  onToggle,
  onModelClick,
}: {
  podId: string
  data: MultiGpuMemoryUsageResponse
  isLeader: boolean
  isExpanded: boolean
  onToggle: () => void
  onModelClick?: (instanceId: string, podId: string) => void
}) {
  const handleModelClick = useCallback(
    (instanceId: string) => onModelClick?.(instanceId, podId),
    [onModelClick, podId]
  )
  const totalVram = data.gpus.reduce((s, g) => s + g.total_gb, 0)
  const usedVram = data.gpus.reduce((s, g) => s + g.used_gb, 0)
  const vramPct = totalVram > 0 ? Math.round((usedVram / totalVram) * 100) : 0
  const modelCount = data.gpus.reduce((s, g) => s + g.models.length, 0)

  return (
    <div style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}>
      {/* Header */}
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
          {podId}
        </span>
        <Label color="green" isCompact>healthy</Label>
        {isLeader && <Label color="blue" isCompact>leader</Label>}
        <span style={{ color: 'var(--pf-t--global--text--color--subtle)', fontSize: 'var(--pf-t--global--font--size--xs)', marginLeft: 'auto' }}>
          {data.gpus.length} GPU{data.gpus.length !== 1 ? 's' : ''} · {modelCount} model{modelCount !== 1 ? 's' : ''} · VRAM {vramPct}%
        </span>
      </div>

      {/* GPU grid */}
      {isExpanded && (
        <div
          style={{
            padding: 'var(--pf-t--global--spacer--sm)',
            border: '1px solid var(--pf-t--global--border--color--default)',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
          }}
        >
          <GpuGrid gpus={data.gpus} onModelClick={handleModelClick} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GpuMemoryPanel — main export
// ---------------------------------------------------------------------------
interface GpuMemoryPanelProps {
  defaultRefreshInterval?: number | null
  onModelClick?: (instanceId: string, podId?: string) => void
  refreshTrigger?: number
  onMemoryDataChange?: (data: MultiGpuMemoryUsageResponse) => void
  localPodId?: string | null
  clusterPodIds?: string[]
}

export function GpuMemoryPanel({
  defaultRefreshInterval = 5000,
  onModelClick,
  refreshTrigger,
  onMemoryDataChange,
  localPodId,
  clusterPodIds,
}: GpuMemoryPanelProps) {
  const [memoryData, setMemoryData] = useState<MultiGpuMemoryUsageResponse | null>(null)
  const [allPodsData, setAllPodsData] = useState<Record<string, MultiGpuMemoryUsageResponse>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<number | null>(defaultRefreshInterval)
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set())

  const isClusterMode = clusterPodIds && clusterPodIds.length > 1

  // Stable ref for onMemoryDataChange to avoid re-triggering fetch
  const onMemoryDataChangeRef = useRef(onMemoryDataChange)
  useEffect(() => { onMemoryDataChangeRef.current = onMemoryDataChange })

  const fetchMemoryUsage = useCallback(async () => {
    try {
      // Always fetch local pod data
      const localData = await apiClient.getMultiGpuMemoryUsage()
      setMemoryData(localData)
      setError(null)
      onMemoryDataChangeRef.current?.(localData)

      if (isClusterMode && clusterPodIds) {
        // Fetch all remote pods in parallel
        const results: Record<string, MultiGpuMemoryUsageResponse> = {}
        if (localPodId) results[localPodId] = localData

        const remotePods = clusterPodIds.filter((id) => id !== localPodId)
        const fetches = remotePods.map(async (podId) => {
          try {
            const data = await apiClient.getClusterPodMemory(podId)
            results[podId] = data
          } catch {
            // Keep stale data for this pod if available
          }
        })
        await Promise.all(fetches)

        setAllPodsData((prev) => ({ ...prev, ...results }))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch memory usage')
    } finally {
      setLoading(false)
    }
  }, [isClusterMode, clusterPodIds, localPodId])

  // Initial fetch and polling
  useEffect(() => {
    setLoading(true)
    fetchMemoryUsage()

    if (refreshInterval === null) return

    const interval = setInterval(fetchMemoryUsage, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchMemoryUsage, refreshInterval, refreshTrigger])

  const handleRefreshSelect = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined
  ) => {
    const interval = value === 'null' ? null : Number(value)
    setRefreshInterval(interval)
    setIsSelectOpen(false)
  }

  const selectedLabel = REFRESH_OPTIONS.find((opt) => opt.value === refreshInterval)?.label || '5s'

  const toggleNode = useCallback((podId: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev)
      if (next.has(podId)) next.delete(podId)
      else next.add(podId)
      return next
    })
  }, [])

  // Compute total free across all visible data
  const totalFreeGb = useMemo(() => {
    if (isClusterMode) {
      return Object.values(allPodsData).reduce((sum, pod) => sum + pod.total_system_free_gb, 0)
    }
    return memoryData?.total_system_free_gb ?? 0
  }, [isClusterMode, allPodsData, memoryData])

  const totalGpuCount = useMemo(() => {
    if (isClusterMode) {
      return Object.values(allPodsData).reduce((sum, pod) => sum + pod.gpus.length, 0)
    }
    return memoryData?.gpus.length ?? 0
  }, [isClusterMode, allPodsData, memoryData])

  // Determine leader pod ID from cluster data
  const leaderPodId = useMemo(() => {
    // The local pod's cluster status is the source of truth but we don't have it here.
    // Convention: first pod in the list is typically the leader, but we show the label
    // based on what ClusterOverview already displays. For now, skip leader detection
    // (ClusterOverview handles it). We'll just pass localPodId as a hint.
    return localPodId
  }, [localPodId])

  // Loading state
  if (loading && !memoryData) {
    return (
      <Card>
        <CardHeader>
          <Content component="h2">GPU Memory Overview</Content>
        </CardHeader>
        <CardBody>
          <Flex justifyContent={{ default: 'justifyContentCenter' }}>
            <FlexItem>
              <Spinner size="lg" aria-label="Loading memory data" />
            </FlexItem>
          </Flex>
        </CardBody>
      </Card>
    )
  }

  // Error state
  if (error && !memoryData) {
    return (
      <Card>
        <CardHeader>
          <Content component="h2">GPU Memory Overview</Content>
        </CardHeader>
        <CardBody>
          <Alert variant="warning" title="Memory data unavailable" isInline>
            {error}
          </Alert>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        actions={{
          actions: (
            <Select
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setIsSelectOpen(!isSelectOpen)}
                  isExpanded={isSelectOpen}
                  style={{ minWidth: '80px' }}
                >
                  Refresh: {selectedLabel}
                </MenuToggle>
              )}
              onSelect={handleRefreshSelect}
              selected={refreshInterval === null ? 'null' : String(refreshInterval)}
              isOpen={isSelectOpen}
              onOpenChange={setIsSelectOpen}
            >
              {REFRESH_OPTIONS.map((option) => (
                <SelectOption
                  key={option.value === null ? 'null' : option.value}
                  value={option.value === null ? 'null' : String(option.value)}
                >
                  {option.label}
                </SelectOption>
              ))}
            </Select>
          ),
        }}
      >
        <Content component="h2">GPU Memory Overview</Content>
      </CardHeader>
      <CardBody>
        {isClusterMode ? (
          // Cluster mode: one collapsible NodeGroup per pod
          <>
            {clusterPodIds.map((podId) => {
              const podData = allPodsData[podId]
              if (!podData) return null
              return (
                <NodeGroup
                  key={podId}
                  podId={podId}
                  data={podData}
                  isLeader={podId === leaderPodId}
                  isExpanded={expandedNodes.has(podId)}
                  onToggle={() => toggleNode(podId)}
                  onModelClick={onModelClick}
                />
              )
            })}
          </>
        ) : (
          // Single-pod mode: GPU grid directly
          memoryData && (
            <GpuGrid
              gpus={memoryData.gpus}
              onModelClick={
                onModelClick
                  ? (instanceId) => onModelClick(instanceId, localPodId ?? undefined)
                  : undefined
              }
            />
          )
        )}

        {/* Total free summary */}
        {totalGpuCount > 1 && (
          <div
            style={{
              marginTop: 'var(--pf-t--global--spacer--md)',
              paddingTop: 'var(--pf-t--global--spacer--sm)',
              borderTop: '1px solid var(--pf-t--global--border--color--default)',
            }}
          >
            <Content
              component="small"
              style={{ color: 'var(--pf-t--global--text--color--subtle)' }}
            >
              Total system free GPU memory: {formatGb(totalFreeGb)} across {totalGpuCount} GPUs
            </Content>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
