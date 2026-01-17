import { useState, useEffect } from 'react'
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Alert,
  Spinner,
  CodeBlock,
  CodeBlockCode,
  CodeBlockAction,
  ClipboardCopyButton,
  Flex,
  FlexItem,
} from '@patternfly/react-core'
import { apiClient } from '../services/api'

interface ViewLogsDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean
  /** Callback when dialog should close */
  onClose: () => void
  /** Instance ID to fetch logs for */
  instanceId: string
  /** Model path for display in title */
  modelPath: string
}

/**
 * Modal dialog for viewing historical loading logs for a model instance.
 * Fetches logs from the API when opened and displays them in a code block.
 */
export function ViewLogsDialog({ isOpen, onClose, instanceId, modelPath }: ViewLogsDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [lineCount, setLineCount] = useState(0)
  const [copied, setCopied] = useState(false)

  // Fetch logs when dialog opens
  useEffect(() => {
    if (!isOpen || !instanceId) {
      return
    }

    setLoading(true)
    setError(null)

    apiClient
      .getInstanceLogs(instanceId)
      .then((response) => {
        setLogs(response.logs)
        setLineCount(response.line_count)
        setLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to fetch logs')
        setLoading(false)
      })
  }, [isOpen, instanceId])

  const handleClose = () => {
    setLogs('')
    setLineCount(0)
    setError(null)
    setCopied(false)
    onClose()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(logs)
    setCopied(true)
    // Reset after 2 seconds
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal variant={ModalVariant.large} isOpen={isOpen} onClose={handleClose}>
      <ModalHeader title={`Loading Logs - ${modelPath}`} />
      <ModalBody>
        {loading && (
          <Flex justifyContent={{ default: 'justifyContentCenter' }}>
            <FlexItem>
              <Spinner aria-label="Loading logs" />
            </FlexItem>
          </Flex>
        )}

        {error && (
          <Alert variant="danger" isInline title="Failed to load logs">
            {error}
          </Alert>
        )}

        {!loading && !error && (
          <>
            <Flex
              justifyContent={{ default: 'justifyContentSpaceBetween' }}
              style={{ marginBottom: 'var(--pf-t--global--spacer--sm)' }}
            >
              <FlexItem>
                <span style={{ color: 'var(--pf-t--global--color--nonstatus--gray--default)' }}>
                  {lineCount} lines
                </span>
              </FlexItem>
            </Flex>

            <div
              style={{
                maxHeight: '500px',
                overflow: 'auto',
              }}
            >
              <CodeBlock
                actions={
                  logs ? (
                    <CodeBlockAction>
                      <ClipboardCopyButton
                        id="copy-logs-button"
                        aria-label="Copy logs to clipboard"
                        onClick={handleCopy}
                        variant="plain"
                      >
                        {copied ? 'Copied!' : 'Copy'}
                      </ClipboardCopyButton>
                    </CodeBlockAction>
                  ) : undefined
                }
              >
                <CodeBlockCode id="logs-code">{logs || 'No logs available'}</CodeBlockCode>
              </CodeBlock>
            </div>
          </>
        )}
      </ModalBody>

      <ModalFooter>
        <Button variant="primary" onClick={handleClose}>
          Close
        </Button>
      </ModalFooter>
    </Modal>
  )
}

export default ViewLogsDialog
