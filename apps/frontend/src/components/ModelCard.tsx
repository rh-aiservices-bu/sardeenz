import { useState, useEffect, useRef } from 'react'
import {
  Card,
  CardTitle,
  CardBody,
  CardFooter,
  Button,
  DescriptionList,
  DescriptionListGroup,
  DescriptionListTerm,
  DescriptionListDescription,
  Flex,
  FlexItem,
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ClipboardCopy,
  ClipboardCopyVariant,
  ExpandableSection,
} from '@patternfly/react-core'
import { TrashIcon, FileIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelStatusBadge } from './ModelStatusBadge'
import { ViewLogsDialog } from './ViewLogsDialog'
import { MemoryDetailsModal } from './MemoryDetailsModal'
import { useNotifications } from '../contexts/NotificationContext'
import { useAuth } from '../contexts/AuthContext'

interface ModelCardProps {
  model: ModelInstanceDTO
  onUnload: (instanceId: string, modelPath: string, isFailed: boolean) => void
  isUnloading?: boolean
}

/**
 * Card component displaying model instance details with actions.
 * Following PatternFly 6 patterns and design tokens.
 */
export function ModelCard({ model, onUnload, isUnloading = false }: ModelCardProps) {
  const { addNotification } = useNotifications()
  const { canWrite } = useAuth()
  const previousErrorRef = useRef<string | null>(null)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [memoryModalOpen, setMemoryModalOpen] = useState(false)

  const isFailed = model.status === 'failed'

  // Push model errors to notification system when they first appear
  useEffect(() => {
    if (model.error_message && model.error_message !== previousErrorRef.current) {
      addNotification({
        title: `Error: ${model.model_path}`,
        description: model.error_message,
        variant: 'danger',
      })
    }
    previousErrorRef.current = model.error_message ?? null
  }, [model.error_message, model.model_path, addNotification])

  const handleUnloadClick = () => {
    setConfirmModalOpen(true)
  }

  const handleConfirmUnload = () => {
    setConfirmModalOpen(false)
    onUnload(model.id, model.model_path, isFailed)
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString()
  }

  const formatMemoryUtilization = (value: number) => {
    return `${(value * 100).toFixed(0)}%`
  }

  return (
    <Card isCompact>
      <CardTitle>
        <Flex
          justifyContent={{ default: 'justifyContentSpaceBetween' }}
          alignItems={{ default: 'alignItemsCenter' }}
        >
          <FlexItem>{model.model_path}</FlexItem>
          <FlexItem>
            <ModelStatusBadge status={model.status} />
          </FlexItem>
        </Flex>
      </CardTitle>
      <CardBody>
        <DescriptionList isHorizontal isCompact>
          <DescriptionListGroup>
            <DescriptionListTerm>Served model name</DescriptionListTerm>
            <DescriptionListDescription>{model.model_name}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Port</DescriptionListTerm>
            <DescriptionListDescription>{model.port}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Max Tokens</DescriptionListTerm>
            <DescriptionListDescription>{model.max_tokens}</DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>GPU Memory</DescriptionListTerm>
            <DescriptionListDescription>
              <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                <FlexItem>{formatMemoryUtilization(model.gpu_memory_utilization)}</FlexItem>
                {model.status === 'running' && (
                  <FlexItem>
                    <Button
                      variant="link"
                      isInline
                      onClick={() => setMemoryModalOpen(true)}
                    >
                      Details
                    </Button>
                  </FlexItem>
                )}
              </Flex>
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>GPU{model.gpu_ids.length > 1 ? 's' : ''}</DescriptionListTerm>
            <DescriptionListDescription>
              {model.gpu_ids.length === 1
                ? `GPU ${model.gpu_ids[0]}`
                : model.gpu_ids.map(id => `GPU ${id}`).join(', ')}
              {model.tensor_parallel_size > 1 && (
                <span style={{ color: 'var(--pf-t--global--text--color--subtle)', marginLeft: 'var(--pf-t--global--spacer--sm)' }}>
                  (tensor parallel)
                </span>
              )}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Started at</DescriptionListTerm>
            <DescriptionListDescription>
              <Flex
                alignItems={{ default: 'alignItemsCenter' }}
                gap={{ default: 'gapSm' }}
              >
                <FlexItem>{formatDate(model.loaded_at)}</FlexItem>
                {(model.status === 'running' || model.status === 'failed') && (
                  <FlexItem>
                    <Button
                      variant="link"
                      isInline
                      icon={<FileIcon />}
                      onClick={() => setLogsModalOpen(true)}
                    >
                      Logs
                    </Button>
                  </FlexItem>
                )}
              </Flex>
            </DescriptionListDescription>
          </DescriptionListGroup>
          {model.ready_at && (
            <DescriptionListGroup>
              <DescriptionListTerm>Ready at</DescriptionListTerm>
              <DescriptionListDescription>
                {formatDate(model.ready_at)}
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}
          {model.error_message && (
            <DescriptionListGroup>
              <DescriptionListTerm>Error</DescriptionListTerm>
              <DescriptionListDescription>
                <span style={{ color: 'var(--pf-t--global--color--status--danger--default)' }}>
                  {model.error_message}
                </span>
              </DescriptionListDescription>
            </DescriptionListGroup>
          )}
        </DescriptionList>

        {model.launch_command && (
          <ExpandableSection
            toggleText="Launch Command"
            style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}
          >
            <ClipboardCopy
              isReadOnly
              hoverTip="Copy"
              clickTip="Copied"
              variant={ClipboardCopyVariant.expansion}
              isCode
            >
              {model.launch_command}
            </ClipboardCopy>
          </ExpandableSection>
        )}
      </CardBody>
      <CardFooter>
        <Button
          variant="danger"
          icon={<TrashIcon />}
          onClick={handleUnloadClick}
          isDisabled={model.status === 'stopping' || isUnloading || !canWrite}
          isLoading={isUnloading}
          title={!canWrite ? 'You do not have permission to unload models' : undefined}
        >
          {isUnloading
            ? (isFailed ? 'Removing...' : 'Unloading...')
            : (isFailed ? 'Remove' : 'Unload')}
        </Button>
      </CardFooter>

      <ViewLogsDialog
        isOpen={logsModalOpen}
        onClose={() => setLogsModalOpen(false)}
        instanceId={model.id}
        modelPath={model.model_path}
      />

      <Modal
        variant={ModalVariant.small}
        isOpen={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
      >
        <ModalHeader
          title={isFailed ? 'Remove failed model?' : 'Unload model?'}
          titleIconVariant={isFailed ? 'danger' : 'warning'}
        />
        <ModalBody>
          {isFailed
            ? `This will remove the failed model entry for "${model.model_path}" from the list.`
            : `This will unload "${model.model_path}" and free its GPU memory.`}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmModalOpen(false)}>
            Cancel
          </Button>
          <Button variant={isFailed ? 'danger' : 'primary'} onClick={handleConfirmUnload}>
            {isFailed ? 'Remove' : 'Unload'}
          </Button>
        </ModalFooter>
      </Modal>

      <MemoryDetailsModal
        isOpen={memoryModalOpen}
        onClose={() => setMemoryModalOpen(false)}
        instanceId={model.id}
        modelPath={model.model_path}
        memoryMetrics={model.memory_metrics ?? null}
      />
    </Card>
  )
}

export default ModelCard
