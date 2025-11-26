import { useEffect, useRef } from 'react'
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
} from '@patternfly/react-core'
import { TrashIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { ModelStatusBadge } from './ModelStatusBadge'
import { useNotifications } from '../contexts/NotificationContext'

interface ModelCardProps {
  model: ModelInstanceDTO
  onUnload: (modelPath: string) => void
}

/**
 * Card component displaying model instance details with actions.
 * Following PatternFly 6 patterns and design tokens.
 */
export function ModelCard({ model, onUnload }: ModelCardProps) {
  const { addNotification } = useNotifications()
  const previousErrorRef = useRef<string | null>(null)

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

  const handleUnload = () => {
    if (confirm(`Are you sure you want to unload ${model.model_path}?`)) {
      onUnload(model.model_path)
    }
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
              {formatDate(model.loaded_at)}
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
          onClick={handleUnload}
          isDisabled={model.status === 'stopping'}
        >
          Unload
        </Button>
      </CardFooter>
    </Card>
  )
}

export default ModelCard
