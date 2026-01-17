import { useCallback, useMemo } from 'react'
import { ExpandableSection, Flex, FlexItem, Label, Stack, StackItem } from '@patternfly/react-core'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelSidebarItem } from './ModelSidebarItem'
import type { WorkspaceSession } from './workspace-types'

interface InferenceGpuGroupProps {
  gpuKey: string
  gpuLabel: string
  models: ModelInstanceDTO[]
  isExpanded: boolean
  onToggle: (gpuKey: string) => void
  onModelSelect: (model: ModelInstanceDTO) => void
  isModelOpen: (modelId: string) => boolean
  activeSessionId: string | null
  findSessionByModelId: (modelId: string) => WorkspaceSession | undefined
}

/**
 * Collapsible GPU group for the inference sidebar.
 * Shows GPU label with model count, expandable to show model list.
 */
export function InferenceGpuGroup({
  gpuKey,
  gpuLabel,
  models,
  isExpanded,
  onToggle,
  onModelSelect,
  isModelOpen,
  activeSessionId,
  findSessionByModelId,
}: InferenceGpuGroupProps) {
  const handleToggle = useCallback(() => {
    onToggle(gpuKey)
  }, [onToggle, gpuKey])

  const toggleContent = useMemo(
    () => (
      <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem>
          <strong style={{ fontSize: 'var(--pf-t--global--font--size--body--default)' }}>
            {gpuLabel}
          </strong>
        </FlexItem>
        <FlexItem>
          <Label isCompact color="blue">
            {models.length}
          </Label>
        </FlexItem>
      </Flex>
    ),
    [gpuLabel, models.length]
  )

  return (
    <ExpandableSection
      toggleContent={toggleContent}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      displaySize="default"
      style={{ marginBottom: 'var(--pf-t--global--spacer--xs)' }}
    >
      <Stack hasGutter style={{ paddingLeft: 'var(--pf-t--global--spacer--sm)' }}>
        {models.map((model) => {
          const isOpen = isModelOpen(model.id)
          const session = findSessionByModelId(model.id)
          const isActive = session ? session.id === activeSessionId : false

          return (
            <StackItem key={model.id}>
              <ModelSidebarItem
                model={model}
                isOpen={isOpen}
                isActive={isActive}
                onSelect={onModelSelect}
              />
            </StackItem>
          )
        })}
      </Stack>
    </ExpandableSection>
  )
}
