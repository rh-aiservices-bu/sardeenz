import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { apiClient } from '../services/api'

// Configuration
const INITIAL_DELAY_MS = 2000
const MAX_DELAY_MS = 15000
const MAX_WAIT_TIME_MS = 5 * 60 * 1000 // 5 minutes total timeout

const getBackoffDelay = (attempt: number) =>
  Math.min(INITIAL_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)

type ConnectionStatus = 'connecting' | 'connected' | 'failed'

interface ConnectionContextType {
  status: ConnectionStatus
  isConnected: boolean
  retryConnection: () => void
  version: string | null
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined)

export const useConnection = () => {
  const context = useContext(ConnectionContext)
  if (!context) {
    throw new Error('useConnection must be used within a ConnectionProvider')
  }
  return context
}

interface ConnectionProviderProps {
  children: ReactNode
}

export const ConnectionProvider = ({ children }: ConnectionProviderProps) => {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const [version, setVersion] = useState<string | null>(null)

  const checkConnection = useCallback(async (): Promise<boolean> => {
    const startTime = Date.now()
    let attempt = 0

    while (Date.now() - startTime < MAX_WAIT_TIME_MS) {
      try {
        const result = await apiClient.healthCheck()
        setVersion(result.version)
        return true
      } catch {
        // Calculate delay with exponential backoff
        const delay = getBackoffDelay(attempt)
        attempt++

        // Check if we'd exceed timeout with this delay
        if (Date.now() - startTime + delay >= MAX_WAIT_TIME_MS) {
          return false
        }

        // Wait before next attempt
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }

    return false
  }, [])

  const initConnection = useCallback(async () => {
    setStatus('connecting')
    const connected = await checkConnection()
    setStatus(connected ? 'connected' : 'failed')
  }, [checkConnection])

  const retryConnection = useCallback(() => {
    initConnection()
  }, [initConnection])

  useEffect(() => {
    initConnection()
  }, [initConnection])

  const value: ConnectionContextType = {
    status,
    isConnected: status === 'connected',
    retryConnection,
    version,
  }

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>
}
