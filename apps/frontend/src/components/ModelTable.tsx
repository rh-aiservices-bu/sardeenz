import { useState } from 'react'
import { Table, Thead, Tbody, Tr, Th, Td, type ThProps } from '@patternfly/react-table'
import {
  Button,
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Flex,
  FlexItem,
  Tooltip,
  ClipboardCopyButton,
} from '@patternfly/react-core'
import { TrashIcon, FileIcon, OutlinedClockIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelStatusBadge } from './ModelStatusBadge'
import { ViewLogsDialog } from './ViewLogsDialog'
import { MemoryDetailsModal } from './MemoryDetailsModal'
import { useAuth } from '../contexts/AuthContext'

export type SortField = 'name' | 'startTime' | 'memoryUsage'
export type SortDirection = 'asc' | 'desc'

interface ModelTableProps {
  models: ModelInstanceDTO[]
  sortBy: SortField
  sortDirection: SortDirection
  onSort: (field: SortField) => void
  onUnload: (instanceId: string, modelPath: string, isFailed: boolean) => void
  unloadingInstanceId: string | null
}

// Column definitions for sorting
const SORT_COLUMNS: SortField[] = ['name', 'startTime', 'memoryUsage']

/**
 * Table view for model instances with sortable columns.
 */
export function ModelTable({
  models,
  sortBy,
  sortDirection,
  onSort,
  onUnload,
  unloadingInstanceId,
}: ModelTableProps) {
  const { canWrite } = useAuth()

  // Modal states
  const [logsModalOpen, setLogsModalOpen] = useState<string | null>(null)
  const [memoryModalOpen, setMemoryModalOpen] = useState<string | null>(null)
  const [confirmModalOpen, setConfirmModalOpen] = useState<string | null>(null)

  const [copied, setCopied] = useState(false)

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatMemoryUtilization = (value: number) => {
    return `${(value * 100).toFixed(0)}%`
  }

  const formatGpuDisplay = (model: ModelInstanceDTO) => {
    if (model.gpu_ids.length === 1) {
      return `GPU ${model.gpu_ids[0]}`
    }
    return model.gpu_ids.map((id) => `GPU ${id}`).join(', ')
  }

  const getSortParams = (column: SortField): ThProps['sort'] => ({
    sortBy: {
      index: SORT_COLUMNS.indexOf(sortBy),
      direction: sortDirection,
    },
    onSort: () => onSort(column),
    columnIndex: SORT_COLUMNS.indexOf(column),
  })

  const handleCopyModelName = (model_name: string) => {
    navigator.clipboard.writeText(model_name)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUnloadClick = (model: ModelInstanceDTO) => {
    setConfirmModalOpen(model.id)
  }

  const handleConfirmUnload = (model: ModelInstanceDTO) => {
    setConfirmModalOpen(null)
    onUnload(model.id, model.model_path, model.status === 'failed')
  }

  const getModelForModal = (id: string | null): ModelInstanceDTO | undefined => {
    if (!id) return undefined
    return models.find((m) => m.id === id)
  }

  const logsModel = getModelForModal(logsModalOpen)
  const memoryModel = getModelForModal(memoryModalOpen)
  const confirmModel = getModelForModal(confirmModalOpen)

  return (
    <>
      <Table aria-label="Model instances table" variant="compact">
        <Thead>
          <Tr>
            <Th sort={getSortParams('name')}>Model Path</Th>
            <Th>Status</Th>
            <Th>GPU(s)</Th>
            <Th sort={getSortParams('memoryUsage')}>Memory</Th>
            <Th>Max Tokens</Th>
            <Th sort={getSortParams('startTime')}>Started At</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {models.map((model) => {
            const isFailed = model.status === 'failed'
            const isUnloading = unloadingInstanceId === model.id

            return (
              <Tr key={model.id}>
                <Td dataLabel="Model Path">
                  <Flex direction={{ default: 'column' }} gap={{ default: 'gapXs' }}>
                    <FlexItem>
                      <strong>{model.model_path}</strong>
                    </FlexItem>
                    <FlexItem>
                      <span style={{ color: 'var(--pf-t--global--text--color--subtle)' }}>
                        Served as: </span> {model.model_name}
                        <ClipboardCopyButton
                          id={`copy-model-name-${model.id}`}
                          aria-label="Copy served model name to clipboard"
                          onClick={ () => handleCopyModelName(model.model_name)}
                          exitDelay={copied ? 1500 : 600}
                          variant="plain"
                          style={{ verticalAlign: 'middle', marginLeft: 'var(--pf-t--global--spacer--xs)' }}
                        >
                          {copied ? 'Copied!' : 'Copy'}
                        </ClipboardCopyButton>
                      
                    </FlexItem>
                  </Flex>
                </Td>
                <Td dataLabel="Status">
                  <ModelStatusBadge status={model.status} />
                </Td>
                <Td dataLabel="GPU(s)">
                  {formatGpuDisplay(model)}
                  {model.tensor_parallel_size > 1 && (
                    <span
                      style={{
                        color: 'var(--pf-t--global--text--color--subtle)',
                        marginLeft: 'var(--pf-t--global--spacer--xs)',
                      }}
                    >
                      (TP)
                    </span>
                  )}
                </Td>
                <Td dataLabel="Memory">
                  <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                    <FlexItem>{formatMemoryUtilization(model.gpu_memory_utilization)}</FlexItem>
                    {model.status === 'running' && (
                      <FlexItem>
                        <Button
                          variant="link"
                          isInline
                          onClick={() => setMemoryModalOpen(model.id)}
                        >
                          Details
                        </Button>
                      </FlexItem>
                    )}
                  </Flex>
                </Td>
                <Td dataLabel="Max Tokens">{model.max_tokens}</Td>
                <Td dataLabel="Started At">
                  <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapXs' }}>
                    <FlexItem>
                      <OutlinedClockIcon />
                    </FlexItem>
                    <FlexItem>{formatDate(model.loaded_at)}</FlexItem>
                  </Flex>
                </Td>
                <Td dataLabel="Actions">
                  <Flex gap={{ default: 'gapXs' }}>
                    {(model.status === 'running' || model.status === 'failed') && (
                      <FlexItem>
                        <Tooltip content="View logs">
                          <Button
                            variant="plain"
                            icon={<FileIcon />}
                            aria-label={`View logs for ${model.model_path}`}
                            onClick={() => setLogsModalOpen(model.id)}
                          />
                        </Tooltip>
                      </FlexItem>
                    )}
                    <FlexItem>
                      <Tooltip content={!canWrite ? 'You do not have permission to unload models' : isFailed ? 'Remove' : 'Unload'}>
                        <Button
                          variant="plain"
                          icon={<TrashIcon />}
                          aria-label={isFailed ? `Remove ${model.model_path}` : `Unload ${model.model_path}`}
                          onClick={() => handleUnloadClick(model)}
                          isDisabled={model.status === 'stopping' || isUnloading || !canWrite}
                          isLoading={isUnloading}
                        />
                      </Tooltip>
                    </FlexItem>
                  </Flex>
                </Td>
              </Tr>
            )
          })}
        </Tbody>
      </Table>

      {/* Logs Modal */}
      {logsModel && (
        <ViewLogsDialog
          isOpen={logsModalOpen !== null}
          onClose={() => setLogsModalOpen(null)}
          instanceId={logsModel.id}
          modelPath={logsModel.model_path}
        />
      )}

      {/* Memory Details Modal */}
      {memoryModel && (
        <MemoryDetailsModal
          isOpen={memoryModalOpen !== null}
          onClose={() => setMemoryModalOpen(null)}
          instanceId={memoryModel.id}
          modelPath={memoryModel.model_path}
          memoryMetrics={memoryModel.memory_metrics ?? null}
        />
      )}

      {/* Confirm Unload Modal */}
      {confirmModel && (
        <Modal
          variant={ModalVariant.small}
          isOpen={confirmModalOpen !== null}
          onClose={() => setConfirmModalOpen(null)}
        >
          <ModalHeader
            title={confirmModel.status === 'failed' ? 'Remove failed model?' : 'Unload model?'}
            titleIconVariant={confirmModel.status === 'failed' ? 'danger' : 'warning'}
          />
          <ModalBody>
            {confirmModel.status === 'failed'
              ? `This will remove the failed model entry for "${confirmModel.model_path}" from the list.`
              : `This will unload "${confirmModel.model_path}" and free its GPU memory.`}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setConfirmModalOpen(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmModel.status === 'failed' ? 'danger' : 'primary'}
              onClick={() => handleConfirmUnload(confirmModel)}
            >
              {confirmModel.status === 'failed' ? 'Remove' : 'Unload'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  )
}

export default ModelTable
