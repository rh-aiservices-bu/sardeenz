import { ToggleGroup, ToggleGroupItem, Tooltip } from '@patternfly/react-core'
import { ColumnsIcon, ThLargeIcon, WindowMaximizeIcon } from '@patternfly/react-icons'
import type { LayoutMode } from './workspace-types'

interface LayoutSelectorProps {
  layout: LayoutMode
  onLayoutChange: (layout: LayoutMode) => void
  /** Disable certain layouts (e.g., on small screens) */
  disabledLayouts?: LayoutMode[]
}

/**
 * Toggle group for selecting workspace layout mode.
 * - Single: One chat visible
 * - Split-2: Two chats side by side
 * - Grid-4: Four chats in a 2x2 grid
 */
export function LayoutSelector({
  layout,
  onLayoutChange,
  disabledLayouts = [],
}: LayoutSelectorProps) {
  const handleSingleChange = (
    _event: MouseEvent | React.MouseEvent | React.KeyboardEvent,
    isSelected: boolean
  ) => {
    if (isSelected) onLayoutChange('single')
  }

  const handleSplitChange = (
    _event: MouseEvent | React.MouseEvent | React.KeyboardEvent,
    isSelected: boolean
  ) => {
    if (isSelected) onLayoutChange('split-2')
  }

  const handleGridChange = (
    _event: MouseEvent | React.MouseEvent | React.KeyboardEvent,
    isSelected: boolean
  ) => {
    if (isSelected) onLayoutChange('grid-4')
  }

  return (
    <ToggleGroup aria-label="Layout mode">
      <Tooltip content="Single view">
        <ToggleGroupItem
          icon={<WindowMaximizeIcon />}
          aria-label="Single view"
          buttonId="layout-single"
          isSelected={layout === 'single'}
          onChange={handleSingleChange}
          isDisabled={disabledLayouts.includes('single')}
        />
      </Tooltip>
      <Tooltip content="Split view (2 models)">
        <ToggleGroupItem
          icon={<ColumnsIcon />}
          aria-label="Split view"
          buttonId="layout-split"
          isSelected={layout === 'split-2'}
          onChange={handleSplitChange}
          isDisabled={disabledLayouts.includes('split-2')}
        />
      </Tooltip>
      <Tooltip content="Grid view (4 models)">
        <ToggleGroupItem
          icon={<ThLargeIcon />}
          aria-label="Grid view"
          buttonId="layout-grid"
          isSelected={layout === 'grid-4'}
          onChange={handleGridChange}
          isDisabled={disabledLayouts.includes('grid-4')}
        />
      </Tooltip>
    </ToggleGroup>
  )
}
