import { useState, useEffect, useCallback } from 'react'
import { Table, Thead, Tbody, Tr, Th, Td } from '@patternfly/react-table'
import {
  Button,
  Modal,
  ModalVariant,
  ModalHeader,
  ModalBody,
  ModalFooter,
  EmptyState,
  EmptyStateBody,
  EmptyStateActions,
  EmptyStateFooter,
  Spinner,
  Alert,
  Label,
  Pagination,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
  MenuToggle,
  Select,
  SelectOption,
  SelectList,
} from '@patternfly/react-core'
import { TrashIcon, EyeIcon, RedoIcon } from '@patternfly/react-icons'
import { apiClient, extractErrorMessage, type BenchmarkSummary } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

interface BenchmarkHistoryTableProps {
  onViewBenchmark: (id: string) => void
  onRerunBenchmark: (id: string) => void
  refreshTrigger?: number
}

/**
 * Table listing past benchmark runs with pagination and filtering.
 */
export function BenchmarkHistoryTable({
  onViewBenchmark,
  onRerunBenchmark,
  refreshTrigger,
}: BenchmarkHistoryTableProps) {
  const { canWrite } = useAuth()
  const [benchmarks, setBenchmarks] = useState<BenchmarkSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [isStatusFilterOpen, setIsStatusFilterOpen] = useState(false)

  // Delete modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [benchmarkToDelete, setBenchmarkToDelete] = useState<BenchmarkSummary | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkDeleteModalOpen, setBulkDeleteModalOpen] = useState(false)
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null)

  const fetchBenchmarks = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await apiClient.listBenchmarks({
        page,
        limit: perPage,
        status: statusFilter,
      })
      setBenchmarks(response.benchmarks)
      setTotal(response.total)
    } catch (err) {
      console.error('Failed to fetch benchmarks:', err)
      setError(extractErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [page, perPage, statusFilter])

  useEffect(() => {
    fetchBenchmarks()
  }, [fetchBenchmarks, refreshTrigger])

  const handleDeleteClick = (benchmark: BenchmarkSummary) => {
    setBenchmarkToDelete(benchmark)
    setDeleteError(null)
    setDeleteModalOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!benchmarkToDelete) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await apiClient.deleteBenchmark(benchmarkToDelete.id)
      setDeleteModalOpen(false)
      setBenchmarkToDelete(null)
      fetchBenchmarks()
    } catch (err) {
      console.error('Failed to delete benchmark:', err)
      setDeleteError(extractErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  // Bulk selection handlers
  const selectableBenchmarks = benchmarks.filter((b) => b.status !== 'running')
  const areAllSelected =
    selectableBenchmarks.length > 0 && selectableBenchmarks.every((b) => selectedIds.includes(b.id))

  const handleSelectAll = (isSelected: boolean) => {
    if (isSelected) {
      setSelectedIds(selectableBenchmarks.map((b) => b.id))
    } else {
      setSelectedIds([])
    }
  }

  const handleRowSelect = (id: string, isSelected: boolean) => {
    setSelectedIds((prev) => (isSelected ? [...prev, id] : prev.filter((x) => x !== id)))
  }

  const handleBulkDeleteClick = () => {
    setBulkDeleteError(null)
    setBulkDeleteModalOpen(true)
  }

  const handleConfirmBulkDelete = async () => {
    setIsBulkDeleting(true)
    setBulkDeleteError(null)

    const errors: string[] = []
    for (const id of selectedIds) {
      try {
        await apiClient.deleteBenchmark(id)
      } catch (err) {
        console.error(`Failed to delete benchmark ${id}:`, err)
        errors.push(id)
      }
    }

    await fetchBenchmarks()
    setSelectedIds([])
    setBulkDeleteModalOpen(false)
    setIsBulkDeleting(false)

    if (errors.length > 0) {
      setBulkDeleteError(`Failed to delete ${errors.length} benchmark(s)`)
    }
  }

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-'
    return new Date(dateString).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDuration = (seconds?: number) => {
    if (seconds === undefined) return '-'
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const minutes = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${minutes}m ${secs.toFixed(0)}s`
  }

  const getStatusColor = (status: string): 'green' | 'red' | 'blue' | 'orange' | 'grey' => {
    switch (status) {
      case 'completed':
        return 'green'
      case 'failed':
      case 'cancelled':
        return 'red'
      case 'running':
        return 'blue'
      case 'pending':
        return 'orange'
      default:
        return 'grey'
    }
  }

  const statusOptions = [
    { value: undefined, label: 'All statuses' },
    { value: 'pending', label: 'Pending' },
    { value: 'running', label: 'Running' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ]

  if (isLoading && benchmarks.length === 0) {
    return (
      <EmptyState>
        <Spinner size="xl" />
        <EmptyStateBody>Loading benchmark history...</EmptyStateBody>
      </EmptyState>
    )
  }

  if (error && benchmarks.length === 0) {
    return (
      <Alert variant="danger" isInline title="Failed to load history">
        {error}
        <Button variant="link" onClick={fetchBenchmarks}>
          Retry
        </Button>
      </Alert>
    )
  }

  return (
    <>
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Select
              id="status-filter"
              isOpen={isStatusFilterOpen}
              selected={statusFilter}
              onSelect={(_event, value) => {
                setStatusFilter(value as string | undefined)
                setIsStatusFilterOpen(false)
                setPage(1)
              }}
              onOpenChange={(isOpen) => setIsStatusFilterOpen(isOpen)}
              toggle={(toggleRef) => (
                <MenuToggle
                  ref={toggleRef}
                  onClick={() => setIsStatusFilterOpen(!isStatusFilterOpen)}
                  isExpanded={isStatusFilterOpen}
                >
                  {statusOptions.find((o) => o.value === statusFilter)?.label ?? 'All statuses'}
                </MenuToggle>
              )}
            >
              <SelectList>
                {statusOptions.map((option) => (
                  <SelectOption key={option.label} value={option.value}>
                    {option.label}
                  </SelectOption>
                ))}
              </SelectList>
            </Select>
          </ToolbarItem>
          {selectedIds.length > 0 && (
            <ToolbarItem>
              <Button
                variant="danger"
                onClick={handleBulkDeleteClick}
                isDisabled={!canWrite}
                title={!canWrite ? 'You do not have permission to delete benchmarks' : undefined}
              >
                Delete {selectedIds.length} selected
              </Button>
            </ToolbarItem>
          )}
          {bulkDeleteError && (
            <ToolbarItem>
              <Alert variant="danger" isInline isPlain title={bulkDeleteError} />
            </ToolbarItem>
          )}
          <ToolbarItem variant="pagination" align={{ default: 'alignEnd' }}>
            <Pagination
              itemCount={total}
              perPage={perPage}
              page={page}
              onSetPage={(_event, newPage) => setPage(newPage)}
              onPerPageSelect={(_event, newPerPage) => {
                setPerPage(newPerPage)
                setPage(1)
              }}
              isCompact
            />
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>

      {benchmarks.length === 0 ? (
        <EmptyState>
          <EmptyStateBody>
            No benchmark runs found. {statusFilter && 'Try changing the filter or '}Run a benchmark
            to get started.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="link" onClick={fetchBenchmarks}>
                Refresh
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
      ) : (
        <Table aria-label="Benchmark history table" variant="compact">
          <Thead>
            <Tr>
              <Th
                select={{
                  onSelect: (_event, isSelected) => handleSelectAll(isSelected),
                  isSelected: areAllSelected,
                  isHeaderSelectDisabled: selectableBenchmarks.length === 0,
                }}
                aria-label="Select all benchmarks"
              />
              <Th>Name</Th>
              <Th>Status</Th>
              <Th>Mode</Th>
              <Th>Requests</Th>
              <Th>Created</Th>
              <Th>Duration</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {benchmarks.map((benchmark, rowIndex) => (
              <Tr key={benchmark.id}>
                <Td
                  select={{
                    rowIndex,
                    onSelect: (_event, isSelected) => handleRowSelect(benchmark.id, isSelected),
                    isSelected: selectedIds.includes(benchmark.id),
                    isDisabled: benchmark.status === 'running',
                  }}
                />
                <Td dataLabel="Name">{benchmark.name || benchmark.id.slice(0, 8)}</Td>
                <Td dataLabel="Status">
                  <Label color={getStatusColor(benchmark.status)}>{benchmark.status}</Label>
                </Td>
                <Td dataLabel="Mode">{benchmark.mode}</Td>
                <Td dataLabel="Requests">
                  {benchmark.successful_requests ?? 0} / {benchmark.total_requests ?? 0}
                </Td>
                <Td dataLabel="Created">{formatDate(benchmark.created_at)}</Td>
                <Td dataLabel="Duration">{formatDuration(benchmark.duration_seconds)}</Td>
                <Td dataLabel="Actions">
                  <Button
                    variant="plain"
                    icon={<EyeIcon />}
                    aria-label={`View benchmark ${benchmark.name || benchmark.id}`}
                    onClick={() => onViewBenchmark(benchmark.id)}
                  />
                  <Button
                    variant="plain"
                    icon={<RedoIcon />}
                    aria-label={`Rerun benchmark ${benchmark.name || benchmark.id}`}
                    onClick={() => onRerunBenchmark(benchmark.id)}
                    isDisabled={benchmark.status === 'running'}
                  />
                  <Button
                    variant="plain"
                    icon={<TrashIcon />}
                    aria-label={`Delete benchmark ${benchmark.name || benchmark.id}`}
                    onClick={() => handleDeleteClick(benchmark)}
                    isDisabled={benchmark.status === 'running' || !canWrite}
                    title={
                      !canWrite ? 'You do not have permission to delete benchmarks' : undefined
                    }
                  />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      <Modal
        variant={ModalVariant.small}
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
      >
        <ModalHeader title="Delete Benchmark?" titleIconVariant="warning" />
        <ModalBody>
          {deleteError && (
            <Alert
              variant="danger"
              isInline
              title="Failed to delete"
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            >
              {deleteError}
            </Alert>
          )}
          <p>
            Are you sure you want to delete the benchmark{' '}
            <strong>{benchmarkToDelete?.name || benchmarkToDelete?.id.slice(0, 8)}</strong>?
          </p>
          <p style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
            This will permanently delete all results and metrics.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setDeleteModalOpen(false)}
            isDisabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirmDelete}
            isLoading={isDeleting}
            isDisabled={isDeleting}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </Modal>

      {/* Bulk Delete Modal */}
      <Modal
        variant={ModalVariant.small}
        isOpen={bulkDeleteModalOpen}
        onClose={() => setBulkDeleteModalOpen(false)}
      >
        <ModalHeader title="Delete Selected Benchmarks?" titleIconVariant="warning" />
        <ModalBody>
          <p>
            Are you sure you want to delete <strong>{selectedIds.length}</strong> selected benchmark
            {selectedIds.length === 1 ? '' : 's'}?
          </p>
          <p style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
            This will permanently delete all results and metrics for the selected benchmarks.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="secondary"
            onClick={() => setBulkDeleteModalOpen(false)}
            isDisabled={isBulkDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleConfirmBulkDelete}
            isLoading={isBulkDeleting}
            isDisabled={isBulkDeleting}
          >
            {isBulkDeleting ? 'Deleting...' : `Delete ${selectedIds.length}`}
          </Button>
        </ModalFooter>
      </Modal>
    </>
  )
}

export default BenchmarkHistoryTable
