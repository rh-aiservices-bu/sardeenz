import { ExpandableSection, Grid, GridItem, Label, Flex, FlexItem } from '@patternfly/react-core'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelCardCompact } from './ModelCardCompact'

interface GpuGroupSectionProps {
  gpuKey: string
  gpuLabel: string
  models: ModelInstanceDTO[]
  isExpanded: boolean
  onToggle: (gpuKey: string) => void
  onUnload: (instanceId: string, modelPath: string, isFailed: boolean) => void
  onSleep?: (instanceId: string) => void
  onWake?: (instanceId: string) => void
  unloadingInstanceId: string | null
  sleepingInstanceId?: string | null
  wakingInstanceId?: string | null
  expandedCards: Set<string>
  onCardToggle: (instanceId: string) => void
  /** KV cache total per GPU (gpu index -> total_gb) for max concurrent requests calculation */
  kvCacheTotalByGpu?: Record<number, number>
  /** GPU memory utilization per instance (instance_id -> percentage 0-1) for live updates */
  memoryUtilizationByInstance?: Record<string, number>
}

/**
 * Collapsible section for grouping models by GPU assignment.
 * Displays GPU label with model count badge, and contains ModelCardCompact components.
 */
export function GpuGroupSection({
  gpuKey,
  gpuLabel,
  models,
  isExpanded,
  onToggle,
  onUnload,
  onSleep,
  onWake,
  unloadingInstanceId,
  sleepingInstanceId,
  wakingInstanceId,
  expandedCards,
  onCardToggle,
  kvCacheTotalByGpu,
  memoryUtilizationByInstance,
}: GpuGroupSectionProps) {
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
    <ExpandableSection
      toggleContent={toggleContent}
      isExpanded={isExpanded}
      onToggle={handleToggle}
      displaySize="lg"
      style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
    >
      <Grid hasGutter style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
        {models.map((model) => (
          <GridItem key={model.id} span={12} lg={6} xl={4}>
            <ModelCardCompact
              id={`model-card-${model.id}`}
              model={model}
              onUnload={onUnload}
              onSleep={onSleep}
              onWake={onWake}
              isUnloading={unloadingInstanceId === model.id}
              isSleeping={sleepingInstanceId === model.id}
              isWaking={wakingInstanceId === model.id}
              isExpanded={expandedCards.has(model.id)}
              onToggle={() => onCardToggle(model.id)}
              kvCacheTotalGb={kvCacheTotalByGpu?.[model.gpu_ids[0]]}
              memoryUtilization={memoryUtilizationByInstance?.[model.id]}
            />
          </GridItem>
        ))}
      </Grid>
    </ExpandableSection>
  )
}

export default GpuGroupSection
