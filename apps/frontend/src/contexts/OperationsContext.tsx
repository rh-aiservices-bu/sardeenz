import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { v4 as uuidv4 } from 'uuid'

export type OperationType = 'sleep' | 'wake' | 'unload' | 'unload-all' | 'load-config'

export interface Operation {
  id: string
  type: OperationType
  label: string
  startedAt: Date
  targetId?: string
}

interface OperationsContextType {
  operations: Operation[]
  hasActiveOperations: boolean
  activeCount: number
  startOperation: (op: Omit<Operation, 'id' | 'startedAt'>) => string
  endOperation: (id: string) => void
  clearAllOperations: () => void
}

export const OperationsContext = createContext<OperationsContextType | undefined>(undefined)

export const useOperations = () => {
  const context = useContext(OperationsContext)
  if (!context) {
    throw new Error('useOperations must be used within an OperationsProvider')
  }
  return context
}

interface OperationsProviderProps {
  children: ReactNode
}

export const OperationsProvider: React.FC<OperationsProviderProps> = ({ children }) => {
  const [operations, setOperations] = useState<Operation[]>([])

  const startOperation = useCallback((op: Omit<Operation, 'id' | 'startedAt'>): string => {
    const id = uuidv4()
    const newOperation: Operation = {
      ...op,
      id,
      startedAt: new Date(),
    }
    setOperations((prev) => [...prev, newOperation])
    return id
  }, [])

  const endOperation = useCallback((id: string) => {
    setOperations((prev) => prev.filter((op) => op.id !== id))
  }, [])

  const clearAllOperations = useCallback(() => {
    setOperations([])
  }, [])

  const hasActiveOperations = operations.length > 0
  const activeCount = operations.length

  const value: OperationsContextType = {
    operations,
    hasActiveOperations,
    activeCount,
    startOperation,
    endOperation,
    clearAllOperations,
  }

  return <OperationsContext.Provider value={value}>{children}</OperationsContext.Provider>
}
