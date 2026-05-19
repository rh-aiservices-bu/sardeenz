import React from 'react'
import { Label, Spinner, Tooltip } from '@patternfly/react-core'
import { useOperations } from '../contexts/OperationsContext'

export const OperationsIndicator: React.FC = () => {
  const { hasActiveOperations, activeCount, operations } = useOperations()

  if (!hasActiveOperations) {
    return null
  }

  const tooltipContent = (
    <div>
      <p style={{ fontWeight: 'bold', margin: 0, marginBottom: 'var(--pf-t--global--spacer--xs)' }}>
        Active operations:
      </p>
      <ul style={{ margin: 0, paddingLeft: 'var(--pf-t--global--spacer--md)' }}>
        {operations.map((op) => (
          <li key={op.id}>{op.label}</li>
        ))}
      </ul>
    </div>
  )

  const labelText = activeCount === 1 ? '1 operation' : `${activeCount} operations`

  return (
    <div role="status" aria-live="polite" aria-atomic="true" aria-busy={hasActiveOperations}>
      <span className="pf-v6-screen-reader">
        {activeCount} operations in progress: {operations.map((op) => op.label).join(', ')}
      </span>
      <Tooltip content={tooltipContent} position="bottom">
        <Label
          color="blue"
          icon={<Spinner size="sm" aria-label="Operations in progress" />}
          isCompact
        >
          {labelText}
        </Label>
      </Tooltip>
    </div>
  )
}
