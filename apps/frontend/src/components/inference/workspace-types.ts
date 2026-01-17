import type { ModelInstanceDTO } from '@sardeenz/types'

/**
 * Layout mode for the workspace area.
 * - single: One chat visible at a time
 * - split-2: Two chats side by side
 * - grid-4: Four chats in a 2x2 grid
 */
export type LayoutMode = 'single' | 'split-2' | 'grid-4'

/**
 * Maps pane positions to session IDs for explicit assignment.
 * Position 0 = first pane, 1 = second pane, etc.
 * null or missing means "auto-assign" (fallback to creation order).
 */
export type PaneAssignments = Record<number, string | null>

/**
 * Status of a chat session in the workspace.
 */
export type SessionStatus = 'idle' | 'generating'

/**
 * A single workspace session representing an open model chat.
 */
export interface WorkspaceSession {
  id: string
  modelId: string
  model: ModelInstanceDTO
  status: SessionStatus
  addedAt: string
}

/**
 * Complete state for the inference workspace.
 */
export interface WorkspaceState {
  /** Map of session ID to session data */
  sessions: Map<string, WorkspaceSession>
  /** Currently active session ID (focused in single view) */
  activeSessionId: string | null
  /** Current layout mode */
  layout: LayoutMode
  /** Whether the sidebar is expanded */
  sidebarExpanded: boolean
  /** Current search term for filtering models in sidebar */
  searchTerm: string
  /** Set of expanded GPU group keys in sidebar */
  expandedGpuGroups: Set<string>
  /** Explicit pane-to-session assignments for multi-pane layouts */
  paneAssignments: PaneAssignments
}

/**
 * Actions available for the workspace state.
 */
export interface WorkspaceActions {
  /** Add a model to the workspace as a new session */
  addSession: (model: ModelInstanceDTO) => void
  /** Remove a session from the workspace */
  removeSession: (sessionId: string) => void
  /** Set the active session */
  setActiveSession: (sessionId: string | null) => void
  /** Update session status (idle/generating) */
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void
  /** Change the layout mode */
  setLayout: (layout: LayoutMode) => void
  /** Toggle sidebar expansion */
  toggleSidebar: () => void
  /** Set sidebar expansion state */
  setSidebarExpanded: (expanded: boolean) => void
  /** Update search term */
  setSearchTerm: (term: string) => void
  /** Toggle a GPU group expansion in sidebar */
  toggleGpuGroup: (gpuKey: string) => void
  /** Get visible sessions based on layout */
  getVisibleSessions: () => WorkspaceSession[]
  /** Check if a model is already open in workspace */
  isModelOpen: (modelId: string) => boolean
  /** Find session by model ID */
  findSessionByModelId: (modelId: string) => WorkspaceSession | undefined
  /** Clear all sessions at once */
  clearAllSessions: () => void
  /** Synchronize sessions with currently running models */
  syncSessions: (runningModels: ModelInstanceDTO[]) => void
  /** Assign a session to a specific pane position */
  assignSessionToPane: (paneIndex: number, sessionId: string | null) => void
  /** Clear all pane assignments (revert to auto-assign) */
  clearPaneAssignments: () => void
}

/**
 * Storage key for persisting workspace preferences (localStorage).
 */
export const WORKSPACE_STORAGE_KEY = 'sardeenz-inference-workspace'

/**
 * Storage key for persisting open session model IDs (sessionStorage).
 * Survives page refresh, clears on tab close.
 */
export const SESSION_STORAGE_KEY = 'sardeenz-inference-sessions'

/**
 * Default workspace state values.
 */
export const DEFAULT_WORKSPACE_STATE: Omit<WorkspaceState, 'sessions' | 'expandedGpuGroups'> = {
  activeSessionId: null,
  layout: 'single',
  sidebarExpanded: true,
  searchTerm: '',
  paneAssignments: {},
}
