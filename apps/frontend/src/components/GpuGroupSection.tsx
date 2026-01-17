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
  unloadingInstanceId: string | null
  expandedCards: Set<string>
  onCardToggle: (instanceId: string) => void
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
  unloadingInstanceId,
  expandedCards,
  onCardToggle,
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
          <Label isCompact color="orange">
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
              isUnloading={unloadingInstanceId === model.id}
              isExpanded={expandedCards.has(model.id)}
              onToggle={() => onCardToggle(model.id)}
            />
          </GridItem>
        ))}
      </Grid>
    </ExpandableSection>
  )
}

export default GpuGroupSection
