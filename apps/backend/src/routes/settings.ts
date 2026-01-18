import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  SettingsResponseSchema,
  UpdateSettingsRequestSchema,
  TestHfTokenRequestSchema,
  TestHfTokenResponseSchema,
  ErrorResponseSchema,
  type UpdateSettingsRequestType,
  type TestHfTokenRequestType,
} from '@sardeenz/types'
import { runtimeSettings } from '../stores/runtime-settings.js'

export default async function settingsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/settings - Get current settings
   * Note: admin-readonly users see a fake token for security
   */
  fastify.get(
    '/api/settings',
    {
      schema: {
        tags: ['settings'],
        description: 'Get current application settings (token is masked)',
        response: {
          200: SettingsResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request: FastifyRequest) => {
      const settings = runtimeSettings.getSettingsResponse()

      // Check if user is admin-readonly (not admin) - mask the real token
      const userRoles = request.user?.roles || []
      const isReadonlyOnly = userRoles.includes('admin-readonly') && !userRoles.includes('admin')

      if (isReadonlyOnly && settings.hf_token) {
        return {
          hf_token: 'hf_demo_token',
          hf_token_source: settings.hf_token_source,
        }
      }

      return settings
    }
  )

  /**
   * PUT /api/settings - Update settings
   */
  fastify.put<{ Body: UpdateSettingsRequestType }>(
    '/api/settings',
    {
      schema: {
        tags: ['settings'],
        description: 'Update application settings',
        body: UpdateSettingsRequestSchema,
        response: {
          200: SettingsResponseSchema,
          400: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request) => {
      const { hf_token } = request.body

      if (hf_token !== undefined) {
        if (hf_token === '') {
          runtimeSettings.clearHfToken()
        } else {
          runtimeSettings.setHfToken(hf_token)
        }
        fastify.log.info('HuggingFace token updated via API')
      }

      return runtimeSettings.getSettingsResponse()
    }
  )

  /**
   * POST /api/settings/hf-token/test - Test HuggingFace token validity
   */
  fastify.post<{ Body: TestHfTokenRequestType }>(
    '/api/settings/hf-token/test',
    {
      schema: {
        tags: ['settings'],
        description: 'Test if a HuggingFace token is valid',
        body: TestHfTokenRequestSchema,
        response: {
          200: TestHfTokenResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request) => {
      const { token } = request.body

      try {
        const response = await fetch('https://huggingface.co/api/whoami-v2', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: AbortSignal.timeout(10000),
        })

        if (!response.ok) {
          const errorText = await response.text()
          return {
            valid: false,
            error:
              response.status === 401
                ? 'Invalid or expired token'
                : `HuggingFace API error: ${errorText}`,
          }
        }

        const data = (await response.json()) as {
          accessToken?: { displayName?: string }
          name?: string
        }

        return {
          valid: true,
          username: data.accessToken?.displayName || data.name,
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        fastify.log.error({ err }, 'Failed to test HuggingFace token')

        return {
          valid: false,
          error: message.includes('timeout')
            ? 'Connection timed out'
            : `Failed to connect: ${message}`,
        }
      }
    }
  )
}
