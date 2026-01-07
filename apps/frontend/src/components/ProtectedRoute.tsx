import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Bullseye, Spinner } from '@patternfly/react-core'
import { useAuth } from '../contexts/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRoles?: string[]
}

/**
 * ProtectedRoute component
 *
 * Wraps routes that require authentication. Handles:
 * - Loading state while auth is initializing
 * - Redirect to login if not authenticated
 * - Role-based access control (optional)
 * - Passes through if auth mode is 'none'
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, requiredRoles }) => {
  const { isAuthenticated, isLoading, authMode, user } = useAuth()
  const location = useLocation()

  // Show loading while auth is initializing
  if (isLoading) {
    return (
      <Bullseye>
        <Spinner aria-label="Loading authentication" />
      </Bullseye>
    )
  }

  // If auth is disabled, allow access
  if (authMode === 'none') {
    return <>{children}</>
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // Check role requirements if specified
  if (requiredRoles && requiredRoles.length > 0) {
    const userRoles = user?.roles || []
    const hasRequiredRole = requiredRoles.some((role) => userRoles.includes(role))

    if (!hasRequiredRole) {
      // User doesn't have required role - show forbidden or redirect
      return (
        <Bullseye>
          <div className="pf-v6-u-text-align-center">
            <h2>Access Denied</h2>
            <p className="pf-v6-u-mt-md">You don&apos;t have permission to access this page.</p>
          </div>
        </Bullseye>
      )
    }
  }

  return <>{children}</>
}

export default ProtectedRoute
