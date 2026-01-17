import { createContext, useContext, type ReactNode } from 'react'
import { useWorkspaceState } from '../hooks/useWorkspaceState'
import type { WorkspaceState, WorkspaceActions } from '../components/inference/workspace-types'

type InferenceWorkspaceContextType = WorkspaceState & WorkspaceActions

const InferenceWorkspaceContext = createContext<InferenceWorkspaceContextType | null>(null)

interface InferenceWorkspaceProviderProps {
  children: ReactNode
}

/**
 * Provider component that wraps the app to provide workspace state at app level.
 * This ensures workspace state persists across navigation between pages.
 */
export function InferenceWorkspaceProvider({ children }: InferenceWorkspaceProviderProps) {
  const workspaceState = useWorkspaceState()

  return (
    <InferenceWorkspaceContext.Provider value={workspaceState}>
      {children}
    </InferenceWorkspaceContext.Provider>
  )
}

/**
 * Hook to access the inference workspace state and actions.
 * Must be used within an InferenceWorkspaceProvider.
 */
export function useInferenceWorkspace(): InferenceWorkspaceContextType {
  const context = useContext(InferenceWorkspaceContext)
  if (!context) {
    throw new Error('useInferenceWorkspace must be used within an InferenceWorkspaceProvider')
  }
  return context
}
