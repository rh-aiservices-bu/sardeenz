import { useEffect, useRef, useState, useCallback } from 'react'
import type { SSEEvent, SSEEventType, LogEvent, StatusEvent, ProgressEvent } from '@sardeenz/types'
import { apiClient } from '../services/api'

export interface UseInstanceEventsOptions {
  /** Instance ID to subscribe to. Pass null to not connect */
  instanceId: string | null
  /** Filter by event types (default: all) */
  eventTypes?: SSEEventType[]
  /** Replay buffered logs on connect (default: true) */
  replayLogs?: boolean
  /** Use cluster events endpoint (proxies to remote pod if needed) */
  useClusterEndpoint?: boolean
  /** Pod ID hint for cluster events (avoids race with heartbeat sync) */
  podId?: string
  /** Callback for any event */
  onEvent?: (event: SSEEvent) => void
  /** Callback for connection errors */
  onError?: (error: Event) => void
  /** Callback for status changes */
  onStatusChange?: (status: StatusEvent) => void
}

export interface UseInstanceEventsReturn {
  /** Whether SSE connection is active */
  isConnected: boolean
  /** Accumulated log events */
  logs: LogEvent[]
  /** Current status event */
  currentStatus: StatusEvent | null
  /** Last error event */
  lastError: Event | null
  /** Current progress value (0-100) */
  progress: number | null
  /** Current progress message */
  progressMessage: string | null
  /** Manually trigger reconnection */
  reconnect: () => void
  /** Clear accumulated logs */
  clearLogs: () => void
}

/**
 * React hook for subscribing to real-time events from a model instance via SSE.
 * Handles connection lifecycle, reconnection with exponential backoff, and event accumulation.
 */
export function useInstanceEvents(options: UseInstanceEventsOptions): UseInstanceEventsReturn {
  const {
    instanceId,
    eventTypes = ['log', 'status', 'memory', 'progress', 'error'],
    replayLogs = true,
    useClusterEndpoint = false,
    podId,
    onEvent,
    onError,
    onStatusChange,
  } = options

  const [isConnected, setIsConnected] = useState(false)
  const [logs, setLogs] = useState<LogEvent[]>([])
  const [currentStatus, setCurrentStatus] = useState<StatusEvent | null>(null)
  const [lastError, setLastError] = useState<Event | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [progressMessage, setProgressMessage] = useState<string | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const reconnectAttemptRef = useRef(0)

  // Store ALL unstable values in refs to avoid triggering effect reruns
  // This prevents infinite render loops when parent re-renders or default arrays are recreated
  const onEventRef = useRef(onEvent)
  const onErrorRef = useRef(onError)
  const onStatusChangeRef = useRef(onStatusChange)
  const eventTypesRef = useRef(eventTypes)
  const replayLogsRef = useRef(replayLogs)
  const useClusterEndpointRef = useRef(useClusterEndpoint)
  const podIdRef = useRef(podId)

  // Sync refs on each render (no cleanup needed, won't cause reconnection)
  useEffect(() => {
    onEventRef.current = onEvent
    onErrorRef.current = onError
    onStatusChangeRef.current = onStatusChange
    eventTypesRef.current = eventTypes
    replayLogsRef.current = replayLogs
    useClusterEndpointRef.current = useClusterEndpoint
    podIdRef.current = podId
  })

  const connect = useCallback(() => {
    if (!instanceId) return

    // Clean up existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Build URL with query params - use refs to avoid dependency issues
    const baseURL = import.meta.env.VITE_API_BASE_URL || ''
    const params = new URLSearchParams()
    const currentEventTypes = eventTypesRef.current
    if (currentEventTypes.length < 5) {
      params.set('types', currentEventTypes.join(','))
    }
    params.set('replay_logs', String(replayLogsRef.current))

    // Add auth token for SSE (EventSource can't send Authorization header)
    const token = apiClient.getAuthToken()
    if (token) {
      params.set('token', token)
    }

    const eventsPath = useClusterEndpointRef.current
      ? `/api/cluster/models/${instanceId}/events`
      : `/api/models/instances/${instanceId}/events`
    if (useClusterEndpointRef.current && podIdRef.current) {
      params.set('podId', podIdRef.current)
    }
    const url = `${baseURL}${eventsPath}?${params}`

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
      setLastError(null)
      reconnectAttemptRef.current = 0
    }

    eventSource.onerror = (e) => {
      setIsConnected(false)
      setLastError(e)
      onErrorRef.current?.(e)

      // Exponential backoff for reconnection: 1s, 2s, 4s, 8s, max 30s
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000)
      reconnectAttemptRef.current++

      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect()
      }, delay)
    }

    // Handle specific event types
    eventSource.addEventListener('log', (e: MessageEvent) => {
      const event: LogEvent = JSON.parse(e.data)
      setLogs((prev) => [...prev, event])
      onEventRef.current?.(event)
    })

    eventSource.addEventListener('status', (e: MessageEvent) => {
      const event: StatusEvent = JSON.parse(e.data)
      setCurrentStatus(event)
      onStatusChangeRef.current?.(event)
      onEventRef.current?.(event)
    })

    eventSource.addEventListener('memory', (e: MessageEvent) => {
      const event = JSON.parse(e.data)
      onEventRef.current?.(event)
    })

    eventSource.addEventListener('progress', (e: MessageEvent) => {
      const event: ProgressEvent = JSON.parse(e.data)
      if (event.data.progress !== undefined) {
        setProgress(event.data.progress)
      }
      if (event.data.message) {
        setProgressMessage(event.data.message)
      }
      onEventRef.current?.(event)
    })

    eventSource.addEventListener('error', (e: MessageEvent) => {
      const event = JSON.parse(e.data)
      onEventRef.current?.(event)
    })
  }, [instanceId]) // Only instanceId - all other values accessed via refs

  // Connect/disconnect on instanceId change only
  // Note: connect is stable (only depends on instanceId) so we don't need it in deps
  useEffect(() => {
    // Always reset state when instanceId changes (including to null)
    // This prevents stale logs from previous instance showing during next load
    setLogs([])
    setCurrentStatus(null)
    setLastError(null)
    setProgress(null)
    setProgressMessage(null)

    if (instanceId) {
      connect()
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
    }
  }, [instanceId, connect]) // connect is stable now (only depends on instanceId)

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0
    setLogs([])
    setCurrentStatus(null)
    connect()
  }, [connect])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  return {
    isConnected,
    logs,
    currentStatus,
    lastError,
    progress,
    progressMessage,
    reconnect,
    clearLogs,
  }
}
