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
} from '@patternfly/react-core'
import { TrashIcon, FileIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelStatusBadge } from './ModelStatusBadge'
import { ViewLogsDialog } from './ViewLogsDialog'
import { useNotifications } from '../contexts/NotificationContext'

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
  const previousErrorRef = useRef<string | null>(null)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)

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
    <Card>
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
              {formatMemoryUtilization(model.gpu_memory_utilization)}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>Loaded</DescriptionListTerm>
            <DescriptionListDescription>
              <Flex
                alignItems={{ default: 'alignItemsCenter' }}
                gap={{ default: 'gapSm' }}
              >
                <FlexItem>{formatDate(model.loaded_at)}</FlexItem>
                {(model.status === 'active' || model.status === 'failed') && (
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
              <DescriptionListTerm>Ready</DescriptionListTerm>
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
      </CardBody>
      <CardFooter>
        <Button
          variant="danger"
          icon={<TrashIcon />}
          onClick={handleUnloadClick}
          isDisabled={model.status === 'stopping' || isUnloading}
          isLoading={isUnloading}
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
    </Card>
  )
}

export default ModelCard
