import { Label, Spinner } from '@patternfly/react-core'
import type { ModelStatus } from '@sardeenz/types'

interface ModelStatusBadgeProps {
  status: ModelStatus
  isCompact?: boolean
}

/**
 * Status badge component that displays model status with appropriate colors
 * following PatternFly 6 design patterns.
 */
export function ModelStatusBadge({ status, isCompact = false }: ModelStatusBadgeProps) {
  const getColor = (): 'green' | 'orange' | 'grey' | 'red' | 'teal' | 'purple' => {
    switch (status) {
      case 'running':
        return 'green'
      case 'sleeping':
        return 'purple'
      case 'starting':
        return 'teal'
      case 'stopping':
        return 'grey'
      case 'failed':
        return 'red'
      default:
        return 'grey'
    }
  }

  const getLabel = (): string => {
    return status.charAt(0).toUpperCase() + status.slice(1)
  }

  const isLoading = status === 'starting' || status === 'stopping'

  return (
    <Label color={getColor()} isCompact={isCompact} icon={isLoading ? <Spinner size="sm" /> : undefined}>
      {getLabel()}
    </Label>
  )
}

export default ModelStatusBadge
