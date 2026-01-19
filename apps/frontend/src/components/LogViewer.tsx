import { useState, useRef, useEffect } from 'react'
import {
  CodeBlock,
  CodeBlockCode,
  Flex,
  FlexItem,
  Button,
  Spinner,
  Label,
} from '@patternfly/react-core'
import { ExpandIcon, CompressIcon, SyncAltIcon } from '@patternfly/react-icons'
import type { LogEvent } from '@sardeenz/types'

interface LogViewerProps {
  /** Array of log events to display */
  logs: LogEvent[]
  /** Whether logs are actively loading */
  isLoading?: boolean
  /** Whether SSE connection is active */
  isConnected?: boolean
  /** Number of lines to show when collapsed */
  collapsedLineCount?: number
  /** Max height when expanded */
  maxHeight?: string
  /** Callback to trigger reconnection */
  onReconnect?: () => void
  /** Whether to start expanded */
  defaultExpanded?: boolean
}

/**
 * Expandable log viewer component for displaying vLLM process output.
 * Shows last N lines when collapsed, full log when expanded.
 * Auto-scrolls to bottom as new logs arrive.
 */
export function LogViewer({
  logs,
  isLoading = false,
  isConnected = true,
  collapsedLineCount = 5,
  maxHeight = '400px',
  onReconnect,
  defaultExpanded = false,
}: LogViewerProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const codeRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.scrollTop = codeRef.current.scrollHeight
    }
  }, [logs])

  // Get visible logs based on collapsed/expanded state
  const visibleLogs = isExpanded ? logs : logs.slice(-collapsedLineCount)

  // Format logs for display
  const formattedLogs = visibleLogs
    .map((log) => {
      const prefix = log.data.stream === 'stderr' ? '[ERR] ' : ''
      return `${prefix}${log.data.content}`
    })
    .join('\n')

  if (logs.length === 0 && !isLoading) {
    return (
      <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
        <FlexItem>
          <Label color="grey">Waiting for logs...</Label>
        </FlexItem>
      </Flex>
    )
  }

  return (
    <div>
      <Flex
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        alignItems={{ default: 'alignItemsCenter' }}
        style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}
      >
        <FlexItem>
          <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
            {isLoading && <Spinner size="sm" aria-label="Loading logs" />}
            <Label color={isConnected ? 'green' : 'orange'}>
              {isConnected ? 'Live' : 'Reconnecting...'}
            </Label>
            <span style={{ color: 'var(--pf-t--global--color--nonstatus--gray--default)' }}>
              {logs.length} lines
            </span>
          </Flex>
        </FlexItem>
        <FlexItem>
          <Flex gap={{ default: 'gapSm' }}>
            {!isConnected && onReconnect && (
              <Button variant="link" icon={<SyncAltIcon />} onClick={onReconnect} size="sm">
                Reconnect
              </Button>
            )}
            <Button
              variant="plain"
              icon={isExpanded ? <CompressIcon /> : <ExpandIcon />}
              onClick={() => setIsExpanded(!isExpanded)}
              aria-label={isExpanded ? 'Collapse logs' : 'Expand logs'}
            />
          </Flex>
        </FlexItem>
      </Flex>

      <div
        ref={codeRef}
        style={{
          maxHeight: isExpanded ? maxHeight : '150px',
          overflow: 'auto',
          transition: 'max-height 0.2s ease-in-out',
        }}
      >
        <CodeBlock>
          <CodeBlockCode>{formattedLogs || 'Waiting for output...'}</CodeBlockCode>
        </CodeBlock>
      </div>

      {!isExpanded && logs.length > collapsedLineCount && (
        <Button
          variant="link"
          onClick={() => setIsExpanded(true)}
          style={{ marginTop: 'var(--pf-t--global--spacer--xs)' }}
        >
          Show {logs.length - collapsedLineCount} more lines
        </Button>
      )}
    </div>
  )
}

export default LogViewer
