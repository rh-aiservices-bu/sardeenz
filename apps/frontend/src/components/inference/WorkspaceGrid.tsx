import { useMemo, CSSProperties } from 'react'
import { EmptyState, EmptyStateBody, EmptyStateActions, Button } from '@patternfly/react-core'
import { CubesIcon } from '@patternfly/react-icons'
import type {
  LayoutMode,
  WorkspaceSession,
  SessionStatus,
  PaneAssignments,
} from './workspace-types'
import { ModelChatCard } from './ModelChatCard'
import { PaneSessionSelector } from './PaneSessionSelector'

interface WorkspaceGridProps {
  visibleSessions: WorkspaceSession[]
  layout: LayoutMode
  onSessionStatusChange: (sessionId: string, status: SessionStatus) => void
  sidebarExpanded: boolean
  onToggleSidebar: () => void
  /** All available sessions (for pane selector dropdown) */
  allSessions: WorkspaceSession[]
  /** Current pane assignments */
  paneAssignments: PaneAssignments
  /** Callback to assign a session to a pane */
  onAssignSessionToPane: (paneIndex: number, sessionId: string | null) => void
}

/**
 * Get CSS grid styles based on layout mode.
 */
function getGridStyles(layout: LayoutMode): CSSProperties {
  switch (layout) {
    case 'single':
      return {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gridTemplateRows: '1fr',
        gap: 'var(--pf-t--global--spacer--sm)',
        height: '100%',
      }
    case 'split-2':
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr',
        gap: 'var(--pf-t--global--spacer--sm)',
        height: '100%',
      }
    case 'grid-4':
      return {
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: '1fr 1fr',
        gap: 'var(--pf-t--global--spacer--sm)',
        height: '100%',
      }
    default:
      return {
        display: 'grid',
        gridTemplateColumns: '1fr',
        gridTemplateRows: '1fr',
        gap: 'var(--pf-t--global--spacer--md)',
        height: '100%',
      }
  }
}

/**
 * Grid container for displaying model chat cards.
 * Adapts layout based on the selected mode.
 */
export function WorkspaceGrid({
  visibleSessions,
  layout,
  onSessionStatusChange,
  sidebarExpanded,
  onToggleSidebar,
  allSessions,
  paneAssignments,
  onAssignSessionToPane,
}: WorkspaceGridProps) {
  const gridStyles = useMemo(() => getGridStyles(layout), [layout])
  const isMultiPane = layout !== 'single'
  const maxPanes = layout === 'split-2' ? 2 : 4
  // Only show selector when there are more sessions than available panes
  const showPaneSelector = isMultiPane && allSessions.length > maxPanes

  if (visibleSessions.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
        }}
      >
        <EmptyState titleText="No sessions open" icon={CubesIcon}>
          <EmptyStateBody>Select a model from the sidebar to start a chat session.</EmptyStateBody>
          <EmptyStateActions>
            <Button
              variant="link"
              onClick={() => {
                if (!sidebarExpanded) {
                  onToggleSidebar()
                }
              }}
            >
              Click on a model in the sidebar to begin
            </Button>
          </EmptyStateActions>
        </EmptyState>
      </div>
    )
  }

  return (
    <div style={gridStyles}>
      {visibleSessions.map((session, paneIndex) => (
        <div
          key={session.id}
          style={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {showPaneSelector && (
            <div
              style={{
                marginBottom: 'var(--pf-t--global--spacer--xs)',
                flexShrink: 0,
              }}
            >
              <PaneSessionSelector
                paneIndex={paneIndex}
                currentSession={session}
                allSessions={allSessions}
                paneAssignments={paneAssignments}
                onAssign={onAssignSessionToPane}
              />
            </div>
          )}
          <ModelChatCard
            model={session.model}
            onStatusChange={(status) => onSessionStatusChange(session.id, status)}
          />
        </div>
      ))}
    </div>
  )
}
