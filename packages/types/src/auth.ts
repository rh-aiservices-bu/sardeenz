/**
 * Authentication types shared between backend and frontend
 */

/**
 * Authentication mode configuration
 * - none: No authentication required
 * - simple: Username/password authentication with JWT
 * - oauth: OAuth 2.0 authentication (e.g., OpenShift OAuth)
 */
export type AuthMode = 'none' | 'simple' | 'oauth'

/**
 * User information returned after authentication
 */
export interface AuthUser {
  username: string
  email?: string
  roles: string[]
}

/**
 * Response from /api/auth/info endpoint
 * Frontend uses this to determine which login UI to show
 */
export interface AuthInfoResponse {
  mode: AuthMode
  oauthLoginUrl?: string
}

/**
 * Request body for /api/auth/login endpoint (simple mode)
 */
export interface LoginRequest {
  username: string
  password: string
}

/**
 * Response from /api/auth/login endpoint
 */
export interface LoginResponse {
  token: string
  user: AuthUser
  expiresIn: number
}

/**
 * Response from /api/auth/me endpoint
 */
export interface CurrentUserResponse {
  username: string
  email?: string
  roles: string[]
  authMode: 'simple' | 'oauth'
  /** Inference API key for OpenAI-compatible endpoints (only when INFERENCE_API_KEY is configured) */
  inferenceApiKey?: string
}

/**
 * Response from /api/auth/logout endpoint
 */
export interface LogoutResponse {
  status: 'success'
}

/**
 * JWT payload structure used internally
 */
export interface JWTPayload {
  sub: string
  username: string
  email?: string
  roles: string[]
  authMode: 'simple' | 'oauth'
  iat: number
  exp: number
}
