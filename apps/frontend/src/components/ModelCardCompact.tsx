import { useState, useEffect, useRef } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import {
  Card,
  CardHeader,
  CardBody,
  CardExpandableContent,
  CardTitle,
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
  Label,
  Dropdown,
  DropdownList,
  DropdownItem,
  MenuToggle,
  Divider,
  Tooltip,
  ClipboardCopyButton,
} from '@patternfly/react-core'
import {
  EllipsisVIcon,
  ExclamationTriangleIcon,
  FileIcon,
  TrashIcon,
  OutlinedClockIcon,
  MoonIcon,
  SunIcon,
  ArrowRightIcon,
  GripVerticalIcon,
} from '@patternfly/react-icons'
import type { ModelInstanceDTO, ModelStatus } from '@sardeenz/types'
import { ModelStatusBadge } from './ModelStatusBadge'
import { ViewLogsDialog } from './ViewLogsDialog'
import { MemoryDetailsModal } from './MemoryDetailsModal'
import { useNotifications } from '../contexts/NotificationContext'
import { useAuth } from '../contexts/AuthContext'

interface ModelCardCompactProps {
  model: ModelInstanceDTO
  onUnload: (instanceId: string, modelPath: string, isFailed: boolean) => void
  onSleep?: (instanceId: string) => void
  onWake?: (instanceId: string) => void
  onMove?: (model: ModelInstanceDTO) => void
  isUnloading?: boolean
  isSleeping?: boolean
  isWaking?: boolean
  isExpanded: boolean
  onToggle: () => void
  id?: string
  /** KV cache total in GiB for this model's GPU (for max concurrent requests calculation) */
  kvCacheTotalGb?: number
  /** Live GPU memory utilization from memory monitor (takes precedence over model.gpu_memory_utilization) */
  memoryUtilization?: number
}

// Status to border color mapping using PF6 design tokens
const STATUS_BORDER_COLORS: Record<ModelStatus, string> = {
  running: 'var(--pf-t--global--color--status--success--default)',
  starting: 'var(--pf-t--global--color--status--custom--default)',
  sleeping: 'var(--pf-t--global--color--nonstatus--purple--default)',
  stopping: 'var(--pf-t--global--color--status--custom--default)',
  failed: 'var(--pf-t--global--color--status--danger--default)',
}

/**
 * Compact card component displaying model instance with expandable details.
 * Collapsed view shows: model_path, status, GPU, memory %.
 * Expanded view shows full details.
 */
export function ModelCardCompact({
  model,
  onUnload,
  onSleep,
  onWake,
  onMove,
  isUnloading = false,
  isSleeping = false,
  isWaking = false,
  isExpanded,
  onToggle,
  id,
  kvCacheTotalGb,
  memoryUtilization,
}: ModelCardCompactProps) {
  const { addNotification } = useNotifications()
  const { canWrite } = useAuth()
  const previousErrorRef = useRef<string | null>(null)
  const [logsModalOpen, setLogsModalOpen] = useState(false)
  const [confirmModalOpen, setConfirmModalOpen] = useState(false)
  const [memoryModalOpen, setMemoryModalOpen] = useState(false)
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const isFailed = model.status === 'failed'

  // Draggable setup - only for single-GPU running models
  const isDraggable = model.status === 'running' && model.gpu_ids.length === 1
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `model-${model.id}`,
    data: { model },
    disabled: !isDraggable,
  })

  const dragStyle = transform
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.7 : 1,
        zIndex: isDragging ? 1000 : undefined,
      }
    : undefined

  // Use live memory data if available, fallback to model DTO value
  const currentMemoryUtilization = memoryUtilization ?? model.gpu_memory_utilization

  // Extract just the model name from the path for display
  const modelDisplayName = model.model_path.split('/').pop() || model.model_path

  // Check if KVCache is insufficient for max-length requests (will cause OOM)
  const isKvCacheInsufficient =
    model.status === 'running' &&
    kvCacheTotalGb !== undefined &&
    model.memory_metrics?.kv_cache_per_request_mib !== undefined &&
    model.memory_metrics.kv_cache_per_request_mib > 0 &&
    model.memory_metrics.kv_cache_per_request_mib > kvCacheTotalGb * 1024

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

  const formatGpuDisplay = () => {
    if (model.gpu_ids.length === 1) {
      return `GPU ${model.gpu_ids[0]}`
    }
    return model.gpu_ids.map((id) => `GPU ${id}`).join(', ')
  }

  const borderColor =
    STATUS_BORDER_COLORS[model.status] || 'var(--pf-t--global--border--color--default)'

  // Format relative time for display
  const formatRelativeTime = (dateString?: string) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    return `${diffDays}d ago`
  }

  const handleCopyModelName = () => {
    navigator.clipboard.writeText(model.model_name)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleActionsToggle = () => {
    setIsActionsOpen(!isActionsOpen)
  }

  const handleActionsSelect = () => {
    setIsActionsOpen(false)
  }

  return (
    <Card
      id={id}
      ref={setNodeRef}
      isExpanded={isExpanded}
      isCompact
      style={{
        borderLeft: `4px solid ${borderColor}`,
        ...dragStyle,
      }}
      {...attributes}
    >
      <CardHeader
        onExpand={onToggle}
        isToggleRightAligned
        toggleButtonProps={{
          id: `toggle-${model.id}`,
          'aria-label': isExpanded ? 'Collapse details' : 'Show details',
          'aria-expanded': isExpanded,
        }}
        style={{ alignItems: 'flex-start' }}
        actions={{
          hasNoOffset: true,
          actions: (
            <Dropdown
              isOpen={isActionsOpen}
              onSelect={handleActionsSelect}
              onOpenChange={setIsActionsOpen}
              popperProps={{
                position: 'right',
                enableFlip: true,
                appendTo: () => document.body,
              }}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  variant="plain"
                  onClick={handleActionsToggle}
                  isExpanded={isActionsOpen}
                  aria-label={`Actions for ${modelDisplayName}`}
                >
                  <EllipsisVIcon />
                </MenuToggle>
              )}
            >
              <DropdownList>
                {(model.status === 'running' ||
                  model.status === 'failed' ||
                  model.status === 'sleeping') && (
                  <DropdownItem
                    key="logs"
                    icon={<FileIcon />}
                    onClick={() => setLogsModalOpen(true)}
                  >
                    View logs
                  </DropdownItem>
                )}
                {model.status === 'running' && (
                  <DropdownItem key="memory" onClick={() => setMemoryModalOpen(true)}>
                    Memory details
                  </DropdownItem>
                )}
                {model.status === 'running' && model.gpu_ids.length === 1 && onMove && (
                  <DropdownItem
                    key="move"
                    icon={<ArrowRightIcon />}
                    onClick={() => onMove(model)}
                    isDisabled={!canWrite}
                  >
                    Move to GPU
                  </DropdownItem>
                )}
                {model.status === 'running' && model.sleep_mode_enabled && onSleep && (
                  <DropdownItem
                    key="sleep"
                    icon={<MoonIcon />}
                    onClick={() => onSleep(model.id)}
                    isDisabled={isSleeping || !canWrite}
                  >
                    {isSleeping ? 'Sleeping...' : 'Put to Sleep'}
                  </DropdownItem>
                )}
                {model.status === 'sleeping' && onWake && (
                  <DropdownItem
                    key="wake"
                    icon={<SunIcon />}
                    onClick={() => onWake(model.id)}
                    isDisabled={isWaking || !canWrite}
                  >
                    {isWaking ? 'Waking...' : 'Wake Up'}
                  </DropdownItem>
                )}
                {(model.status === 'running' ||
                  model.status === 'failed' ||
                  model.status === 'sleeping') && <Divider key="divider" />}
                <DropdownItem
                  key="unload"
                  icon={<TrashIcon />}
                  onClick={handleUnloadClick}
                  isDisabled={model.status === 'stopping' || isUnloading || !canWrite}
                  isDanger
                >
                  {isUnloading
                    ? isFailed
                      ? 'Removing...'
                      : 'Unloading...'
                    : isFailed
                      ? 'Remove'
                      : 'Unload'}
                </DropdownItem>
              </DropdownList>
            </Dropdown>
          ),
        }}
      >
        {/* Three-row layout for better readability */}
        <Flex alignItems={{ default: 'alignItemsFlexStart' }} spaceItems={{ default: 'spaceItemsSm' }}>
          {/* Drag handle - only visible for draggable cards */}
          {isDraggable && (
            <FlexItem>
              <span
                {...listeners}
                style={{
                  cursor: 'grab',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 'var(--pf-t--global--spacer--xs)',
                  color: 'var(--pf-t--global--icon--color--subtle)',
                }}
                title="Drag to move to another GPU"
              >
                <GripVerticalIcon />
              </span>
            </FlexItem>
          )}
          <FlexItem style={{ flex: 1 }}>
            <Flex direction={{ default: 'column' }} spaceItems={{ default: 'spaceItemsXs' }}>
              {/* Row 1: Model name */}
          <FlexItem>
            <Tooltip content={model.model_path}>
              <CardTitle
                style={{
                  fontWeight: 600,
                  wordBreak: 'break-word',
                }}
              >
                {modelDisplayName}
              </CardTitle>
            </Tooltip>
          </FlexItem>
          {/* Row 2: Served model name with inline copy button */}
          <FlexItem>
            <span
              style={{
                color: 'var(--pf-t--global--text--color--subtle)',
                fontSize: 'var(--pf-t--global--font--size--sm)',
                wordBreak: 'break-word',
              }}
            >
              {model.model_name}
              <ClipboardCopyButton
                id={`copy-model-name-${model.id}`}
                aria-label="Copy served model name to clipboard"
                onClick={handleCopyModelName}
                exitDelay={copied ? 1500 : 600}
                variant="plain"
                style={{ verticalAlign: 'middle', marginLeft: 'var(--pf-t--global--spacer--xs)' }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </ClipboardCopyButton>
            </span>
          </FlexItem>
          {/* Row 3: GPU, memory, status, time */}
          <FlexItem>
            <Flex
              alignItems={{ default: 'alignItemsCenter' }}
              spaceItems={{ default: 'spaceItemsSm' }}
            >
              <FlexItem>
                <Label isCompact color="grey">
                  {formatGpuDisplay()}
                </Label>
              </FlexItem>
              <FlexItem>
                <Label isCompact color="blue">
                  {formatMemoryUtilization(currentMemoryUtilization)}
                </Label>
              </FlexItem>
              <FlexItem>
                <Flex gap={{ default: 'gapXs' }} alignItems={{ default: 'alignItemsCenter' }}>
                  <ModelStatusBadge status={model.status} isCompact />
                  {isKvCacheInsufficient && (
                    <Tooltip content="Insufficient KVCache for max-length requests. OOM errors expected.">
                      <ExclamationTriangleIcon
                        color="var(--pf-t--global--icon--color--status--warning--default)"
                      />
                    </Tooltip>
                  )}
                </Flex>
              </FlexItem>
              {model.loaded_at && (
                <FlexItem>
                  <Tooltip content={formatDate(model.loaded_at)}>
                    <span
                      style={{
                        color: 'var(--pf-t--global--text--color--subtle)',
                        fontSize: 'var(--pf-t--global--font--size--xs)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--pf-t--global--spacer--xs)',
                      }}
                    >
                      <OutlinedClockIcon />
                      {formatRelativeTime(model.loaded_at)}
                    </span>
                  </Tooltip>
                </FlexItem>
              )}
            </Flex>
          </FlexItem>
            </Flex>
          </FlexItem>
        </Flex>
      </CardHeader>

      <CardExpandableContent>
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
            {model.status === 'running' &&
              model.memory_metrics &&
              model.memory_metrics.kv_cache_per_request_mib > 0 && (
                <>
                  <DescriptionListGroup>
                    <DescriptionListTerm>KV Cache / Request</DescriptionListTerm>
                    <DescriptionListDescription>
                      {model.memory_metrics.kv_cache_per_request_mib.toFixed(2)} MiB
                      <span
                        style={{
                          marginLeft: 'var(--pf-t--global--spacer--sm)',
                          color: 'var(--pf-t--global--text--color--subtle)',
                        }}
                      >
                        (at {model.memory_metrics.max_model_len.toLocaleString()} tokens)
                      </span>
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  {kvCacheTotalGb !== undefined && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>Max Concurrent Requests</DescriptionListTerm>
                      <DescriptionListDescription>
                        {isKvCacheInsufficient ? (
                          <Tooltip
                            content={`KVCache per request (${model.memory_metrics.kv_cache_per_request_mib.toFixed(0)} MiB) exceeds available KVCache (${(kvCacheTotalGb * 1024).toFixed(0)} MiB). Max-length requests will cause OOM errors.`}
                          >
                            <Label color="orange" icon={<ExclamationTriangleIcon />} isCompact>
                              Insufficient KVCache
                            </Label>
                          </Tooltip>
                        ) : (
                          Math.floor(
                            (kvCacheTotalGb * 1024) / model.memory_metrics.kv_cache_per_request_mib
                          )
                        )}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                </>
              )}
            <DescriptionListGroup>
              <DescriptionListTerm>GPU Memory</DescriptionListTerm>
              <DescriptionListDescription>
                <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                  <FlexItem>{formatMemoryUtilization(currentMemoryUtilization)}</FlexItem>
                  {model.status === 'running' && (
                    <FlexItem>
                      <Button variant="link" isInline onClick={() => setMemoryModalOpen(true)}>
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
                {formatGpuDisplay()}
                {model.tensor_parallel_size > 1 && (
                  <span
                    style={{
                      color: 'var(--pf-t--global--text--color--subtle)',
                      marginLeft: 'var(--pf-t--global--spacer--sm)',
                    }}
                  >
                    (tensor parallel)
                  </span>
                )}
              </DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
              <DescriptionListTerm>Started at</DescriptionListTerm>
              <DescriptionListDescription>{formatDate(model.loaded_at)}</DescriptionListDescription>
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
      </CardExpandableContent>

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

export default ModelCardCompact
