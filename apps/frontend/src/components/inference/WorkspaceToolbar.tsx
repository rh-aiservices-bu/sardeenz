import { Flex, FlexItem, Button, Divider, Tooltip } from '@patternfly/react-core'
import { BarsIcon } from '@patternfly/react-icons'
import type { LayoutMode, WorkspaceSession } from './workspace-types'
import { SessionTabs } from './SessionTabs'
import { LayoutSelector } from './LayoutSelector'

interface WorkspaceToolbarProps {
  sessions: Map<string, WorkspaceSession>
  activeSessionId: string | null
  layout: LayoutMode
  onLayoutChange: (layout: LayoutMode) => void
  onSessionSelect: (sessionId: string) => void
  onSessionClose: (sessionId: string) => void
  sidebarExpanded: boolean
  onToggleSidebar: () => void
  /** Disabled layouts based on viewport */
  disabledLayouts?: LayoutMode[]
}

/**
 * Toolbar for the workspace area.
 * Contains sidebar toggle, session tabs, and layout selector.
 */
export function WorkspaceToolbar({
  sessions,
  activeSessionId,
  layout,
  onLayoutChange,
  onSessionSelect,
  onSessionClose,
  sidebarExpanded,
  onToggleSidebar,
  disabledLayouts = [],
}: WorkspaceToolbarProps) {
  return (
    <Flex
      alignItems={{ default: 'alignItemsCenter' }}
      gap={{ default: 'gapMd' }}
      style={{
        padding: '0px var(--pf-t--global--spacer--sm)',
        borderBottom: '1px solid var(--pf-t--global--border--color--default)',
        backgroundColor: 'var(--pf-t--global--background--color--secondary--default)',
        minHeight: '48px',
      }}
    >
      {/* Sidebar Toggle */}
      <FlexItem>
        <Tooltip content={sidebarExpanded ? 'Hide sidebar' : 'Show sidebar'}>
          <Button
            variant="plain"
            aria-label={sidebarExpanded ? 'Hide sidebar' : 'Show sidebar'}
            onClick={onToggleSidebar}
            aria-pressed={sidebarExpanded}
          >
            <BarsIcon />
          </Button>
        </Tooltip>
      </FlexItem>

      <Divider orientation={{ default: 'vertical' }} />

      {/* Session Tabs */}
      <FlexItem style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        <SessionTabs
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSessionSelect={onSessionSelect}
          onSessionClose={onSessionClose}
        />
      </FlexItem>

      <Divider orientation={{ default: 'vertical' }} />

      {/* Layout Selector */}
      <FlexItem>
        <LayoutSelector
          layout={layout}
          onLayoutChange={onLayoutChange}
          disabledLayouts={disabledLayouts}
        />
      </FlexItem>
    </Flex>
  )
}
