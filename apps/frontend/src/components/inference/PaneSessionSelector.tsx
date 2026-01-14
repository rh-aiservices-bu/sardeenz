import { useState, useMemo } from 'react'
import { Select, SelectOption, SelectList, MenuToggle, Divider } from '@patternfly/react-core'
import type { WorkspaceSession, PaneAssignments } from './workspace-types'

interface PaneSessionSelectorProps {
  /** The pane index (0-based) */
  paneIndex: number
  /** The session currently displayed in this pane */
  currentSession: WorkspaceSession
  /** All available sessions */
  allSessions: WorkspaceSession[]
  /** Current pane assignments */
  paneAssignments: PaneAssignments
  /** Callback when a session is assigned to this pane */
  onAssign: (paneIndex: number, sessionId: string | null) => void
}

/**
 * Get a short display name from a model path.
 * E.g., "meta-llama/Llama-3.2-1B-Instruct" -> "Llama-3.2-1B-Instruct"
 */
function getModelDisplayName(modelPath: string): string {
  const parts = modelPath.split('/')
  return parts[parts.length - 1] || modelPath
}

/**
 * Dropdown selector for choosing which session appears in a pane.
 * Allows users to swap sessions between panes in multi-pane layouts.
 */
export function PaneSessionSelector({
  paneIndex,
  currentSession,
  allSessions,
  paneAssignments,
  onAssign,
}: PaneSessionSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Check if this pane has an explicit assignment
  const isExplicitlyAssigned = paneAssignments[paneIndex] === currentSession.id

  // Get sessions that are explicitly assigned to other panes
  const sessionsInOtherPanes = useMemo(() => {
    const result = new Set<string>()
    for (const [idx, sessionId] of Object.entries(paneAssignments)) {
      if (Number(idx) !== paneIndex && sessionId) {
        result.add(sessionId)
      }
    }
    return result
  }, [paneAssignments, paneIndex])

  // Sort sessions by creation time
  const sortedSessions = useMemo(() => {
    return [...allSessions].sort(
      (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
    )
  }, [allSessions])

  const handleSelect = (sessionId: string | null) => {
    onAssign(paneIndex, sessionId)
    setIsOpen(false)
  }

  const toggleLabel = getModelDisplayName(currentSession.model.model_path)

  return (
    <Select
      aria-label={`Select session for pane ${paneIndex + 1}`}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      toggle={(toggleRef) => (
        <MenuToggle
          ref={toggleRef}
          onClick={() => setIsOpen(!isOpen)}
          isExpanded={isOpen}
          isFullWidth
          style={{
            fontSize: 'var(--pf-t--global--font--size--body--sm)',
            maxWidth: '200px',
          }}
        >
          {toggleLabel}
        </MenuToggle>
      )}
    >
      <SelectList>
        {/* Auto option to revert to default behavior */}
        <SelectOption
          value="auto"
          isSelected={!isExplicitlyAssigned}
          onClick={() => handleSelect(null)}
          description="Use default order"
        >
          Auto
        </SelectOption>
        <Divider />
        {/* List all available sessions */}
        {sortedSessions.map((session) => {
          const isCurrentSession = session.id === currentSession.id
          const isInOtherPane = sessionsInOtherPanes.has(session.id)
          const displayName = getModelDisplayName(session.model.model_path)

          return (
            <SelectOption
              key={session.id}
              value={session.id}
              isSelected={isCurrentSession && isExplicitlyAssigned}
              onClick={() => handleSelect(session.id)}
              description={isInOtherPane ? 'Will swap with current' : undefined}
            >
              {displayName}
            </SelectOption>
          )
        })}
      </SelectList>
    </Select>
  )
}
