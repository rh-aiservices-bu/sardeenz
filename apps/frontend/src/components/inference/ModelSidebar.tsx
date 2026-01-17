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

/**
 * Format GPU key to display label.
 */
function formatGpuLabel(gpuKey: string): string {
  if (gpuKey === 'multi-gpu') return 'Multi-GPU'
  return gpuKey.replace('gpu-', 'GPU ')
}

/**
 * Sidebar component for model selection.
 * Shows search input and models grouped by GPU assignment.
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
  // Filter models by search term
  const filteredModels = useMemo(() => {
    if (!searchTerm.trim()) return models

    const term = searchTerm.toLowerCase()
    return models.filter((m) => {
      const modelName = m.model_path.split('/').pop()?.toLowerCase() || ''
      const modelPath = m.model_path.toLowerCase()
      return modelName.includes(term) || modelPath.includes(term)
    })
  }, [models, searchTerm])

  // Group models by GPU
  const modelsByGpu = useMemo(() => {
    const groups = new Map<string, ModelInstanceDTO[]>()

    for (const model of filteredModels) {
      // Determine GPU key
      let gpuKey: string
      if (model.tensor_parallel_size && model.tensor_parallel_size > 1) {
        gpuKey = 'multi-gpu'
      } else if (model.gpu_ids && model.gpu_ids.length > 0) {
        gpuKey = `gpu-${model.gpu_ids[0]}`
      } else {
        gpuKey = 'gpu-0'
      }

      if (!groups.has(gpuKey)) {
        groups.set(gpuKey, [])
      }
      groups.get(gpuKey)!.push(model)
    }

    // Sort groups by key
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  }, [filteredModels])

  // Ref to maintain stable Set references across renders
  const expandedGroupsRef = useRef<Set<string>>(new Set())

  // Auto-expand groups when searching or when there's only one
  const effectiveExpandedGroups = useMemo(() => {
    const gpuKeys = Array.from(modelsByGpu.keys())

    if (searchTerm.trim() || modelsByGpu.size === 1) {
      // Auto-expand all when searching or single group
      // Check if keys are the same to avoid creating new Set
      const currentKeys = Array.from(expandedGroupsRef.current)
      const keysMatch =
        currentKeys.length === gpuKeys.length && gpuKeys.every((k) => expandedGroupsRef.current.has(k))
      if (!keysMatch) {
        expandedGroupsRef.current = new Set(gpuKeys)
      }
      return expandedGroupsRef.current
    }

    // Use user-controlled expansion if set
    if (expandedGpuGroups.size > 0) {
      return expandedGpuGroups
    }

    // Default to all expanded (but keep stable reference)
    const currentKeys = Array.from(expandedGroupsRef.current)
    const keysMatch =
      currentKeys.length === gpuKeys.length && gpuKeys.every((k) => expandedGroupsRef.current.has(k))
    if (!keysMatch) {
      expandedGroupsRef.current = new Set(gpuKeys)
    }
    return expandedGroupsRef.current
  }, [searchTerm, modelsByGpu, expandedGpuGroups])

  const handleSearchChange = (
    _event: React.FormEvent<HTMLInputElement>,
    value: string
  ) => {
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
        ) : (
          <Stack>
            {Array.from(modelsByGpu.entries()).map(([gpuKey, gpuModels]) => (
              <StackItem key={gpuKey}>
                <InferenceGpuGroup
                  gpuKey={gpuKey}
                  gpuLabel={formatGpuLabel(gpuKey)}
                  models={gpuModels}
                  isExpanded={effectiveExpandedGroups.has(gpuKey)}
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
