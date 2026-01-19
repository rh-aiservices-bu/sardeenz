import { useMemo, useEffect, useState } from 'react'
import type {
  LayoutMode,
  WorkspaceSession,
  SessionStatus,
  PaneAssignments,
} from './workspace-types'
import { WorkspaceToolbar } from './WorkspaceToolbar'
import { WorkspaceGrid } from './WorkspaceGrid'

interface WorkspaceAreaProps {
  sessions: Map<string, WorkspaceSession>
  activeSessionId: string | null
  layout: LayoutMode
  onLayoutChange: (layout: LayoutMode) => void
  onSessionClose: (sessionId: string) => void
  onSessionSelect: (sessionId: string | null) => void
  onSessionStatusChange: (sessionId: string, status: SessionStatus) => void
  getVisibleSessions: () => WorkspaceSession[]
  sidebarExpanded: boolean
  onToggleSidebar: () => void
  paneAssignments: PaneAssignments
  onAssignSessionToPane: (paneIndex: number, sessionId: string | null) => void
}

/**
 * Responsive breakpoints for layout constraints.
 */
const BREAKPOINTS = {
  sm: 768,
  md: 1200,
}

/**
 * Main workspace area containing toolbar and chat grid.
 */
export function WorkspaceArea({
  sessions,
  activeSessionId,
  layout,
  onLayoutChange,
  onSessionClose,
  onSessionSelect,
  onSessionStatusChange,
  getVisibleSessions,
  sidebarExpanded,
  onToggleSidebar,
  paneAssignments,
  onAssignSessionToPane,
}: WorkspaceAreaProps) {
  const [windowWidth, setWindowWidth] = useState(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  )

  // Track window width for responsive layouts
  useEffect(() => {
    const handleResize = () => {
      setWindowWidth(window.innerWidth)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Determine disabled layouts based on viewport
  const disabledLayouts = useMemo((): LayoutMode[] => {
    if (windowWidth < BREAKPOINTS.sm) {
      return ['split-2', 'grid-4']
    }
    if (windowWidth < BREAKPOINTS.md) {
      return ['grid-4']
    }
    return []
  }, [windowWidth])

  // Auto-adjust layout if current layout is disabled
  useEffect(() => {
    if (disabledLayouts.includes(layout)) {
      if (disabledLayouts.includes('split-2')) {
        onLayoutChange('single')
      } else {
        onLayoutChange('split-2')
      }
    }
  }, [disabledLayouts, layout, onLayoutChange])

  // Get visible sessions - called directly during render (refs are already synced)
  const visibleSessions = getVisibleSessions()

  // Get all sessions as array for pane selector
  const allSessions = useMemo(() => Array.from(sessions.values()), [sessions])

  // Handle session selection from tabs
  const handleSessionSelect = (sessionId: string) => {
    onSessionSelect(sessionId)
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Toolbar */}
      <WorkspaceToolbar
        sessions={sessions}
        activeSessionId={activeSessionId}
        layout={layout}
        onLayoutChange={onLayoutChange}
        onSessionSelect={handleSessionSelect}
        onSessionClose={onSessionClose}
        sidebarExpanded={sidebarExpanded}
        onToggleSidebar={onToggleSidebar}
        disabledLayouts={disabledLayouts}
      />

      {/* Grid Area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--pf-t--global--spacer--sm)',
        }}
      >
        <WorkspaceGrid
          visibleSessions={visibleSessions}
          layout={layout}
          onSessionStatusChange={onSessionStatusChange}
          sidebarExpanded={sidebarExpanded}
          onToggleSidebar={onToggleSidebar}
          allSessions={allSessions}
          paneAssignments={paneAssignments}
          onAssignSessionToPane={onAssignSessionToPane}
        />
      </div>
    </div>
  )
}
