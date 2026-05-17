import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient, type ClusterStatusResponse } from '../services/api'

export interface UseClusterStatusOptions {
  /** Called when leader changes (new leaderId, new leaderAddress) */
  onLeaderChange?: (leaderId: string, leaderAddress: string | null) => void
}

export interface UseClusterStatusReturn {
  clusterStatus: ClusterStatusResponse | null
  isClusterMode: boolean
  isLoading: boolean
  error: string | null
  refresh: () => void
}

const POLL_INTERVAL_MS = 10_000
const REDIRECT_DELAY_MS = 3_000

/**
 * Hook that polls GET /api/cluster every 10 seconds.
 * Exposes cluster state and isClusterMode flag.
 * Detects leader changes and can auto-redirect to the new leader.
 */
export function useClusterStatus(options?: UseClusterStatusOptions): UseClusterStatusReturn {
  const [clusterStatus, setClusterStatus] = useState<ClusterStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<number | null>(null)
  const previousLeaderIdRef = useRef<string | null>(null)
  const redirectTimeoutRef = useRef<number | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const fetchStatus = useCallback(async () => {
    try {
      const status = await apiClient.getClusterStatus()
      setClusterStatus(status)
      setError(null)

      // Detect leader change (only after initial load)
      if (
        previousLeaderIdRef.current !== null &&
        status.leaderId !== previousLeaderIdRef.current &&
        status.isClusterMode
      ) {
        // Leader has changed
        optionsRef.current?.onLeaderChange?.(status.leaderId, status.leaderAddress)

        // Auto-redirect to new leader after a brief delay
        if (status.leaderAddress && redirectTimeoutRef.current === null) {
          const addr = status.leaderAddress
          const isInternal = /^[\w.-]+:\d+$/.test(addr) && !addr.includes('//') && !addr.includes('@')
          if (isInternal) {
            redirectTimeoutRef.current = window.setTimeout(() => {
              window.location.href = `http://${addr}`
            }, REDIRECT_DELAY_MS)
          }
        }
      }

      previousLeaderIdRef.current = status.leaderId
    } catch (err) {
      // Don't clear existing status on transient errors
      setError(err instanceof Error ? err.message : 'Failed to fetch cluster status')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()

    intervalRef.current = window.setInterval(fetchStatus, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current)
      }
      if (redirectTimeoutRef.current !== null) {
        clearTimeout(redirectTimeoutRef.current)
      }
    }
  }, [fetchStatus])

  return {
    clusterStatus,
    isClusterMode: clusterStatus?.isClusterMode ?? false,
    isLoading,
    error,
    refresh: fetchStatus,
  }
}
