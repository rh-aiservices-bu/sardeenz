import { useState } from 'react'
import { Table, Thead, Tbody, Tr, Th, Td, ThProps } from '@patternfly/react-table'
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
  Flex,
  FlexItem,
  Tooltip,
} from '@patternfly/react-core'
import { TrashIcon, InfoCircleIcon } from '@patternfly/react-icons'
import type { MemoryProfileResponse } from '../../services/api'
import { apiClient, extractErrorMessage } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'

interface ProfilesTableProps {
  profiles: MemoryProfileResponse[]
  isLoading: boolean
  error: string | null
  onProfileDeleted: () => void
  onRefresh: () => void
}

type SortableColumn = 'model_path' | 'max_tokens' | 'gpu_name' | 'fixed_cost' | 'created_at'

/**
 * Table component displaying saved memory profiles.
 * Follows PatternFly 6 table patterns.
 */
export function ProfilesTable({
  profiles,
  isLoading,
  error,
  onProfileDeleted,
  onRefresh,
}: ProfilesTableProps) {
  const { canWrite } = useAuth()
  const [sortBy, setSortBy] = useState<SortableColumn>('created_at')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc')
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [profileToDelete, setProfileToDelete] = useState<MemoryProfileResponse | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Get total GPU memory (fixed cost)
  const getFixedCost = (profile: MemoryProfileResponse) => {
    return profile.total_gpu_memory_gib
  }

  // Sort profiles
  const sortedProfiles = [...profiles].sort((a, b) => {
    let comparison = 0

    switch (sortBy) {
      case 'model_path':
        comparison = a.model_path.localeCompare(b.model_path)
        break
      case 'max_tokens':
        comparison = a.max_tokens - b.max_tokens
        break
      case 'gpu_name':
        comparison = (a.gpu_name ?? '').localeCompare(b.gpu_name ?? '')
        break
      case 'fixed_cost':
        comparison = getFixedCost(a) - getFixedCost(b)
        break
      case 'created_at':
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        break
    }

    return sortDirection === 'asc' ? comparison : -comparison
  })

  const handleSort = (column: SortableColumn): ThProps['sort'] => ({
    sortBy: {
      index: ['model_path', 'max_tokens', 'gpu_name', 'fixed_cost', 'created_at'].indexOf(column),
      direction: sortBy === column ? sortDirection : 'asc',
    },
    onSort: () => {
      if (sortBy === column) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
      } else {
        setSortBy(column)
        setSortDirection('asc')
      }
    },
    columnIndex: ['model_path', 'max_tokens', 'gpu_name', 'fixed_cost', 'created_at'].indexOf(
      column
    ),
  })

  const handleDeleteClick = (profile: MemoryProfileResponse) => {
    setProfileToDelete(profile)
    setDeleteError(null)
    setDeleteModalOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!profileToDelete) return

    setIsDeleting(true)
    setDeleteError(null)

    try {
      await apiClient.deleteMemoryProfile(profileToDelete.id)
      setDeleteModalOpen(false)
      setProfileToDelete(null)
      onProfileDeleted()
    } catch (err) {
      console.error('Failed to delete profile:', err)
      setDeleteError(extractErrorMessage(err))
    } finally {
      setIsDeleting(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (isLoading) {
    return (
      <EmptyState>
        <Spinner size="xl" />
        <EmptyStateBody>Loading memory profiles...</EmptyStateBody>
      </EmptyState>
    )
  }

  if (error) {
    return (
      <Alert variant="danger" isInline title="Failed to load profiles">
        {error}
        <Button variant="link" onClick={onRefresh}>
          Retry
        </Button>
      </Alert>
    )
  }

  if (profiles.length === 0) {
    return (
      <EmptyState>
        <EmptyStateBody>
          No memory profiles found. Capture a profile from a running model to get started.
        </EmptyStateBody>
        <EmptyStateFooter>
          <EmptyStateActions>
            <Button variant="link" onClick={onRefresh}>
              Refresh
            </Button>
          </EmptyStateActions>
        </EmptyStateFooter>
      </EmptyState>
    )
  }

  return (
    <>
      <Table aria-label="Memory profiles table" variant="compact">
        <Thead>
          <Tr>
            <Th sort={handleSort('model_path')}>Model Path</Th>
            <Th sort={handleSort('max_tokens')}>Max Tokens</Th>
            <Th sort={handleSort('gpu_name')}>GPU</Th>
            <Th sort={handleSort('fixed_cost')}>
              <Flex alignItems={{ default: 'alignItemsCenter' }} gap={{ default: 'gapSm' }}>
                <FlexItem>VRAM (GiB)</FlexItem>
                <FlexItem>
                  <Tooltip content="Total GPU memory used by model">
                    <InfoCircleIcon />
                  </Tooltip>
                </FlexItem>
              </Flex>
            </Th>
            <Th sort={handleSort('created_at')}>Created</Th>
            <Th>Actions</Th>
          </Tr>
        </Thead>
        <Tbody>
          {sortedProfiles.map((profile) => (
            <Tr key={profile.id}>
              <Td dataLabel="Model Path">
                <Tooltip content={profile.profile_name}>
                  <span>{profile.model_path}</span>
                </Tooltip>
              </Td>
              <Td dataLabel="Max Tokens">{profile.max_tokens.toLocaleString()}</Td>
              <Td dataLabel="GPU">{profile.gpu_name ?? '-'}</Td>
              <Td dataLabel="VRAM (GiB)">
                <Tooltip
                  content={`Weights: ${profile.weights_memory_gib.toFixed(2)} GiB, CUDA Graphs: ${profile.cuda_graphs_gib.toFixed(2)} GiB, Overhead: ${profile.overhead_memory_gib?.toFixed(2) ?? '0.00'} GiB`}
                >
                  <span>{getFixedCost(profile).toFixed(2)}</span>
                </Tooltip>
              </Td>
              <Td dataLabel="Created">{formatDate(profile.created_at)}</Td>
              <Td dataLabel="Actions">
                <Button
                  variant="plain"
                  icon={<TrashIcon />}
                  aria-label={`Delete profile ${profile.profile_name}`}
                  onClick={() => handleDeleteClick(profile)}
                  isDisabled={!canWrite}
                  title={
                    !canWrite ? 'You do not have permission to delete memory profiles' : undefined
                  }
                />
              </Td>
            </Tr>
          ))}
        </Tbody>
      </Table>

      <Modal
        variant={ModalVariant.small}
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
      >
        <ModalHeader title="Delete Memory Profile?" titleIconVariant="warning" />
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
            Are you sure you want to delete the profile for{' '}
            <strong>{profileToDelete?.model_path}</strong> at{' '}
            <strong>{profileToDelete?.max_tokens.toLocaleString()}</strong> tokens?
          </p>
          <p style={{ marginTop: 'var(--pf-t--global--spacer--sm)' }}>
            This will remove the saved memory measurements and affect pre-load warnings.
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
    </>
  )
}

export default ProfilesTable
