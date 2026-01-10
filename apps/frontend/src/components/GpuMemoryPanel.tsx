import { useState, useEffect, useCallback, useMemo } from 'react'
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
  Tabs,
  Tab,
  TabTitleText,
} from '@patternfly/react-core'
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

interface GpuMemoryPanelProps {
  defaultRefreshInterval?: number | null
}

/**
 * Panel displaying GPU and KVCache memory usage with Nivo bar charts.
 * Supports multiple GPUs with tabs for switching between them.
 * Shows two horizontal stacked bars:
 * - KVCache: shared pool (Prealloc / Used / Free)
 * - GPU: per-model breakdown with colors
 */
export function GpuMemoryPanel({ defaultRefreshInterval = 5000 }: GpuMemoryPanelProps) {
  const [memoryData, setMemoryData] = useState<MultiGpuMemoryUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<number | null>(defaultRefreshInterval)
  const [isSelectOpen, setIsSelectOpen] = useState(false)
  const [activeGpuIndex, setActiveGpuIndex] = useState(0)

  const fetchMemoryUsage = useCallback(async () => {
    try {
      const data = await apiClient.getMultiGpuMemoryUsage()
      setMemoryData(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch memory usage')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch and polling
  useEffect(() => {
    fetchMemoryUsage()

    if (refreshInterval === null) return

    const interval = setInterval(fetchMemoryUsage, refreshInterval)
    return () => clearInterval(interval)
  }, [fetchMemoryUsage, refreshInterval])

  // Get the currently selected GPU data
  const selectedGpu: PerGpuMetrics | null = useMemo(() => {
    if (!memoryData || memoryData.gpus.length === 0) return null
    // Find GPU by index or fallback to first
    const gpu = memoryData.gpus.find((g) => g.gpu_index === activeGpuIndex)
    return gpu || memoryData.gpus[0]
  }, [memoryData, activeGpuIndex])

  // Build KVCache bar data from per-GPU metrics
  const kvcacheData = useMemo(() => {
    // Use per-GPU kvcache from selected GPU (if available)
    const kvcache = selectedGpu?.kvcache
    if (!kvcache || kvcache.total_gb === 0) return []

    return [
      {
        id: 'KVCache',
        Prealloc: Number(kvcache.prealloc_gb.toFixed(2)),
        Used: Number(kvcache.used_gb.toFixed(2)),
        Free: Number(kvcache.free_gb.toFixed(2)),
      },
    ]
  }, [selectedGpu])

  // Build GPU bar data with per-model breakdown for selected GPU
  const gpuData = useMemo(() => {
    if (!selectedGpu) return { data: [], keys: [], colors: {} as Record<string, string> }

    const { models } = selectedGpu
    const modelsMemory = models.reduce((sum, m) => sum + m.gpu_memory_gb, 0)
    const otherMemory = Math.max(0, selectedGpu.used_gb - modelsMemory)
    const freeMemory = selectedGpu.free_gb

    // Build data object dynamically
    const dataObj: Record<string, number | string> = { id: 'GPU' }
    const keys: string[] = []
    const colors: Record<string, string> = {}

    // Add each model
    models.forEach((model) => {
      const key = model.display_name
      dataObj[key] = Number(model.gpu_memory_gb.toFixed(2))
      keys.push(key)
      colors[key] = model.color
    })

    // Add Other (system processes, etc.)
    if (otherMemory > 0.01) {
      dataObj['Other'] = Number(otherMemory.toFixed(2))
      keys.push('Other')
      colors['Other'] = '#8B8D8F'
    }

    // Add Free
    dataObj['Free'] = Number(freeMemory.toFixed(2))
    keys.push('Free')
    colors['Free'] = FREE_COLOR

    return { data: [dataObj], keys, colors }
  }, [selectedGpu])

  const formatGb = (value: number) => `${value.toFixed(2)} GB`

  const handleRefreshSelect = (
    _event: React.MouseEvent<Element, MouseEvent> | undefined,
    value: string | number | undefined
  ) => {
    const interval = value === 'null' ? null : Number(value)
    setRefreshInterval(interval)
    setIsSelectOpen(false)
  }

  const selectedLabel = REFRESH_OPTIONS.find((opt) => opt.value === refreshInterval)?.label || '5s'

  if (loading && !memoryData) {
    return (
      <Card>
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

  if (error && !memoryData) {
    return (
      <Card>
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
        {/* GPU Tabs for multi-GPU systems */}
        {memoryData && memoryData.gpus.length > 1 && (
          <Tabs
            activeKey={activeGpuIndex}
            onSelect={(_event, tabIndex) => setActiveGpuIndex(tabIndex as number)}
            aria-label="GPU selection tabs"
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            {memoryData.gpus.map((gpu) => (
              <Tab
                key={gpu.gpu_index}
                eventKey={gpu.gpu_index}
                title={<TabTitleText>GPU {gpu.gpu_index}: {gpu.name}</TabTitleText>}
              />
            ))}
          </Tabs>
        )}

        <Flex direction={{ default: 'row' }} gap={{ default: 'gapLg' }}>
          {/* GPU Memory Bar - Column 1 */}
          <FlexItem flex={{ default: 'flex_1' }}>
            <Content component="small" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              {memoryData && memoryData.gpus.length === 1 && selectedGpu && (
                <>{selectedGpu.name} — </>
              )}
              {formatGb(selectedGpu?.used_gb ?? 0)} / {formatGb(selectedGpu?.total_gb ?? 0)}{' '}
              ({selectedGpu?.utilization_percent.toFixed(0) ?? 0}% utilized)
            </Content>
            <div style={{ height: '40px', marginTop: 'var(--pf-t--global--spacer--xs)' }}>
              <ResponsiveBar
                data={gpuData.data}
                keys={gpuData.keys}
                indexBy="id"
                layout="horizontal"
                margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                padding={0}
                colors={(bar) => gpuData.colors[bar.id as string] || '#ccc'}
                borderRadius={4}
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
            <Flex gap={{ default: 'gapSm' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: 'var(--pf-t--global--spacer--xs)' }}>
              {selectedGpu?.models.map((model) => (
                <FlexItem key={`${model.instance_id}-${model.model_path}`}>
                  <span style={{ color: model.color }}>●</span>{' '}
                  <Content component="small">{model.display_name} ({formatGb(model.gpu_memory_gb)})</Content>
                </FlexItem>
              ))}
              {gpuData.keys.includes('Other') && (
                <FlexItem>
                  <span style={{ color: '#8B8D8F' }}>●</span>{' '}
                  <Content component="small">Other</Content>
                </FlexItem>
              )}
              <FlexItem>
                <span style={{ color: FREE_COLOR }}>●</span>{' '}
                <Content component="small">Free ({formatGb(selectedGpu?.free_gb ?? 0)})</Content>
              </FlexItem>
            </Flex>
          </FlexItem>

          {/* KVCache Memory Bar - Column 2 (Per-GPU) */}
          <FlexItem flex={{ default: 'flex_1' }}>
            <Content component="small" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              {memoryData && memoryData.gpus.length > 1 && `GPU ${selectedGpu?.gpu_index} `}
              KVCache Memory —{' '}
              {selectedGpu?.kvcache && selectedGpu.kvcache.total_gb > 0
                ? `${formatGb(selectedGpu.kvcache.used_gb)} / ${formatGb(selectedGpu.kvcache.total_gb)}`
                : 'No KVCache active'}
            </Content>
            {selectedGpu?.kvcache && selectedGpu.kvcache.total_gb > 0 ? (
              <>
                <div style={{ height: '40px', marginTop: 'var(--pf-t--global--spacer--xs)' }}>
                  <ResponsiveBar
                    data={kvcacheData}
                    keys={['Prealloc', 'Used', 'Free']}
                    indexBy="id"
                    layout="horizontal"
                    margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                    padding={0}
                    colors={(bar) => KVCACHE_COLORS[bar.id as keyof typeof KVCACHE_COLORS] || '#ccc'}
                    borderRadius={4}
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
                <Flex gap={{ default: 'gapSm' }} style={{ marginTop: 'var(--pf-t--global--spacer--xs)' }}>
                  <FlexItem>
                    <span style={{ color: KVCACHE_COLORS.Prealloc }}>●</span>{' '}
                    <Content component="small">Prealloc ({formatGb(selectedGpu.kvcache.prealloc_gb)})</Content>
                  </FlexItem>
                  <FlexItem>
                    <span style={{ color: KVCACHE_COLORS.Used }}>●</span>{' '}
                    <Content component="small">Used ({formatGb(selectedGpu.kvcache.used_gb)})</Content>
                  </FlexItem>
                  <FlexItem>
                    <span style={{ color: KVCACHE_COLORS.Free }}>●</span>{' '}
                    <Content component="small">Free ({formatGb(selectedGpu.kvcache.free_gb)})</Content>
                  </FlexItem>
                </Flex>
              </>
            ) : (
              <div style={{ height: '40px', marginTop: 'var(--pf-t--global--spacer--xs)', display: 'flex', alignItems: 'center' }}>
                <Content component="small" style={{ fontStyle: 'italic', color: 'var(--pf-t--global--text--color--subtle)' }}>
                  No models with kvcached enabled on this GPU
                </Content>
              </div>
            )}
          </FlexItem>
        </Flex>

        {/* Total system memory summary for multi-GPU */}
        {memoryData && memoryData.gpus.length > 1 && (
          <div style={{ marginTop: 'var(--pf-t--global--spacer--md)', paddingTop: 'var(--pf-t--global--spacer--sm)', borderTop: '1px solid var(--pf-t--global--border--color--default)' }}>
            <Content component="small" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              Total system free GPU memory: {formatGb(memoryData.total_system_free_gb)} across {memoryData.gpus.length} GPUs
            </Content>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
