import { Tabs, Tab, TabTitleText, Label, Flex, FlexItem } from '@patternfly/react-core'
import { SpinnerIcon } from '@patternfly/react-icons'
import type { WorkspaceSession } from './workspace-types'

interface SessionTabsProps {
  sessions: Map<string, WorkspaceSession>
  activeSessionId: string | null
  onSessionSelect: (sessionId: string) => void
  onSessionClose: (sessionId: string) => void
}

/**
 * Horizontal tabs for switching between open sessions.
 * Each tab shows the model name and a close button.
 */
export function SessionTabs({
  sessions,
  activeSessionId,
  onSessionSelect,
  onSessionClose,
}: SessionTabsProps) {
  const sessionList = Array.from(sessions.values()).sort(
    (a, b) => new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime()
  )

  if (sessionList.length === 0) {
    return null
  }

  const handleTabSelect = (_event: React.MouseEvent<HTMLElement>, eventKey: string | number) => {
    onSessionSelect(String(eventKey))
  }

  const handleTabClose = (_event: React.MouseEvent<HTMLElement>, eventKey: string | number) => {
    onSessionClose(String(eventKey))
  }

  return (
    <Tabs
      activeKey={activeSessionId || ''}
      onSelect={handleTabSelect}
      onClose={handleTabClose}
      aria-label="Open sessions"
      isBox={false}
      style={{ flex: 1, minWidth: 0 }}
    >
      {sessionList.map((session) => {
        const modelName = session.model.model_path.split('/').pop() || session.model.model_path

        return (
          <Tab
            key={session.id}
            eventKey={session.id}
            title={
              session.status === 'generating' ? (
                <Flex
                  alignItems={{ default: 'alignItemsCenter' }}
                  gap={{ default: 'gapSm' }}
                  flexWrap={{ default: 'nowrap' }}
                >
                  <FlexItem>
                    <TabTitleText>{modelName}</TabTitleText>
                  </FlexItem>
                  <FlexItem>
                    <Label isCompact color="blue" icon={<SpinnerIcon className="pf-v6-u-spin" />}>
                      Generating
                    </Label>
                  </FlexItem>
                </Flex>
              ) : (
                <TabTitleText>{modelName}</TabTitleText>
              )
            }
            aria-label={`${modelName} tab`}
            closeButtonAriaLabel={`Close ${modelName}`}
          />
        )
      })}
    </Tabs>
  )
}
