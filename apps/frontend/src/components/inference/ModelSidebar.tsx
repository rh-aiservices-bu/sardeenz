import { useMemo, useRef } from 'react'
import {
  SearchInput,
  Stack,
  StackItem,
  EmptyState,
  EmptyStateBody,
  Content,
  Flex,
  FlexItem,
  Button,
  Tooltip,
  ExpandableSection,
  Label,
} from '@patternfly/react-core'
import { CubesIcon, TimesCircleIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { InferenceGpuGroup } from './InferenceGpuGroup'
import type { WorkspaceSession } from './workspace-types'

interface ModelSidebarProps {
  models: ModelInstanceDTO[]
  searchTerm: string
  onSearchChange: (term: string) => void
  expandedGpuGroups: Set<string>
  onToggleGpuGroup: (gpuKey: string) => void
  onModelSelect: (model: ModelInstanceDTO) => void
  isModelOpen: (modelId: string) => boolean
  activeSessionId: string | null
  findSessionByModelId: (modelId: string) => WorkspaceSession | undefined
  /** Number of open sessions */
  sessionCount: number
  /** Callback to close all sessions */
  onCloseAllSessions?: () => void
}

function gpuKey(model: ModelInstanceDTO): string {
  if (model.tensor_parallel_size && model.tensor_parallel_size > 1) return 'multi-gpu'
  if (model.gpu_ids && model.gpu_ids.length > 0) return `gpu-${model.gpu_ids[0]}`
  return 'gpu-0'
}

function formatGpuLabel(key: string): string {
  if (key === 'multi-gpu') return 'Multi-GPU'
  return key.replace('gpu-', 'GPU ')
}

/**
 * Sidebar component for model selection.
 *
 * Single-pod mode: models grouped by GPU.
 * Cluster mode (any model has pod_id): two-level grouping — pod → GPU.
 */
export function ModelSidebar({
  models,
  searchTerm,
  onSearchChange,
  expandedGpuGroups,
  onToggleGpuGroup,
  onModelSelect,
  isModelOpen,
  activeSessionId,
  findSessionByModelId,
  sessionCount,
  onCloseAllSessions,
}: ModelSidebarProps) {
  const isClusterMode = models.some((m) => m.pod_id)

  // Filter models by search term
  const filteredModels = useMemo(() => {
    if (!searchTerm.trim()) return models
    const term = searchTerm.toLowerCase()
    return models.filter((m) => {
      const name = m.model_path.split('/').pop()?.toLowerCase() || ''
      return name.includes(term) || m.model_path.toLowerCase().includes(term)
    })
  }, [models, searchTerm])

  // Single-pod: group by GPU key
  const modelsByGpu = useMemo(() => {
    if (isClusterMode) return new Map<string, ModelInstanceDTO[]>()
    const groups = new Map<string, ModelInstanceDTO[]>()
    for (const model of filteredModels) {
      const key = gpuKey(model)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(model)
    }
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  }, [filteredModels, isClusterMode])

  // Cluster mode: group by pod → GPU
  const modelsByPod = useMemo(() => {
    if (!isClusterMode) return new Map<string, Map<string, ModelInstanceDTO[]>>()
    const pods = new Map<string, Map<string, ModelInstanceDTO[]>>()
    for (const model of filteredModels) {
      const podId = model.pod_id ?? 'unknown'
      if (!pods.has(podId)) pods.set(podId, new Map())
      const gpuGroups = pods.get(podId)!
      const key = gpuKey(model)
      if (!gpuGroups.has(key)) gpuGroups.set(key, [])
      gpuGroups.get(key)!.push(model)
    }
    return new Map([...pods.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  }, [filteredModels, isClusterMode])

  // Compute all expandable keys for auto-expand logic
  const allKeys = useMemo(() => {
    if (!isClusterMode) return Array.from(modelsByGpu.keys())
    const keys: string[] = []
    for (const [podId, gpuGroups] of modelsByPod) {
      keys.push(`pod:${podId}`)
      for (const key of gpuGroups.keys()) {
        keys.push(`${podId}:${key}`)
      }
    }
    return keys
  }, [isClusterMode, modelsByGpu, modelsByPod])

  // Ref to maintain stable Set references across renders
  const expandedGroupsRef = useRef<Set<string>>(new Set())

  const effectiveExpandedGroups = useMemo(() => {
    const shouldAutoExpand =
      searchTerm.trim() ||
      (isClusterMode ? modelsByPod.size === 1 : modelsByGpu.size === 1)

    if (shouldAutoExpand) {
      const keysMatch =
        allKeys.length === expandedGroupsRef.current.size &&
        allKeys.every((k) => expandedGroupsRef.current.has(k))
      if (!keysMatch) {
        expandedGroupsRef.current = new Set(allKeys)
      }
      return expandedGroupsRef.current
    }

    if (expandedGpuGroups.size > 0) return expandedGpuGroups

    // Default: all expanded
    const keysMatch =
      allKeys.length === expandedGroupsRef.current.size &&
      allKeys.every((k) => expandedGroupsRef.current.has(k))
    if (!keysMatch) {
      expandedGroupsRef.current = new Set(allKeys)
    }
    return expandedGroupsRef.current
  }, [searchTerm, isClusterMode, modelsByPod, modelsByGpu, expandedGpuGroups, allKeys])

  const handleSearchChange = (_event: React.FormEvent<HTMLInputElement>, value: string) => {
    onSearchChange(value)
  }

  const handleSearchClear = () => {
    onSearchChange('')
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsCenter' }}
        style={{
          padding: 'var(--pf-t--global--spacer--sm) var(--pf-t--global--spacer--md)',
          borderBottom: '1px solid var(--pf-t--global--border--color--default)',
        }}
      >
        <FlexItem>
          <Content component="h3" style={{ margin: 0 }}>
            Models
          </Content>
        </FlexItem>
        <FlexItem>
          <span
            style={{
              color: 'var(--pf-t--global--text--color--subtle)',
              fontSize: 'var(--pf-t--global--font--size--body--sm)',
            }}
          >
            {filteredModels.length} running
          </span>
        </FlexItem>
      </Flex>

      {/* Search and Close All */}
      <div
        style={{
          padding: 'var(--pf-t--global--spacer--sm) var(--pf-t--global--spacer--md)',
          borderBottom: '1px solid var(--pf-t--global--border--color--default)',
        }}
      >
        <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
          <FlexItem grow={{ default: 'grow' }}>
            <SearchInput
              aria-label="Search models"
              placeholder="Filter models..."
              value={searchTerm}
              onChange={handleSearchChange}
              onClear={handleSearchClear}
            />
          </FlexItem>
          {sessionCount > 0 && onCloseAllSessions && (
            <FlexItem>
              <Tooltip content="Close all sessions">
                <Button
                  variant="plain"
                  aria-label="Close all sessions"
                  onClick={onCloseAllSessions}
                  icon={<TimesCircleIcon />}
                />
              </Tooltip>
            </FlexItem>
          )}
        </Flex>
      </div>

      {/* Model List */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--pf-t--global--spacer--sm) var(--pf-t--global--spacer--md)',
        }}
      >
        {models.length === 0 ? (
          <EmptyState titleText="No running models" icon={CubesIcon} variant="sm">
            <EmptyStateBody>
              Load a model from the Model Management page to start testing.
            </EmptyStateBody>
          </EmptyState>
        ) : filteredModels.length === 0 ? (
          <EmptyState titleText="No matches" variant="sm">
            <EmptyStateBody>No models match your search.</EmptyStateBody>
          </EmptyState>
        ) : isClusterMode ? (
          // Cluster mode: pod → GPU grouping
          <Stack>
            {Array.from(modelsByPod.entries()).map(([podId, gpuGroups]) => {
              const podKey = `pod:${podId}`
              const podModelCount = Array.from(gpuGroups.values()).reduce(
                (sum, ms) => sum + ms.length,
                0
              )
              return (
                <StackItem key={podId}>
                  <ExpandableSection
                    toggleContent={
                      <Flex
                        gap={{ default: 'gapMd' }}
                        alignItems={{ default: 'alignItemsCenter' }}
                      >
                        <FlexItem>
                          <strong
                            style={{
                              fontSize: 'var(--pf-t--global--font--size--body--default)',
                            }}
                          >
                            {podId}
                          </strong>
                        </FlexItem>
                        <FlexItem>
                          <Label isCompact color="purple">
                            {podModelCount}
                          </Label>
                        </FlexItem>
                      </Flex>
                    }
                    isExpanded={effectiveExpandedGroups.has(podKey)}
                    onToggle={() => onToggleGpuGroup(podKey)}
                    displaySize="default"
                    style={{ marginBottom: 'var(--pf-t--global--spacer--xs)' }}
                  >
                    <div style={{ paddingLeft: 'var(--pf-t--global--spacer--sm)' }}>
                      {Array.from(
                        new Map(
                          [...gpuGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
                        ).entries()
                      ).map(([key, gpuModels]) => {
                        const compositeKey = `${podId}:${key}`
                        return (
                          <InferenceGpuGroup
                            key={compositeKey}
                            gpuKey={compositeKey}
                            gpuLabel={formatGpuLabel(key)}
                            models={gpuModels}
                            isExpanded={effectiveExpandedGroups.has(compositeKey)}
                            onToggle={onToggleGpuGroup}
                            onModelSelect={onModelSelect}
                            isModelOpen={isModelOpen}
                            activeSessionId={activeSessionId}
                            findSessionByModelId={findSessionByModelId}
                          />
                        )
                      })}
                    </div>
                  </ExpandableSection>
                </StackItem>
              )
            })}
          </Stack>
        ) : (
          // Single-pod mode: flat GPU grouping
          <Stack>
            {Array.from(modelsByGpu.entries()).map(([key, gpuModels]) => (
              <StackItem key={key}>
                <InferenceGpuGroup
                  gpuKey={key}
                  gpuLabel={formatGpuLabel(key)}
                  models={gpuModels}
                  isExpanded={effectiveExpandedGroups.has(key)}
                  onToggle={onToggleGpuGroup}
                  onModelSelect={onModelSelect}
                  isModelOpen={isModelOpen}
                  activeSessionId={activeSessionId}
                  findSessionByModelId={findSessionByModelId}
                />
              </StackItem>
            ))}
          </Stack>
        )}
      </div>
    </div>
  )
}
