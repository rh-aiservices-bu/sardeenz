import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Drawer,
  DrawerContent,
  DrawerContentBody,
  DrawerPanelContent,
  Spinner,
  Flex,
  FlexItem,
} from '@patternfly/react-core'
import type { ModelInstanceDTO } from '@sardeenz/types'
import { apiClient } from '../../services/api'
import { useNotifications } from '../../contexts/NotificationContext'
import { useInferenceWorkspace } from '../../contexts/InferenceWorkspaceContext'
import { ModelSidebar } from './ModelSidebar'
import { WorkspaceArea } from './WorkspaceArea'

/**
 * Main workspace container for inference testing.
 * Uses a Drawer layout with a collapsible sidebar on the left
 * and the main workspace area on the right.
 */
export function InferenceWorkspace() {
  const [models, setModels] = useState<ModelInstanceDTO[]>([])
  const [loading, setLoading] = useState(true)

  const { addNotification } = useNotifications()
  const workspaceState = useInferenceWorkspace()

  // Destructure stable callbacks to avoid dependency on the entire workspaceState object
  const { syncSessions, findSessionByModelId, setActiveSession, addSession } = workspaceState

  // Fetch running models
  const fetchModels = useCallback(async () => {
    try {
      const response = await apiClient.listModels()
      // Filter to only show running models
      const runningModels = response.models.filter((m) => m.status === 'running')
      setModels(runningModels)
      // Sync sessions with current running models (restores from sessionStorage on initial load)
      syncSessions(runningModels)
    } catch (err) {
      addNotification({
        title: 'Error fetching models',
        description: err instanceof Error ? err.message : 'Failed to fetch models',
        variant: 'danger',
      })
    } finally {
      setLoading(false)
    }
  }, [addNotification, syncSessions])

  // Use ref to stabilize fetchModels for polling effect
  const fetchModelsRef = useRef(fetchModels)

  // Sync ref on each render (following existing pattern from useInstanceEvents.ts)
  useEffect(() => {
    fetchModelsRef.current = fetchModels
  })

  // Initial fetch and polling - uses stable ref to prevent infinite loop
  useEffect(() => {
    // Initial fetch
    fetchModelsRef.current()

    // Auto-refresh every 5 seconds using ref to always call latest version
    const interval = setInterval(() => {
      fetchModelsRef.current()
    }, 5000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Intentionally empty: using ref pattern to prevent infinite loops
  }, [])

  // Handle selecting a model from the sidebar
  const handleModelSelect = useCallback(
    (model: ModelInstanceDTO) => {
      // Check if model is already open
      const existingSession = findSessionByModelId(model.id)
      if (existingSession) {
        // Just activate it
        setActiveSession(existingSession.id)
      } else {
        // Add new session
        addSession(model)
      }
    },
    [findSessionByModelId, setActiveSession, addSession]
  )

  if (loading) {
    return (
      <Flex
        justifyContent={{ default: 'justifyContentCenter' }}
        alignItems={{ default: 'alignItemsCenter' }}
        style={{ height: '100%', minHeight: '400px' }}
      >
        <FlexItem>
          <Spinner size="xl" aria-label="Loading models" />
        </FlexItem>
      </Flex>
    )
  }

  const sidebarPanel = (
    <DrawerPanelContent
      isResizable
      defaultSize={'380px'}
      minSize={'200px'}
      maxSize={'400px'}
      style={{
        borderRight: '1px solid var(--pf-t--global--border--color--default)',
      }}
    >
      <ModelSidebar
        models={models}
        searchTerm={workspaceState.searchTerm}
        onSearchChange={workspaceState.setSearchTerm}
        expandedGpuGroups={workspaceState.expandedGpuGroups}
        onToggleGpuGroup={workspaceState.toggleGpuGroup}
        onModelSelect={handleModelSelect}
        isModelOpen={workspaceState.isModelOpen}
        activeSessionId={workspaceState.activeSessionId}
        findSessionByModelId={workspaceState.findSessionByModelId}
        sessionCount={workspaceState.sessions.size}
        onCloseAllSessions={workspaceState.clearAllSessions}
      />
    </DrawerPanelContent>
  )

  return (
    <Drawer isExpanded={workspaceState.sidebarExpanded} isInline position="start">
      <DrawerContent panelContent={sidebarPanel}>
        <DrawerContentBody style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <WorkspaceArea
            sessions={workspaceState.sessions}
            activeSessionId={workspaceState.activeSessionId}
            layout={workspaceState.layout}
            onLayoutChange={workspaceState.setLayout}
            onSessionClose={workspaceState.removeSession}
            onSessionSelect={workspaceState.setActiveSession}
            onSessionStatusChange={workspaceState.updateSessionStatus}
            getVisibleSessions={workspaceState.getVisibleSessions}
            sidebarExpanded={workspaceState.sidebarExpanded}
            onToggleSidebar={workspaceState.toggleSidebar}
            paneAssignments={workspaceState.paneAssignments}
            onAssignSessionToPane={workspaceState.assignSessionToPane}
          />
        </DrawerContentBody>
      </DrawerContent>
    </Drawer>
  )
}
