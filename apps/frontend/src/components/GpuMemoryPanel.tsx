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
} from '@patternfly/react-core'
import { ResponsiveBar } from '@nivo/bar'
import type { MemoryUsageResponse } from '@sardeenz/types'
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
 * Shows two horizontal stacked bars:
 * - KVCache: shared pool (Prealloc / Used / Free)
 * - GPU: per-model breakdown with colors
 */
export function GpuMemoryPanel({ defaultRefreshInterval = 5000 }: GpuMemoryPanelProps) {
  const [memoryData, setMemoryData] = useState<MemoryUsageResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshInterval, setRefreshInterval] = useState<number | null>(defaultRefreshInterval)
  const [isSelectOpen, setIsSelectOpen] = useState(false)

  const fetchMemoryUsage = useCallback(async () => {
    try {
      const data = await apiClient.getMemoryUsage()
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

  // Build KVCache bar data
  const kvcacheData = useMemo(() => {
    if (!memoryData) return []
    const { kvcache } = memoryData
    return [
      {
        id: 'KVCache',
        Prealloc: Number(kvcache.prealloc_gb.toFixed(2)),
        Used: Number(kvcache.used_gb.toFixed(2)),
        Free: Number(kvcache.free_gb.toFixed(2)),
      },
    ]
  }, [memoryData])

  // Build GPU bar data with per-model breakdown
  const gpuData = useMemo(() => {
    if (!memoryData) return { data: [], keys: [], colors: {} as Record<string, string> }

    const { gpu, models } = memoryData
    const modelsMemory = models.reduce((sum, m) => sum + m.gpu_memory_gb, 0)
    const otherMemory = Math.max(0, gpu.used_gb - modelsMemory)
    const freeMemory = gpu.free_gb

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
  }, [memoryData])

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
        <Flex direction={{ default: 'row' }} gap={{ default: 'gapLg' }}>
          {/* GPU Memory Bar - Column 1 */}
          <FlexItem flex={{ default: 'flex_1' }}>
            <Content component="small" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              GPU Memory —{' '}
              {formatGb(memoryData?.gpu.used_gb ?? 0)} / {formatGb(memoryData?.gpu.total_gb ?? 0)}{' '}
              ({memoryData?.gpu.utilization_percent.toFixed(0)}% utilized)
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
              {memoryData?.models.map((model) => (
                <FlexItem key={model.model_path}>
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
                <Content component="small">Free ({formatGb(memoryData?.gpu.free_gb ?? 0)})</Content>
              </FlexItem>
            </Flex>
          </FlexItem>

          {/* KVCache Memory Bar - Column 2 */}
          <FlexItem flex={{ default: 'flex_1' }}>
            <Content component="small" style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
              KVCache Memory (Shared Pool) —{' '}
              {formatGb(memoryData?.kvcache.used_gb ?? 0)} / {formatGb(memoryData?.kvcache.total_gb ?? 0)}
            </Content>
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
                <Content component="small">Prealloc ({formatGb(memoryData?.kvcache.prealloc_gb ?? 0)})</Content>
              </FlexItem>
              <FlexItem>
                <span style={{ color: KVCACHE_COLORS.Used }}>●</span>{' '}
                <Content component="small">Used ({formatGb(memoryData?.kvcache.used_gb ?? 0)})</Content>
              </FlexItem>
              <FlexItem>
                <span style={{ color: KVCACHE_COLORS.Free }}>●</span>{' '}
                <Content component="small">Free ({formatGb(memoryData?.kvcache.free_gb ?? 0)})</Content>
              </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </CardBody>
    </Card>
  )
}
