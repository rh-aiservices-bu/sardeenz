import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Type, type Static } from '@sinclair/typebox'
import { randomBytes, timingSafeEqual } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { config } from '../config.js'

/**
 * Timing-safe string comparison to prevent timing attacks
 */
function secureCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    // Lengths differ - still do a comparison to avoid leaking length info via timing
    // Compare against self to maintain constant time
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
import type {
  AuthInfoResponse,
  LoginResponse,
  CurrentUserResponse,
  LogoutResponse,
} from '@sardeenz/types'
import type { JWTSignPayload } from '../plugins/auth.js'

// Request body schema for login
const LoginRequestSchema = Type.Object({
  username: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
})

// Response schemas
const AuthInfoResponseSchema = Type.Object({
  mode: Type.Union([Type.Literal('none'), Type.Literal('simple'), Type.Literal('oauth')]),
  oauthLoginUrl: Type.Optional(Type.String()),
})

const LoginResponseSchema = Type.Object({
  token: Type.String(),
  user: Type.Object({
    username: Type.String(),
    email: Type.Optional(Type.String()),
    roles: Type.Array(Type.String()),
  }),
  expiresIn: Type.Number(),
})

const CurrentUserResponseSchema = Type.Object({
  username: Type.String(),
  email: Type.Optional(Type.String()),
  roles: Type.Array(Type.String()),
  authMode: Type.Union([Type.Literal('simple'), Type.Literal('oauth')]),
  inferenceApiKey: Type.Optional(Type.String()),
})

const LogoutResponseSchema = Type.Object({
  status: Type.Literal('success'),
})

const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    message: Type.String(),
    type: Type.String(),
    code: Type.Optional(Type.String()),
  }),
})

// In-memory state storage for OAuth CSRF protection
// Maps state -> { callbackUrl, createdAt }
const oauthStateStore = new Map<string, { callbackUrl: string; createdAt: number }>()
const STATE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// Clean up expired states periodically
function cleanupExpiredStates(): void {
  const now = Date.now()
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > STATE_TTL_MS) {
      oauthStateStore.delete(state)
    }
  }
}

// Run cleanup every minute
setInterval(cleanupExpiredStates, 60 * 1000)

/**
 * Get the ServiceAccount token for making K8s API calls
 * Priority: 1) SERVICE_ACCOUNT_TOKEN env var, 2) Token file (K8s mounted)
 * Returns undefined if neither is available
 */
function getServiceAccountToken(): string | undefined {
  // Priority 1: Direct token from env var (for dev mode)
  if (config.serviceAccountToken) {
    return config.serviceAccountToken
  }

  // Priority 2: Token file (for K8s deployment)
  if (existsSync(config.serviceAccountTokenPath)) {
    return readFileSync(config.serviceAccountTokenPath, 'utf-8').trim()
  }

  return undefined
}

/**
 * Check if a user has access to a specific sardeenz role via Kubernetes RBAC
 * Uses LocalSubjectAccessReview API (namespace-scoped) to check role permissions
 * Uses ServiceAccount token (not user's OAuth token) for the API call
 */
async function checkResourceAccess(
  username: string,
  groups: string[],
  resource: string
): Promise<boolean> {
  const saToken = getServiceAccountToken()
  if (!saToken) {
    // Not running in K8s and no SA token configured
    if (config.nodeEnv === 'development') {
      // In dev mode without SA token, deny access (require proper setup)
      return false
    }
    throw new Error(
      'ServiceAccount token not found. Set SERVICE_ACCOUNT_TOKEN env var or ensure running in Kubernetes.'
    )
  }

  // Use LocalSubjectAccessReview (namespace-scoped) instead of SubjectAccessReview (cluster-scoped)
  // This only requires a namespace-scoped Role, not a ClusterRole
  const response = await fetch(
    `${config.k8sApiUrl}/apis/authorization.k8s.io/v1/namespaces/${config.namespace}/localsubjectaccessreviews`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${saToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'LocalSubjectAccessReview',
        metadata: {
          namespace: config.namespace,
        },
        spec: {
          user: username,
          groups,
          resourceAttributes: {
            namespace: config.namespace,
            group: 'sardeenz.rh-aiservices-bu.io',
            resource,
            verb: 'get',
          },
        },
      }),
    }
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`LocalSubjectAccessReview failed: ${response.status} - ${errorText}`)
  }

  const result = (await response.json()) as { status?: { allowed?: boolean } }
  return result.status?.allowed === true
}

/**
 * Resolve user roles via Kubernetes LocalSubjectAccessReview API
 * Uses namespace-scoped Roles in the sardeenz namespace
 */
async function resolveUserRolesViaRbac(username: string, groups: string[]): Promise<string[]> {
  const roles: string[] = []

  // Check admin role
  if (await checkResourceAccess(username, groups, 'admin')) {
    roles.push('admin')
  }

  // Check admin-readonly role
  if (await checkResourceAccess(username, groups, 'admin-readonly')) {
    roles.push('admin-readonly')
  }

  return roles
}

/**
 * OpenShift user info response structure
 */
interface OpenShiftUserInfo {
  kind: string
  apiVersion: string
  metadata: {
    name: string
    uid: string
  }
  groups: string[]
}

export default async function authRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/auth/info
   * Returns authentication configuration for the frontend
   */
  fastify.get<{ Reply: AuthInfoResponse }>(
    '/api/auth/info',
    {
      schema: {
        tags: ['auth'],
        description: 'Get authentication configuration',
        response: {
          200: AuthInfoResponseSchema,
        },
      },
    },
    async (): Promise<AuthInfoResponse> => {
      const response: AuthInfoResponse = {
        mode: config.authMode,
      }

      // Include OAuth login URL if in OAuth mode
      if (config.authMode === 'oauth') {
        response.oauthLoginUrl = `${config.apiBaseUrl}/api/auth/login`
      }

      return response
    }
  )

  /**
   * GET /api/auth/login
   * OAuth mode: Redirect to OAuth provider
   */
  fastify.get(
    '/api/auth/login',
    {
      schema: {
        tags: ['auth'],
        description: 'Redirect to OAuth provider (OAuth mode only)',
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (config.authMode !== 'oauth') {
        return reply.code(400).send({
          error: {
            message: 'OAuth login is not configured. Use POST /api/auth/login for simple mode.',
            type: 'invalid_request',
          },
        })
      }

      // Generate state for CSRF protection
      const state = randomBytes(32).toString('hex')

      // Determine callback URL based on request origin
      const origin =
        request.headers.origin ||
        (request.headers.host ? `${request.protocol}://${request.headers.host}` : null)
      const callbackUrl = origin
        ? `${origin}/api/auth/callback`
        : `${config.apiBaseUrl}/api/auth/callback`

      // Store state for validation
      oauthStateStore.set(state, { callbackUrl, createdAt: Date.now() })

      // Build authorization URL
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.oauthClientId,
        redirect_uri: callbackUrl,
        scope: 'user:info',
        state,
      })

      const authorizationUrl = `${config.oauthIssuerUrl}/oauth/authorize?${params.toString()}`

      fastify.log.debug({ authorizationUrl, callbackUrl }, 'Redirecting to OAuth provider')

      return reply.redirect(authorizationUrl)
    }
  )

  /**
   * POST /api/auth/login
   * Simple mode: Authenticate with username/password
   */
  fastify.post<{
    Body: Static<typeof LoginRequestSchema>
    Reply: LoginResponse | { error: { message: string; type: string } }
  }>(
    '/api/auth/login',
    {
      schema: {
        tags: ['auth'],
        description: 'Authenticate with username and password (simple mode only)',
        body: LoginRequestSchema,
        response: {
          200: LoginResponseSchema,
          401: ErrorResponseSchema,
          400: ErrorResponseSchema,
          429: ErrorResponseSchema,
        },
      },
      // Rate limit: 5 attempts per minute per IP to prevent brute force
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply): Promise<LoginResponse> => {
      // Only allow simple auth login via this endpoint
      if (config.authMode !== 'simple') {
        reply.code(400).send({
          error: {
            message:
              config.authMode === 'none'
                ? 'Authentication is disabled'
                : 'Use OAuth login for this server (GET /api/auth/login)',
            type: 'invalid_request',
          },
        })
        return reply
      }

      const { username, password } = request.body

      // Validate credentials using timing-safe comparison to prevent timing attacks
      const usernameValid = secureCompare(username, config.adminUsername)
      const passwordValid = secureCompare(password, config.adminPassword)
      if (!usernameValid || !passwordValid) {
        reply.code(401).send({
          error: {
            message: 'Invalid username or password',
            type: 'authentication_error',
          },
        })
        return reply
      }

      // Create JWT payload
      const payload: JWTSignPayload = {
        sub: username,
        username,
        roles: ['admin'], // Simple mode users get admin role
        authMode: 'simple',
      }

      // Sign JWT
      const token = fastify.jwt.sign(payload)
      const expiresIn = config.jwtExpirationHours * 60 * 60 // Convert to seconds

      return {
        token,
        user: {
          username,
          roles: ['admin'],
        },
        expiresIn,
      }
    }
  )

  /**
   * GET /api/auth/callback
   * OAuth callback handler - exchanges code for token and redirects to frontend
   */
  fastify.get(
    '/api/auth/callback',
    {
      schema: {
        tags: ['auth'],
        description: 'OAuth callback endpoint',
        querystring: Type.Object({
          code: Type.Optional(Type.String()),
          state: Type.Optional(Type.String()),
          error: Type.Optional(Type.String()),
          error_description: Type.Optional(Type.String()),
        }),
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: {
          code?: string
          state?: string
          error?: string
          error_description?: string
        }
      }>,
      reply: FastifyReply
    ) => {
      // Check if OAuth is configured
      if (config.authMode !== 'oauth') {
        return reply.code(400).send({
          error: {
            message: 'OAuth authentication is not configured',
            type: 'configuration_error',
          },
        })
      }

      // Check for errors from OAuth provider
      if (request.query.error) {
        const errorMessage = request.query.error_description || request.query.error
        fastify.log.error(
          { error: request.query.error, description: request.query.error_description },
          'OAuth provider returned error'
        )
        return reply.redirect(
          `${config.frontendUrl}/?auth_error=${encodeURIComponent(errorMessage)}`
        )
      }

      const { code, state } = request.query

      if (!code || !state) {
        return reply.redirect(
          `${config.frontendUrl}/?auth_error=${encodeURIComponent('Missing authorization code or state')}`
        )
      }

      // Validate state (CSRF protection)
      const storedState = oauthStateStore.get(state)
      if (!storedState) {
        fastify.log.warn({ state }, 'Invalid or expired OAuth state')
        return reply.redirect(
          `${config.frontendUrl}/?auth_error=${encodeURIComponent('Invalid or expired state. Please try logging in again.')}`
        )
      }

      // Remove used state
      oauthStateStore.delete(state)

      const callbackUrl = storedState.callbackUrl

      try {
        // Exchange authorization code for access token
        const tokenUrl = `${config.oauthIssuerUrl}/oauth/token`

        fastify.log.debug({ tokenUrl, callbackUrl }, 'Exchanging code for token')

        const tokenResponse = await fetch(tokenUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code,
            client_id: config.oauthClientId,
            client_secret: config.oauthClientSecret,
            redirect_uri: callbackUrl,
          }),
        })

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text()
          fastify.log.error(
            { status: tokenResponse.status, body: errorText },
            'Token exchange failed'
          )
          throw new Error(`Token exchange failed: ${tokenResponse.status}`)
        }

        const tokenData = (await tokenResponse.json()) as { access_token: string }
        const accessToken = tokenData.access_token

        // Fetch user info from Kubernetes API
        const userInfoUrl = `${config.k8sApiUrl}/apis/user.openshift.io/v1/users/~`

        fastify.log.debug({ userInfoUrl }, 'Fetching user info from K8s API')

        const userInfoResponse = await fetch(userInfoUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })

        if (!userInfoResponse.ok) {
          const errorText = await userInfoResponse.text()
          fastify.log.error(
            { status: userInfoResponse.status, body: errorText },
            'User info fetch failed'
          )
          throw new Error(`Failed to fetch user info: ${userInfoResponse.status}`)
        }

        const userInfo = (await userInfoResponse.json()) as OpenShiftUserInfo

        fastify.log.debug(
          { username: userInfo.metadata.name, groups: userInfo.groups },
          'User info retrieved'
        )

        // Resolve user roles via Kubernetes RBAC (SubjectAccessReview)
        const roles = await resolveUserRolesViaRbac(userInfo.metadata.name, userInfo.groups || [])

        if (roles.length === 0) {
          fastify.log.warn(
            { username: userInfo.metadata.name, groups: userInfo.groups },
            'User has no matching role bindings for access'
          )
          return reply.redirect(
            `${config.frontendUrl}/?auth_error=${encodeURIComponent('Access denied: You are not bound to sardeenz-admin or sardeenz-admin-readonly roles. Contact your administrator to create a RoleBinding.')}`
          )
        }

        // Create our own JWT
        const payload: JWTSignPayload = {
          sub: userInfo.metadata.uid,
          username: userInfo.metadata.name,
          roles,
          authMode: 'oauth',
        }

        const token = fastify.jwt.sign(payload)

        fastify.log.info(
          { username: userInfo.metadata.name, roles },
          'User authenticated successfully via OAuth'
        )

        // Redirect to frontend with token in URL fragment (more secure than query param)
        return reply.redirect(`${config.frontendUrl}/#token=${token}`)
      } catch (error) {
        fastify.log.error(error, 'OAuth callback error')
        const message = error instanceof Error ? error.message : 'Authentication failed'
        return reply.redirect(`${config.frontendUrl}/?auth_error=${encodeURIComponent(message)}`)
      }
    }
  )

  /**
   * POST /api/auth/logout
   * Logout endpoint - acknowledges logout request
   */
  fastify.post<{ Reply: LogoutResponse }>(
    '/api/auth/logout',
    {
      schema: {
        tags: ['auth'],
        description: 'Logout (client should clear token)',
        response: {
          200: LogoutResponseSchema,
        },
      },
    },
    async (): Promise<LogoutResponse> => {
      // Server-side logout is a no-op for JWT
      // Client is responsible for clearing the token
      return { status: 'success' }
    }
  )

  /**
   * GET /api/auth/me
   * Returns current user information from JWT
   */
  fastify.get<{ Reply: CurrentUserResponse | { error: { message: string; type: string } } }>(
    '/api/auth/me',
    {
      schema: {
        tags: ['auth'],
        description: 'Get current user information',
        response: {
          200: CurrentUserResponseSchema,
          401: ErrorResponseSchema,
        },
      },
      preHandler: [fastify.authenticate],
    },
    async (request, reply): Promise<CurrentUserResponse> => {
      // If auth is disabled, return a default user
      if (config.authMode === 'none') {
        const response: CurrentUserResponse = {
          username: 'anonymous',
          roles: ['admin'],
          authMode: 'simple',
        }
        // Include inference API key if configured
        if (config.inferenceApiKey) {
          response.inferenceApiKey = config.inferenceApiKey
        }
        return response
      }

      const user = request.user
      if (!user) {
        reply.code(401).send({
          error: {
            message: 'Not authenticated',
            type: 'authentication_error',
          },
        })
        return reply
      }

      const response: CurrentUserResponse = {
        username: user.username,
        email: user.email,
        roles: user.roles,
        authMode: user.authMode,
      }
      // Include inference API key if configured
      if (config.inferenceApiKey) {
        response.inferenceApiKey = config.inferenceApiKey
      }
      return response
    }
  )
}
