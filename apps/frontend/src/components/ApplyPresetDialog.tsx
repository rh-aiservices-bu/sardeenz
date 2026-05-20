import { useState } from 'react'
import {
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Alert,
  Spinner,
  Flex,
  FlexItem,
  Label,
} from '@patternfly/react-core'
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table'
import { apiClient, extractErrorMessage, type PresetApplicationResult } from '../services/api'

interface ApplyPresetDialogProps {
  isOpen: boolean
  onClose: () => void
  presetId: string | null
  presetName: string
  onApplyComplete?: () => void
}

export function ApplyPresetDialog({
  isOpen,
  onClose,
  presetId,
  presetName,
  onApplyComplete,
}: ApplyPresetDialogProps) {
  const [dryRunResult, setDryRunResult] = useState<PresetApplicationResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applyResult, setApplyResult] = useState<PresetApplicationResult | null>(null)

  const handleDryRun = async () => {
    if (!presetId) return
    setIsLoading(true)
    setError(null)

    try {
      const result = await apiClient.applyPreset(presetId, { dryRun: true })
      setDryRunResult(result)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }

  const handleApply = async () => {
    if (!presetId) return
    setIsApplying(true)
    setError(null)

    try {
      const result = await apiClient.applyPreset(presetId, { dryRun: false })
      setApplyResult(result)
      onApplyComplete?.()
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsApplying(false)
    }
  }

  const handleClose = () => {
    setDryRunResult(null)
    setApplyResult(null)
    setError(null)
    setIsLoading(false)
    setIsApplying(false)
    onClose()
  }

  // Auto-trigger dry run when dialog opens
  const handleOpen = () => {
    if (isOpen && presetId && !dryRunResult && !isLoading && !applyResult) {
      handleDryRun()
    }
  }

  // Trigger dry run on open
  if (isOpen && presetId && !dryRunResult && !isLoading && !error && !applyResult) {
    handleOpen()
  }

  const result = applyResult ?? dryRunResult
  const hasUnplaceable = (result?.unplaceable.length ?? 0) > 0

  return (
    <Modal variant={ModalVariant.large} isOpen={isOpen} onClose={handleClose}>
      <ModalHeader
        title={applyResult ? `Applied: ${presetName}` : `Apply Preset: ${presetName}`}
        description={applyResult ? undefined : 'Preview placement plan before applying'}
      />
      <ModalBody>
        {error && (
          <Alert
            variant="danger"
            isInline
            title="Error"
            style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
          >
            {error}
          </Alert>
        )}

        {isLoading && (
          <Flex justifyContent={{ default: 'justifyContentCenter' }}>
            <FlexItem>
              <Spinner aria-label="Computing placement plan" />
            </FlexItem>
          </Flex>
        )}

        {result && (
          <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsMd' }}>
            {/* Summary */}
            <FlexItem>
              <Flex spaceItems={{ default: 'spaceItemsMd' }}>
                <FlexItem>
                  <Label color="green" isCompact>
                    {result.placed.length} to place
                  </Label>
                </FlexItem>
                {result.unloaded.length > 0 && (
                  <FlexItem>
                    <Label color="orange" isCompact>
                      {result.unloaded.length} to unload
                    </Label>
                  </FlexItem>
                )}
                {hasUnplaceable && (
                  <FlexItem>
                    <Label color="red" isCompact>
                      {result.unplaceable.length} unplaceable
                    </Label>
                  </FlexItem>
                )}
              </Flex>
            </FlexItem>

            {/* Models to place */}
            {result.placed.length > 0 && (
              <FlexItem>
                <strong>Models to place:</strong>
                <Table aria-label="Models to place" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Model</Th>
                      <Th>Pod</Th>
                      <Th>GPUs</Th>
                      <Th>Reason</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {result.placed.map((p, i) => (
                      <Tr key={i}>
                        <Td>{p.modelPath}</Td>
                        <Td>
                          <Label isCompact>{p.podId}</Label>
                        </Td>
                        <Td>{p.gpuIds.join(', ')}</Td>
                        <Td>{p.reason}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </FlexItem>
            )}

            {/* Models to unload */}
            {result.unloaded.length > 0 && (
              <FlexItem>
                <strong>Models to unload:</strong>
                <Table aria-label="Models to unload" variant="compact">
                  <Thead>
                    <Tr>
                      <Th>Model</Th>
                      <Th>Pod</Th>
                      <Th>Reason</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {result.unloaded.map((u, i) => (
                      <Tr key={i}>
                        <Td>{u.modelPath}</Td>
                        <Td>
                          <Label isCompact>{u.podId}</Label>
                        </Td>
                        <Td>{u.reason}</Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </FlexItem>
            )}

            {/* Unplaceable models */}
            {hasUnplaceable && (
              <FlexItem>
                <Alert variant="warning" isInline title="Unplaceable models">
                  <Table aria-label="Unplaceable models" variant="compact">
                    <Thead>
                      <Tr>
                        <Th>Model</Th>
                        <Th>Reason</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {result.unplaceable.map((f, i) => (
                        <Tr key={i}>
                          <Td>{f.modelPath}</Td>
                          <Td>{f.reason}</Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </Alert>
              </FlexItem>
            )}

            {applyResult && (
              <FlexItem>
                <Alert variant="success" isInline title="Preset applied successfully">
                  The cluster is being reconciled to match the preset.
                </Alert>
              </FlexItem>
            )}
          </Flex>
        )}
      </ModalBody>
      <ModalFooter>
        {applyResult ? (
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleApply}
              isDisabled={!dryRunResult || isApplying}
              isLoading={isApplying}
            >
              Apply
            </Button>
          </>
        )}
      </ModalFooter>
    </Modal>
  )
}
