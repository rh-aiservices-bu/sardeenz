import { useEffect } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  ExpandableSection,
  Grid,
  GridItem,
  Label,
  Flex,
  FlexItem,
  EmptyState,
  EmptyStateBody,
} from '@patternfly/react-core'
import { CubesIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelCardCompact } from './ModelCardCompact'

interface GpuGroupSectionProps {
  gpuKey: string
  gpuLabel: string
  /** GPU index for this section (for drop target identification). Use -1 for multi-gpu. */
  gpuIndex: number
  /** Pod ID to namespace droppable IDs (prevents collisions in split view). */
  podId?: string
  models: ModelInstanceDTO[]
  isExpanded: boolean
  onToggle: (gpuKey: string) => void
  onUnload: (instanceId: string, modelPath: string, isFailed: boolean) => void
  onSleep?: (instanceId: string) => void
  onWake?: (instanceId: string) => void
  onMove?: (model: ModelInstanceDTO) => void
  unloadingInstanceId: string | null
  sleepingInstanceId?: string | null
  wakingInstanceId?: string | null
  expandedCards: Set<string>
  onCardToggle: (instanceId: string) => void
  /** KV cache total per GPU (gpu index -> total_gb) for max concurrent requests calculation */
  kvCacheTotalByGpu?: Record<number, number>
  /** GPU memory utilization per instance (instance_id -> percentage 0-1) for live updates */
  memoryUtilizationByInstance?: Record<string, number>
  /** When true, forces single-column layout (used in split-view where pane is already half-width) */
  isSplitView?: boolean
}

/**
 * Collapsible section for grouping models by GPU assignment.
 * Displays GPU label with model count badge, and contains ModelCardCompact components.
 */
export function GpuGroupSection({
  gpuKey,
  gpuLabel,
  gpuIndex,
  podId,
  models,
  isExpanded,
  onToggle,
  onUnload,
  onSleep,
  onWake,
  onMove,
  unloadingInstanceId,
  sleepingInstanceId,
  wakingInstanceId,
  expandedCards,
  onCardToggle,
  kvCacheTotalByGpu,
  memoryUtilizationByInstance,
  isSplitView,
}: GpuGroupSectionProps) {
  // Droppable setup for drag-and-drop model move
  const droppableId = podId ? `gpu-drop-${podId}-${gpuIndex}` : `gpu-drop-${gpuIndex}`
  const { setNodeRef, isOver, active } = useDroppable({
    id: droppableId,
    data: { gpuIndex, podId },
    disabled: gpuIndex === -1,
  })

  // Check if we're dragging a model that's already on this GPU (same GPU index AND same pod)
  const dragSourcePodId = active?.data?.current?.sourcePodId as string | undefined
  const isDraggedModelFromThisGpu = active?.data?.current?.model?.gpu_ids?.includes(gpuIndex)
    && (!podId || !dragSourcePodId || dragSourcePodId === podId)
  const showDropIndicator = isOver && !isDraggedModelFromThisGpu

  // Auto-expand collapsed sections immediately when hovering during drag
  useEffect(() => {
    // Expand if: dragging, hovering over this section, section is collapsed, not from this GPU
    if (active && isOver && !isExpanded && !isDraggedModelFromThisGpu) {
      onToggle(gpuKey)
    }
  }, [active, isOver, isExpanded, isDraggedModelFromThisGpu, onToggle, gpuKey])

  // Count models by status for summary
  const statusCounts = {
    running: models.filter((m) => m.status === 'running').length,
    starting: models.filter((m) => m.status === 'starting').length,
    sleeping: models.filter((m) => m.status === 'sleeping').length,
    stopping: models.filter((m) => m.status === 'stopping').length,
    failed: models.filter((m) => m.status === 'failed').length,
  }

  const handleToggle = () => {
    onToggle(gpuKey)
  }

  const toggleContent = (
    <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
      <FlexItem>
        <strong>{gpuLabel}</strong>
      </FlexItem>
      <FlexItem>
        <Label isCompact color="blue">
          {models.length} model{models.length !== 1 ? 's' : ''}
        </Label>
      </FlexItem>
      {statusCounts.running > 0 && (
        <FlexItem>
          <Label isCompact color="green">
            {statusCounts.running} running
          </Label>
        </FlexItem>
      )}
      {statusCounts.starting > 0 && (
        <FlexItem>
          <Label isCompact color="teal">
            {statusCounts.starting} starting
          </Label>
        </FlexItem>
      )}
      {statusCounts.sleeping > 0 && (
        <FlexItem>
          <Label isCompact color="purple">
            {statusCounts.sleeping} sleeping
          </Label>
        </FlexItem>
      )}
      {statusCounts.stopping > 0 && (
        <FlexItem>
          <Label isCompact color="grey">
            {statusCounts.stopping} stopping
          </Label>
        </FlexItem>
      )}
      {statusCounts.failed > 0 && (
        <FlexItem>
          <Label isCompact color="red">
            {statusCounts.failed} failed
          </Label>
        </FlexItem>
      )}
    </Flex>
  )

  return (
    <div
      ref={setNodeRef}
      style={{
        marginBottom: 'var(--pf-t--global--spacer--md)',
        padding: 'var(--pf-t--global--spacer--sm)',
        borderRadius: 'var(--pf-t--global--border--radius--medium)',
        border: showDropIndicator
          ? '2px dashed var(--pf-t--global--color--status--success--default)'
          : '2px dashed transparent',
        backgroundColor: showDropIndicator
          ? 'var(--pf-t--global--background--color--success--default)'
          : undefined,
        transition: 'border-color 0.2s, background-color 0.2s',
      }}
    >
      <ExpandableSection
        toggleContent={toggleContent}
        isExpanded={isExpanded}
        onToggle={handleToggle}
        displaySize="lg"
      >
        {models.length === 0 ? (
          <EmptyState variant="xs" icon={CubesIcon}>
            <EmptyStateBody>
              No models on this GPU. Drag a model here to move it.
            </EmptyStateBody>
          </EmptyState>
        ) : (
          <Grid hasGutter style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
            {models.map((model) => (
              <GridItem key={model.id} span={12} lg={isSplitView ? 12 : 6} xl={isSplitView ? 12 : 4}>
                <ModelCardCompact
                  id={`model-card-${model.id}`}
                  model={model}
                  onUnload={onUnload}
                  onSleep={onSleep}
                  onWake={onWake}
                  onMove={onMove}
                  isUnloading={unloadingInstanceId === model.id}
                  isSleeping={sleepingInstanceId === model.id}
                  isWaking={wakingInstanceId === model.id}
                  isExpanded={expandedCards.has(model.id)}
                  onToggle={() => onCardToggle(model.id)}
                  kvCacheTotalGb={kvCacheTotalByGpu?.[model.gpu_ids[0]]}
                  memoryUtilization={memoryUtilizationByInstance?.[model.id]}
                  sourcePodId={podId}
                />
              </GridItem>
            ))}
          </Grid>
        )}
      </ExpandableSection>
    </div>
  )
}

export default GpuGroupSection
