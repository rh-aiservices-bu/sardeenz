import { useState, useEffect, useCallback } from 'react'
import { Stack, StackItem, Card, CardTitle, CardBody } from '@patternfly/react-core'
import { apiClient, extractErrorMessage } from '../../services/api'
import type { MemoryProfileResponse } from '../../services/api'
import { CreateProfileCard } from './CreateProfileCard'
import { ProfilesTable } from './ProfilesTable'

/**
 * Memory Profiles tab content component.
 * Displays CreateProfileCard (top) and ProfilesTable (below).
 */
export function MemoryProfilesTab() {
  const [profiles, setProfiles] = useState<MemoryProfileResponse[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchProfiles = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await apiClient.listMemoryProfiles()
      setProfiles(response.profiles)
    } catch (err) {
      console.error('Failed to fetch memory profiles:', err)
      setError(extractErrorMessage(err))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfiles()
  }, [fetchProfiles])

  return (
    <Stack hasGutter>
      <StackItem>
        <CreateProfileCard onProfileCreated={fetchProfiles} />
      </StackItem>
      <StackItem>
        <Card>
          <CardTitle>Saved Memory Profiles</CardTitle>
          <CardBody>
            <ProfilesTable
              profiles={profiles}
              isLoading={isLoading}
              error={error}
              onProfileDeleted={fetchProfiles}
              onRefresh={fetchProfiles}
            />
          </CardBody>
        </Card>
      </StackItem>
    </Stack>
  )
}

export default MemoryProfilesTab
