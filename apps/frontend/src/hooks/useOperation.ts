import { useCallback, useRef } from 'react'
import { useOperations, OperationType } from '../contexts/OperationsContext'

export interface UseOperationReturn {
  start: () => void
  end: () => void
  isActive: boolean
}

/**
 * Hook to manage a single operation lifecycle.
 * Automatically registers/unregisters operation with context.
 */
export function useOperation(
  type: OperationType,
  label: string,
  targetId?: string
): UseOperationReturn {
  const { startOperation, endOperation, operations } = useOperations()
  const operationIdRef = useRef<string | null>(null)

  const start = useCallback(() => {
    if (operationIdRef.current) {
      return
    }
    operationIdRef.current = startOperation({ type, label, targetId })
  }, [type, label, targetId, startOperation])

  const end = useCallback(() => {
    if (operationIdRef.current) {
      endOperation(operationIdRef.current)
      operationIdRef.current = null
    }
  }, [endOperation])

  const isActive = operationIdRef.current
    ? operations.some((op) => op.id === operationIdRef.current)
    : false

  return { start, end, isActive }
}
