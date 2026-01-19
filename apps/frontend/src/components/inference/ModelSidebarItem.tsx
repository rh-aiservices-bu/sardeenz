import { Button, Flex, FlexItem, Label, Truncate } from '@patternfly/react-core'
import { CheckIcon } from '@patternfly/react-icons'
import type { ModelInstanceDTO } from '@sardeenz/types'

interface ModelSidebarItemProps {
  model: ModelInstanceDTO
  isOpen: boolean
  isActive: boolean
  onSelect: (model: ModelInstanceDTO) => void
}

/**
 * Compact model item for the sidebar.
 * Shows model name with status indicator and "open" badge.
 */
export function ModelSidebarItem({ model, isOpen, isActive, onSelect }: ModelSidebarItemProps) {
  const modelName = model.model_path.split('/').pop() || model.model_path

  const handleClick = () => {
    onSelect(model)
  }

  return (
    <Button
      variant="plain"
      isBlock
      onClick={handleClick}
      style={{
        textAlign: 'left',
        padding: 'var(--pf-t--global--spacer--xs) var(--pf-t--global--spacer--sm)',
        borderRadius: 'var(--pf-t--global--border--radius--small)',
        backgroundColor: isActive
          ? 'var(--pf-t--global--background--color--primary--default)'
          : 'transparent',
      }}
      aria-pressed={isActive}
    >
      <Flex
        alignItems={{ default: 'alignItemsCenter' }}
        justifyContent={{ default: 'justifyContentSpaceBetween' }}
        gap={{ default: 'gapSm' }}
      >
        <FlexItem style={{ minWidth: 0, flex: 1 }}>
          <Truncate content={modelName} />
        </FlexItem>
        <FlexItem>
          <Flex gap={{ default: 'gapXs' }} alignItems={{ default: 'alignItemsCenter' }}>
            {isOpen && (
              <FlexItem>
                <Label isCompact color="blue" icon={<CheckIcon />}>
                  Open
                </Label>
              </FlexItem>
            )}
          </Flex>
        </FlexItem>
      </Flex>
    </Button>
  )
}
