import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react'
import { apiClient } from '../services/api'
import { useConnection } from './ConnectionContext'
import type { AuthMode, AuthUser, LoginRequest } from '@sardeenz/types'

interface AuthContextType {
  isAuthenticated: boolean
  isLoading: boolean
  user: AuthUser | null
  authMode: AuthMode
  error: string | null
  login: (credentials: LoginRequest) => Promise<void>
  loginWithOAuth: () => void
  logout: () => Promise<void>
  clearError: () => void
  /** True if user has 'admin' role */
  isAdmin: boolean
  /** True if user has 'admin-readonly' but NOT 'admin' */
  isReadonly: boolean
  /** Alias for isAdmin - true if user can perform write operations */
  canWrite: boolean
  /** True if the error indicates user is not in any authorized groups */
  isAccessDenied: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

// Session storage key for OAuth callback token
const OAUTH_TOKEN_KEY = 'sardeenz_oauth_token'
// Session storage key for auth token persistence
const AUTH_TOKEN_KEY = 'sardeenz_auth_token'

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const { isConnected } = useConnection()
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('none')
  const [error, setError] = useState<string | null>(null)
  const [oauthLoginUrl, setOauthLoginUrl] = useState<string | null>(null)

  // Parse JWT to extract user info without verification (for display only)
  const parseJwt = useCallback((token: string): AuthUser | null => {
    try {
      const parts = token.split('.')
      if (parts.length !== 3) return null
      const payload = JSON.parse(atob(parts[1]))
      return {
        username: payload.username || payload.preferred_username || 'unknown',
        email: payload.email,
        roles: payload.roles || [],
      }
    } catch {
      return null
    }
  }, [])

  // Set token and update state
  const setAuthState = useCallback(
    async (token: string) => {
      sessionStorage.setItem(AUTH_TOKEN_KEY, token)
      apiClient.setAuthToken(token)
      const userInfo = parseJwt(token)
      setUser(userInfo)
      setIsAuthenticated(true)
      setError(null)

      // Fetch additional user info including inference API key
      try {
        const currentUser = await apiClient.getCurrentUser()
        if (currentUser.inferenceApiKey) {
          apiClient.setInferenceApiKey(currentUser.inferenceApiKey)
        }
      } catch {
        // Ignore errors fetching additional user info
      }

      // Calculate token expiration and set timer
      try {
        const parts = token.split('.')
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1]))
          if (payload.exp) {
            const expiresIn = payload.exp * 1000 - Date.now()
            if (expiresIn > 0) {
              // Auto-logout when token expires (with 1 minute buffer)
              const timeout = Math.max(expiresIn - 60000, 0)
              setTimeout(() => {
                setIsAuthenticated(false)
                setUser(null)
                apiClient.setAuthToken(null)
                apiClient.setInferenceApiKey(null)
              }, timeout)
            }
          }
        }
      } catch {
        // Ignore parsing errors for expiration
      }
    },
    [parseJwt]
  )

  // Initialize auth state when connection is available
  useEffect(() => {
    // Wait for backend connection before fetching auth info
    if (!isConnected) {
      return
    }

    const initAuth = async () => {
      try {
        // Fetch auth configuration
        const authInfo = await apiClient.getAuthInfo()
        setAuthMode(authInfo.mode)

        if (authInfo.oauthLoginUrl) {
          setOauthLoginUrl(authInfo.oauthLoginUrl)
        }

        // If auth is disabled, we're authenticated by default
        if (authInfo.mode === 'none') {
          setIsAuthenticated(true)
          setUser({ username: 'anonymous', roles: ['admin'] })
          // Fetch inference API key even when auth is disabled
          try {
            const currentUser = await apiClient.getCurrentUser()
            if (currentUser.inferenceApiKey) {
              apiClient.setInferenceApiKey(currentUser.inferenceApiKey)
            }
          } catch {
            // Ignore errors
          }
          setIsLoading(false)
          return
        }

        // Check for OAuth callback token in URL hash
        const hash = window.location.hash
        if (hash.startsWith('#token=')) {
          const token = hash.substring(7)
          setAuthState(token)
          // Clean up URL
          window.history.replaceState(null, '', window.location.pathname + window.location.search)
          setIsLoading(false)
          return
        }

        // Check for token in session storage (from OAuth callback)
        const storedToken = sessionStorage.getItem(OAUTH_TOKEN_KEY)
        if (storedToken) {
          sessionStorage.removeItem(OAUTH_TOKEN_KEY)
          setAuthState(storedToken)
          setIsLoading(false)
          return
        }

        // Check for persisted auth token
        const persistedToken = sessionStorage.getItem(AUTH_TOKEN_KEY)
        if (persistedToken) {
          setAuthState(persistedToken)
          setIsLoading(false)
          return
        }

        // Check for auth error in URL
        const urlParams = new URLSearchParams(window.location.search)
        const authError = urlParams.get('auth_error')
        if (authError) {
          setError(decodeURIComponent(authError))
          // Clean up URL
          urlParams.delete('auth_error')
          const newSearch = urlParams.toString()
          window.history.replaceState(
            null,
            '',
            window.location.pathname + (newSearch ? '?' + newSearch : '')
          )
        }

        // No token found, user needs to authenticate
        setIsLoading(false)
      } catch (err) {
        console.error('Failed to initialize auth:', err)
        setError('Failed to connect to server')
        setIsLoading(false)
      }
    }

    initAuth()
  }, [isConnected, setAuthState])

  // Listen for unauthorized events from API client
  useEffect(() => {
    const handleUnauthorized = () => {
      sessionStorage.removeItem(AUTH_TOKEN_KEY)
      setIsAuthenticated(false)
      setUser(null)
      apiClient.setAuthToken(null)
      apiClient.setInferenceApiKey(null)
      setError('Session expired. Please log in again.')
    }

    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [])

  // Login with username/password (simple mode)
  const login = useCallback(async (credentials: LoginRequest) => {
    setError(null)
    try {
      const response = await apiClient.login(credentials)
      sessionStorage.setItem(AUTH_TOKEN_KEY, response.token)
      apiClient.setAuthToken(response.token)
      setUser(response.user)
      setIsAuthenticated(true)
      // Fetch additional user info including inference API key
      try {
        const currentUser = await apiClient.getCurrentUser()
        if (currentUser.inferenceApiKey) {
          apiClient.setInferenceApiKey(currentUser.inferenceApiKey)
        }
      } catch {
        // Ignore errors fetching additional user info
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data
              ?.error?.message || 'Login failed'
      setError(message)
      throw err
    }
  }, [])

  // Redirect to OAuth login
  const loginWithOAuth = useCallback(() => {
    if (oauthLoginUrl) {
      window.location.href = oauthLoginUrl
    } else {
      setError('OAuth login is not configured')
    }
  }, [oauthLoginUrl])

  // Logout
  const logout = useCallback(async () => {
    try {
      await apiClient.logout()
    } catch {
      // Ignore logout errors
    }
    sessionStorage.removeItem(AUTH_TOKEN_KEY)
    apiClient.setAuthToken(null)
    apiClient.setInferenceApiKey(null)
    setUser(null)
    setIsAuthenticated(false)
    setError(null)
  }, [])

  // Clear error
  const clearError = useCallback(() => {
    setError(null)
  }, [])

  // Role helper computed values
  const isAdmin = user?.roles?.includes('admin') ?? false
  const isReadonly = (user?.roles?.includes('admin-readonly') ?? false) && !isAdmin
  const canWrite = isAdmin

  // Detect access denied error (user not in any authorized groups)
  const isAccessDenied = error?.includes('not a member') ?? false

  const value: AuthContextType = {
    isAuthenticated,
    isLoading,
    user,
    authMode,
    error,
    login,
    loginWithOAuth,
    logout,
    clearError,
    isAdmin,
    isReadonly,
    canWrite,
    isAccessDenied,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
