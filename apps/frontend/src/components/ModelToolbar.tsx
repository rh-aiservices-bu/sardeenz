import { useState } from 'react'
import {
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  ToolbarGroup,
  ToolbarFilter,
  ToolbarToggleGroup,
  SearchInput,
  Select,
  SelectOption,
  SelectList,
  MenuToggle,
  ToggleGroup,
  ToggleGroupItem,
  type ToolbarLabelGroup,
  type ToolbarLabel,
} from '@patternfly/react-core'
import { FilterIcon, ListIcon, ThIcon, SortAmountDownIcon } from '@patternfly/react-icons'
import { ModelStatus } from '@sardeenz/types'

export type ViewMode = 'card' | 'table'
export type SortField = 'name' | 'startTime' | 'memoryUsage'
export type SortDirection = 'asc' | 'desc'

export interface FilterState {
  status: ModelStatus[]
  gpuAssignment: string[]
  searchTerm: string
}

interface ModelToolbarProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  sortBy: SortField
  sortDirection: SortDirection
  onSortChange: (field: SortField, direction: SortDirection) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  availableGpus: string[]
  onClearAllFilters: () => void
}

// Status options for filtering
const STATUS_OPTIONS: { value: ModelStatus; label: string }[] = [
  { value: ModelStatus.Running, label: 'Running' },
  { value: ModelStatus.Starting, label: 'Starting' },
  { value: ModelStatus.Sleeping, label: 'Sleeping' },
  { value: ModelStatus.Stopping, label: 'Stopping' },
  { value: ModelStatus.Failed, label: 'Failed' },
]

// Sort options
const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'name', label: 'Name' },
  { value: 'startTime', label: 'Start Time' },
  { value: 'memoryUsage', label: 'Memory Usage' },
]

/**
 * Toolbar for model list with filters, search, sort, and view toggle.
 */
export function ModelToolbar({
  filters,
  onFiltersChange,
  sortBy,
  sortDirection,
  onSortChange,
  viewMode,
  onViewModeChange,
  availableGpus,
  onClearAllFilters,
}: ModelToolbarProps) {
  const [isStatusSelectOpen, setIsStatusSelectOpen] = useState(false)
  const [isGpuSelectOpen, setIsGpuSelectOpen] = useState(false)
  const [isSortSelectOpen, setIsSortSelectOpen] = useState(false)

  // Status filter handlers
  const handleStatusSelect = (status: ModelStatus) => {
    const newStatuses = filters.status.includes(status)
      ? filters.status.filter((s) => s !== status)
      : [...filters.status, status]
    onFiltersChange({ ...filters, status: newStatuses })
  }

  const handleStatusDelete = (
    _category: string | ToolbarLabelGroup,
    label: string | ToolbarLabel
  ) => {
    const chipText = typeof label === 'string' ? label : String(label)
    const status = STATUS_OPTIONS.find((s) => s.label === chipText)?.value
    if (status) {
      onFiltersChange({
        ...filters,
        status: filters.status.filter((s) => s !== status),
      })
    }
  }

  // GPU filter handlers
  const handleGpuSelect = (gpu: string) => {
    const newGpus = filters.gpuAssignment.includes(gpu)
      ? filters.gpuAssignment.filter((g) => g !== gpu)
      : [...filters.gpuAssignment, gpu]
    onFiltersChange({ ...filters, gpuAssignment: newGpus })
  }

  const handleGpuDelete = (_category: string | ToolbarLabelGroup, label: string | ToolbarLabel) => {
    const chipText = typeof label === 'string' ? label : String(label)
    onFiltersChange({
      ...filters,
      gpuAssignment: filters.gpuAssignment.filter((g) => formatGpuLabel(g) !== chipText),
    })
  }

  // Search handler
  const handleSearchChange = (_event: React.FormEvent<HTMLInputElement>, value: string) => {
    onFiltersChange({ ...filters, searchTerm: value })
  }

  const handleSearchClear = () => {
    onFiltersChange({ ...filters, searchTerm: '' })
  }

  // Sort handler
  const handleSortSelect = (field: SortField) => {
    if (field === sortBy) {
      // Toggle direction
      onSortChange(field, sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(field, 'asc')
    }
    setIsSortSelectOpen(false)
  }

  // View mode handler
  const handleCardViewChange = (
    _event: MouseEvent | React.MouseEvent | React.KeyboardEvent,
    isSelected: boolean
  ) => {
    if (isSelected) {
      onViewModeChange('card')
    }
  }

  const handleTableViewChange = (
    _event: MouseEvent | React.MouseEvent | React.KeyboardEvent,
    isSelected: boolean
  ) => {
    if (isSelected) {
      onViewModeChange('table')
    }
  }

  // Format GPU key to display label
  const formatGpuLabel = (gpuKey: string): string => {
    if (gpuKey === 'multi-gpu') return 'Multi-GPU'
    return gpuKey.replace('gpu-', 'GPU ')
  }

  // Get status labels for chips
  const statusChipLabels = filters.status.map(
    (s) => STATUS_OPTIONS.find((opt) => opt.value === s)?.label || s
  )

  // Get GPU labels for chips
  const gpuChipLabels = filters.gpuAssignment.map(formatGpuLabel)

  // Selected sort label
  const selectedSortLabel = SORT_OPTIONS.find((opt) => opt.value === sortBy)?.label || 'Name'
  const sortLabel = `${selectedSortLabel} (${sortDirection === 'asc' ? 'A-Z' : 'Z-A'})`

  return (
    <Toolbar
      clearAllFilters={onClearAllFilters}
      clearFiltersButtonText="Clear all filters"
      collapseListedFiltersBreakpoint="xl"
    >
      <ToolbarContent>
        <ToolbarToggleGroup toggleIcon={<FilterIcon />} breakpoint="xl">
          <ToolbarGroup variant="filter-group">
            {/* Status Filter */}
            <ToolbarFilter
              labels={statusChipLabels}
              deleteLabel={handleStatusDelete}
              categoryName="Status"
              showToolbarItem
            >
              <Select
                aria-label="Filter by status"
                isOpen={isStatusSelectOpen}
                onOpenChange={setIsStatusSelectOpen}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    onClick={() => setIsStatusSelectOpen(!isStatusSelectOpen)}
                    isExpanded={isStatusSelectOpen}
                  >
                    Status{filters.status.length > 0 && ` (${filters.status.length})`}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectOption
                      key={option.value}
                      value={option.value}
                      hasCheckbox
                      isSelected={filters.status.includes(option.value)}
                      onClick={() => handleStatusSelect(option.value)}
                    >
                      {option.label}
                    </SelectOption>
                  ))}
                </SelectList>
              </Select>
            </ToolbarFilter>

            {/* GPU Filter */}
            <ToolbarFilter
              labels={gpuChipLabels}
              deleteLabel={handleGpuDelete}
              categoryName="GPU"
              showToolbarItem
            >
              <Select
                aria-label="Filter by GPU"
                isOpen={isGpuSelectOpen}
                onOpenChange={setIsGpuSelectOpen}
                toggle={(toggleRef) => (
                  <MenuToggle
                    ref={toggleRef}
                    onClick={() => setIsGpuSelectOpen(!isGpuSelectOpen)}
                    isExpanded={isGpuSelectOpen}
                    isDisabled={availableGpus.length === 0}
                  >
                    GPU{filters.gpuAssignment.length > 0 && ` (${filters.gpuAssignment.length})`}
                  </MenuToggle>
                )}
              >
                <SelectList>
                  {availableGpus.map((gpu) => (
                    <SelectOption
                      key={gpu}
                      value={gpu}
                      hasCheckbox
                      isSelected={filters.gpuAssignment.includes(gpu)}
                      onClick={() => handleGpuSelect(gpu)}
                    >
                      {formatGpuLabel(gpu)}
                    </SelectOption>
                  ))}
                </SelectList>
              </Select>
            </ToolbarFilter>
          </ToolbarGroup>
        </ToolbarToggleGroup>

        {/* Search Input */}
        <ToolbarItem>
          <SearchInput
            aria-label="Search by model name"
            placeholder="Search models..."
            value={filters.searchTerm}
            onChange={handleSearchChange}
            onClear={handleSearchClear}
          />
        </ToolbarItem>

        {/* Sort Dropdown */}
        <ToolbarItem>
          <Select
            aria-label="Sort by"
            isOpen={isSortSelectOpen}
            onOpenChange={setIsSortSelectOpen}
            toggle={(toggleRef) => (
              <MenuToggle
                ref={toggleRef}
                onClick={() => setIsSortSelectOpen(!isSortSelectOpen)}
                isExpanded={isSortSelectOpen}
                icon={<SortAmountDownIcon />}
              >
                {sortLabel}
              </MenuToggle>
            )}
          >
            <SelectList>
              {SORT_OPTIONS.map((option) => (
                <SelectOption
                  key={option.value}
                  value={option.value}
                  isSelected={sortBy === option.value}
                  onClick={() => handleSortSelect(option.value)}
                >
                  {option.label}
                </SelectOption>
              ))}
            </SelectList>
          </Select>
        </ToolbarItem>

        {/* View Toggle */}
        <ToolbarItem align={{ default: 'alignEnd' }}>
          <ToggleGroup aria-label="View mode toggle">
            <ToggleGroupItem
              icon={<ThIcon />}
              aria-label="Card view"
              buttonId="card"
              isSelected={viewMode === 'card'}
              onChange={handleCardViewChange}
            />
            <ToggleGroupItem
              icon={<ListIcon />}
              aria-label="Table view"
              buttonId="table"
              isSelected={viewMode === 'table'}
              onChange={handleTableViewChange}
            />
          </ToggleGroup>
        </ToolbarItem>
      </ToolbarContent>
    </Toolbar>
  )
}

export default ModelToolbar
