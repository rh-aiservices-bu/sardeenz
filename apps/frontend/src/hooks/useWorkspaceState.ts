import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { ModelInstanceDTO } from '@sardeenz/types'
import type {
  WorkspaceState,
  WorkspaceActions,
  WorkspaceSession,
  LayoutMode,
  SessionStatus,
  PaneAssignments,
} from '../components/inference/workspace-types'
import {
  WORKSPACE_STORAGE_KEY,
  DEFAULT_WORKSPACE_STATE,
  SESSION_STORAGE_KEY,
} from '../components/inference/workspace-types'

/**
 * Persisted preferences that survive page reloads.
 */
interface PersistedPreferences {
  layout: LayoutMode
  sidebarExpanded: boolean
  paneAssignments: PaneAssignments
}

/**
 * Load persisted preferences from localStorage.
 */
function loadPersistedPreferences(): Partial<PersistedPreferences> {
  try {
    const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Ignore parse errors
  }
  return {}
}

/**
 * Save preferences to localStorage.
 */
function savePersistedPreferences(prefs: PersistedPreferences): void {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Persisted session data stored in sessionStorage.
 * Only stores model IDs and active session's model ID - actual model data comes from API.
 */
interface PersistedSessionData {
  openModelIds: string[]
  activeModelId: string | null
}

/**
 * Load persisted session data from sessionStorage.
 */
function loadPersistedSessionData(): PersistedSessionData | null {
  try {
    const stored = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored)
    }
  } catch {
    // Ignore parse errors
  }
  return null
}

/**
 * Save session data to sessionStorage.
 */
function savePersistedSessionData(data: PersistedSessionData): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear session data from sessionStorage.
 */
function clearPersistedSessionData(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Ignore storage errors
  }
}

/**
 * Custom hook for managing inference workspace state.
 * Handles sessions, layout, sidebar state, and search with localStorage persistence.
 */
export function useWorkspaceState(): WorkspaceState & WorkspaceActions {
  // Load initial preferences from localStorage
  const persistedPrefs = useMemo(() => loadPersistedPreferences(), [])

  const [sessions, setSessions] = useState<Map<string, WorkspaceSession>>(new Map())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [layout, setLayoutState] = useState<LayoutMode>(
    persistedPrefs.layout ?? DEFAULT_WORKSPACE_STATE.layout
  )
  const [sidebarExpanded, setSidebarExpandedState] = useState(
    persistedPrefs.sidebarExpanded ?? DEFAULT_WORKSPACE_STATE.sidebarExpanded
  )
  const [searchTerm, setSearchTerm] = useState(DEFAULT_WORKSPACE_STATE.searchTerm)
  const [expandedGpuGroups, setExpandedGpuGroups] = useState<Set<string>>(new Set())
  const [paneAssignments, setPaneAssignments] = useState<PaneAssignments>(
    persistedPrefs.paneAssignments ?? DEFAULT_WORKSPACE_STATE.paneAssignments
  )

  // Refs to hold current state values for stable callbacks
  const sessionsRef = useRef(sessions)
  const activeSessionIdRef = useRef(activeSessionId)
  const layoutRef = useRef(layout)
  const paneAssignmentsRef = useRef(paneAssignments)

  // Sync refs synchronously during render (not in useEffect) so callbacks
  // read the latest values when called during render
  sessionsRef.current = sessions
  activeSessionIdRef.current = activeSessionId
  layoutRef.current = layout
  paneAssignmentsRef.current = paneAssignments

  // Persist layout, sidebar, and pane assignment preferences
  useEffect(() => {
    savePersistedPreferences({ layout, sidebarExpanded, paneAssignments })
  }, [layout, sidebarExpanded, paneAssignments])

  // Persist session data to sessionStorage when sessions change
  useEffect(() => {
    if (sessions.size === 0) {
      clearPersistedSessionData()
      return
    }

    const openModelIds = Array.from(sessions.values()).map((s) => s.modelId)
    const activeSession = activeSessionId ? sessions.get(activeSessionId) : null
    const activeModelId = activeSession?.modelId ?? null

    savePersistedSessionData({ openModelIds, activeModelId })
  }, [sessions, activeSessionId])

  /**
   * Add a new session for a model.
   */
  const addSession = useCallback((model: ModelInstanceDTO) => {
    const sessionId = crypto.randomUUID()
    const session: WorkspaceSession = {
      id: sessionId,
      modelId: model.id,
      model,
      status: 'idle',
      addedAt: new Date().toISOString(),
    }

    setSessions((prev) => {
      const next = new Map(prev)
      next.set(sessionId, session)
      return next
    })

    // Auto-activate the new session
    setActiveSessionId(sessionId)
  }, [])

  /**
   * Remove a session from the workspace.
   */
  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => {
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })

    // Clear pane assignment for removed session
    setPaneAssignments((prev) => {
      const hasAssignment = Object.values(prev).includes(sessionId)
      if (!hasAssignment) return prev
      const next: PaneAssignments = {}
      for (const [paneIndex, assignedId] of Object.entries(prev)) {
        if (assignedId !== sessionId) {
          next[Number(paneIndex)] = assignedId
        }
      }
      return next
    })

    // If we removed the active session, activate another one (use ref for stable callback)
    if (activeSessionIdRef.current === sessionId) {
      setSessions((prev) => {
        const remaining = Array.from(prev.keys())
        setActiveSessionId(remaining.length > 0 ? remaining[0] : null)
        return prev
      })
    }
  }, [])

  /**
   * Set the active session.
   */
  const setActiveSession = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId)
  }, [])

  /**
   * Update session status (idle/generating).
   */
  const updateSessionStatus = useCallback((sessionId: string, status: SessionStatus) => {
    setSessions((prev) => {
      const session = prev.get(sessionId)
      if (!session) return prev
      const next = new Map(prev)
      next.set(sessionId, { ...session, status })
      return next
    })
  }, [])

  /**
   * Set layout mode with persistence.
   */
  const setLayout = useCallback((newLayout: LayoutMode) => {
    setLayoutState(newLayout)
  }, [])

  /**
   * Toggle sidebar expansion.
   */
  const toggleSidebar = useCallback(() => {
    setSidebarExpandedState((prev) => !prev)
  }, [])

  /**
   * Set sidebar expanded state.
   */
  const setSidebarExpanded = useCallback((expanded: boolean) => {
    setSidebarExpandedState(expanded)
  }, [])

  /**
   * Toggle GPU group expansion in sidebar.
   */
  const toggleGpuGroup = useCallback((gpuKey: string) => {
    setExpandedGpuGroups((prev) => {
      const next = new Set(prev)
      if (next.has(gpuKey)) {
        next.delete(gpuKey)
      } else {
        next.add(gpuKey)
      }
      return next
    })
  }, [])

  /**
   * Get visible sessions based on current layout mode and pane assignments.
   * - single: only active session
   * - split-2/grid-4: uses pane assignments if set, otherwise falls back to creation order
   * Uses refs for stable callback reference.
   */
  const getVisibleSessions = useCallback((): WorkspaceSession[] => {
    const currentSessions = sessionsRef.current
    const allSessions = Array.from(currentSessions.values()).sort(
      (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
    )

    if (allSessions.length === 0) return []

    const layout = layoutRef.current

    // Single layout: show active session or first session
    if (layout === 'single') {
      const activeSession = activeSessionIdRef.current
        ? currentSessions.get(activeSessionIdRef.current)
        : null
      return activeSession ? [activeSession] : allSessions.slice(0, 1)
    }

    // Multi-pane layouts: use pane assignments with fallback to creation order
    const maxPanes = layout === 'split-2' ? 2 : 4
    const assignments = paneAssignmentsRef.current
    const result: WorkspaceSession[] = []
    const usedSessionIds = new Set<string>()

    for (let paneIndex = 0; paneIndex < maxPanes; paneIndex++) {
      const assignedId = assignments[paneIndex]
      let session: WorkspaceSession | undefined

      // Try to use explicitly assigned session
      if (assignedId && currentSessions.has(assignedId)) {
        session = currentSessions.get(assignedId)
      }

      // Use assigned session if valid and not already used
      if (session && !usedSessionIds.has(session.id)) {
        result.push(session)
        usedSessionIds.add(session.id)
      } else {
        // Fallback: find first available session by creation order
        const fallback = allSessions.find((s) => !usedSessionIds.has(s.id))
        if (fallback) {
          result.push(fallback)
          usedSessionIds.add(fallback.id)
        }
      }
    }

    return result
  }, [])

  /**
   * Check if a model is already open in the workspace.
   * Uses ref for stable callback reference.
   */
  const isModelOpen = useCallback((modelId: string): boolean => {
    return Array.from(sessionsRef.current.values()).some((s) => s.modelId === modelId)
  }, [])

  /**
   * Find session by model ID.
   * Uses ref for stable callback reference.
   */
  const findSessionByModelId = useCallback((modelId: string): WorkspaceSession | undefined => {
    return Array.from(sessionsRef.current.values()).find((s) => s.modelId === modelId)
  }, [])

  /**
   * Clear all sessions at once.
   */
  const clearAllSessions = useCallback(() => {
    setSessions(new Map())
    setActiveSessionId(null)
    clearPersistedSessionData()
  }, [])

  /**
   * Assign a session to a specific pane position.
   * If the session is already assigned to another pane, swap the assignments.
   */
  const assignSessionToPane = useCallback((paneIndex: number, sessionId: string | null) => {
    setPaneAssignments((prev) => {
      const next = { ...prev }

      // If assigning null, just clear this pane's assignment
      if (sessionId === null) {
        delete next[paneIndex]
        return next
      }

      // Find if this session is already assigned to another pane
      const existingPaneIndex = Object.entries(prev).find(
        ([, id]) => id === sessionId
      )?.[0]

      if (existingPaneIndex !== undefined) {
        // Swap: give the other pane our current assignment
        const currentAssignment = prev[paneIndex]
        if (currentAssignment) {
          next[Number(existingPaneIndex)] = currentAssignment
        } else {
          delete next[Number(existingPaneIndex)]
        }
      }

      // Assign the session to this pane
      next[paneIndex] = sessionId
      return next
    })
  }, [])

  /**
   * Clear all pane assignments (revert to auto-assign by creation order).
   */
  const clearPaneAssignments = useCallback(() => {
    setPaneAssignments({})
  }, [])

  /**
   * Synchronize sessions with currently running models.
   * - Restores sessions from sessionStorage for matching model IDs
   * - Removes sessions for models no longer running
   */
  const syncSessions = useCallback((runningModels: ModelInstanceDTO[]) => {
    const runningModelIds = new Set(runningModels.map((m) => m.id))
    const modelById = new Map(runningModels.map((m) => [m.id, m]))

    setSessions((prev) => {
      // First, remove any sessions for models that are no longer running
      const updated = new Map(prev)
      let hasChanges = false

      for (const [sessionId, session] of prev) {
        if (!runningModelIds.has(session.modelId)) {
          updated.delete(sessionId)
          hasChanges = true
        } else {
          // Update model data only if relevant fields changed (compare by value, not reference)
          const updatedModel = modelById.get(session.modelId)
          if (updatedModel) {
            const modelChanged =
              updatedModel.status !== session.model.status ||
              updatedModel.model_path !== session.model.model_path
            if (modelChanged) {
              updated.set(sessionId, { ...session, model: updatedModel })
              hasChanges = true
            }
          }
        }
      }

      // If no existing sessions and we have persisted data, restore sessions
      if (prev.size === 0) {
        const persistedData = loadPersistedSessionData()
        if (persistedData && persistedData.openModelIds.length > 0) {
          let firstSessionId: string | null = null
          let activeRestoredSessionId: string | null = null

          for (const modelId of persistedData.openModelIds) {
            const model = modelById.get(modelId)
            if (model) {
              const sessionId = crypto.randomUUID()
              const session: WorkspaceSession = {
                id: sessionId,
                modelId: model.id,
                model,
                status: 'idle',
                addedAt: new Date().toISOString(),
              }
              updated.set(sessionId, session)
              hasChanges = true

              if (!firstSessionId) {
                firstSessionId = sessionId
              }

              // Track if this is the previously active model
              if (modelId === persistedData.activeModelId) {
                activeRestoredSessionId = sessionId
              }
            }
          }

          // Restore active session
          if (activeRestoredSessionId) {
            setActiveSessionId(activeRestoredSessionId)
          } else if (firstSessionId) {
            setActiveSessionId(firstSessionId)
          }
        }
      }

      return hasChanges || prev.size === 0 ? updated : prev
    })
  }, [])

  return useMemo(
    () => ({
      // State
      sessions,
      activeSessionId,
      layout,
      sidebarExpanded,
      searchTerm,
      expandedGpuGroups,
      paneAssignments,
      // Actions (all stable - use refs internally, so empty dependency arrays)
      addSession,
      removeSession,
      setActiveSession,
      updateSessionStatus,
      setLayout,
      toggleSidebar,
      setSidebarExpanded,
      setSearchTerm,
      toggleGpuGroup,
      getVisibleSessions,
      isModelOpen,
      findSessionByModelId,
      clearAllSessions,
      syncSessions,
      assignSessionToPane,
      clearPaneAssignments,
    }),
    // Only depend on state values - callbacks are stable (empty deps, use refs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, activeSessionId, layout, sidebarExpanded, searchTerm, expandedGpuGroups, paneAssignments]
  )
}
