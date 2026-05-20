import { useEffect, useRef, useState, useCallback } from 'react'
import { apiClient, type MoveProgressEvent } from '../services/api'

export interface UseMoveEventsOptions {
  /** Move ID to subscribe to. Pass null to not connect */
  moveId: string | null
  /** Use cluster-aware SSE relay (works when the move may live on a remote pod) */
  clusterMode?: boolean
  /** Callback for progress updates */
  onProgress?: (event: MoveProgressEvent) => void
  /** Callback for connection errors */
  onError?: (error: Event) => void
  /** Callback when move completes or fails */
  onComplete?: (event: MoveProgressEvent) => void
}

export interface UseMoveEventsReturn {
  /** Whether SSE connection is active */
  isConnected: boolean
  /** Current phase of the move operation */
  currentPhase: MoveProgressEvent['phase'] | null
  /** Current progress percentage (0-100) */
  progress: number
  /** Latest status message */
  message: string
  /** Error message if failed */
  error: string | null
  /** Last connection error event */
  lastConnectionError: Event | null
}

/**
 * React hook for subscribing to real-time move progress events via SSE.
 * Handles connection lifecycle and reconnection with exponential backoff.
 */
export function useMoveEvents(options: UseMoveEventsOptions): UseMoveEventsReturn {
  const { moveId, clusterMode, onProgress, onError, onComplete } = options

  const [isConnected, setIsConnected] = useState(false)
  const [currentPhase, setCurrentPhase] = useState<MoveProgressEvent['phase'] | null>(null)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [lastConnectionError, setLastConnectionError] = useState<Event | null>(null)

  const unsubscribeRef = useRef<(() => void) | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)
  const isTerminalRef = useRef(false)

  // Store callbacks in refs to avoid dependency issues
  const onProgressRef = useRef(onProgress)
  const onErrorRef = useRef(onError)
  const onCompleteRef = useRef(onComplete)

  useEffect(() => {
    onProgressRef.current = onProgress
    onErrorRef.current = onError
    onCompleteRef.current = onComplete
  })

  const connect = useCallback(() => {
    if (!moveId) return

    // Don't reconnect after terminal state
    if (isTerminalRef.current) return

    // Clean up existing connection
    if (unsubscribeRef.current) {
      unsubscribeRef.current()
      unsubscribeRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    const handleProgress = (event: MoveProgressEvent) => {
      setCurrentPhase(event.phase)
      setMessage(event.message)
      if (event.progress !== undefined) {
        setProgress(event.progress)
      }
      if (event.error) {
        setError(event.error)
      }

      onProgressRef.current?.(event)

      // Check for terminal states
      if (event.phase === 'completed' || event.phase === 'failed') {
        isTerminalRef.current = true // Mark as terminal to prevent reconnection
        onCompleteRef.current?.(event)
        // Close connection on terminal state
        if (unsubscribeRef.current) {
          unsubscribeRef.current()
          unsubscribeRef.current = null
        }
        setIsConnected(false)
      }
    }

    const handleError = (e: Event) => {
      setIsConnected(false)
      setLastConnectionError(e)
      onErrorRef.current?.(e)

      // Don't reconnect if we've reached a terminal state (use ref to avoid stale closure)
      if (isTerminalRef.current) {
        return
      }

      // Exponential backoff for reconnection: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000)
      reconnectAttemptRef.current++

      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, delay)
    }

    // Subscribe to events — use cluster relay when in cluster mode so we can
    // receive progress from moves that were proxied to a remote pod
    unsubscribeRef.current = clusterMode
      ? apiClient.subscribeClusterMoveEvents(moveId, handleProgress, handleError)
      : apiClient.subscribeMoveEvents(moveId, handleProgress, handleError)
    setIsConnected(true)
    setLastConnectionError(null)
    reconnectAttemptRef.current = 0
  }, [moveId, clusterMode]) // clusterMode is stable per dialog open

  // Connect/disconnect on moveId change
  useEffect(() => {
    // Reset state when moveId changes
    isTerminalRef.current = false
    setCurrentPhase(null)
    setProgress(0)
    setMessage('')
    setError(null)
    setLastConnectionError(null)

    if (moveId) {
      connect()
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [moveId, connect])

  return {
    isConnected,
    currentPhase,
    progress,
    message,
    error,
    lastConnectionError,
  }
}
