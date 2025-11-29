import { Label, Spinner } from '@patternfly/react-core'
import type { ModelStatus } from '@sardeenz/types'

interface ModelStatusBadgeProps {
  status: ModelStatus
}

/**
 * Status badge component that displays model status with appropriate colors
 * following PatternFly 6 design patterns.
 */
export function ModelStatusBadge({ status }: ModelStatusBadgeProps) {
  const getColor = (): 'green' | 'orange' | 'grey' | 'red' | 'blue' | 'purple' => {
    switch (status) {
      case 'running':
        return 'green'
      case 'sleeping':
        return 'purple'
      case 'starting':
        return 'blue'
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
    <Label color={getColor()} icon={isLoading ? <Spinner size="sm" /> : undefined}>
      {getLabel()}
    </Label>
  )
}

export default ModelStatusBadge
