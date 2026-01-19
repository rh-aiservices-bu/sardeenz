import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { promises as fs } from 'fs'
import path from 'path'
import {
  ListLocalModelsResponseSchema,
  LocalModelsStatusResponseSchema,
  ErrorResponseSchema,
} from '@sardeenz/types'
import { config } from '../config.js'

/**
 * Validate that a path is within the allowed base path (prevent path traversal)
 */
function isPathWithinBase(basePath: string, targetPath: string): boolean {
  const resolvedBase = path.resolve(basePath)
  const resolvedTarget = path.resolve(targetPath)
  return resolvedTarget.startsWith(resolvedBase + path.sep) || resolvedTarget === resolvedBase
}

export default async function localModelsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/local-models/status - Check if local models feature is configured
   */
  fastify.get(
    '/api/local-models/status',
    {
      schema: {
        tags: ['local-models'],
        description: 'Check if local models feature is configured',
        response: {
          200: LocalModelsStatusResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async () => {
      return {
        enabled: !!config.localModelsPath,
        path: config.localModelsPath || undefined,
      }
    }
  )

  /**
   * GET /api/local-models - List available local models (with optional subpath browsing)
   */
  fastify.get<{ Querystring: { subpath?: string } }>(
    '/api/local-models',
    {
      schema: {
        tags: ['local-models'],
        description:
          'List available local models from configured path. Use subpath query param to browse subdirectories.',
        querystring: Type.Object({
          subpath: Type.Optional(
            Type.String({
              description: 'Relative subpath to browse within the base models directory',
            })
          ),
        }),
        response: {
          200: ListLocalModelsResponseSchema,
          400: ErrorResponseSchema,
          500: ErrorResponseSchema,
          503: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      if (!config.localModelsPath) {
        return reply.status(503).send({
          error: {
            message:
              'Local models path not configured. Set LOCAL_MODELS_PATH environment variable.',
            type: 'service_unavailable',
          },
        })
      }

      try {
        const basePath = config.localModelsPath
        const { subpath } = request.query

        // Calculate the target path (base + optional subpath)
        const targetPath = subpath ? path.join(basePath, subpath) : basePath

        // Security check: ensure target path is within base path
        if (!isPathWithinBase(basePath, targetPath)) {
          return reply.status(400).send({
            error: {
              message: 'Invalid subpath: path traversal not allowed',
              type: 'bad_request',
            },
          })
        }

        const entries = await fs.readdir(targetPath, { withFileTypes: true })

        const models = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
              const modelPath = path.join(targetPath, entry.name)
              const configPath = path.join(modelPath, 'config.json')

              let hasConfig = false
              let stat = null

              try {
                await fs.access(configPath)
                hasConfig = true
              } catch {
                // No config.json - still include the directory for browsing
              }

              try {
                stat = await fs.stat(modelPath)
              } catch {
                // Ignore stat errors
              }

              return {
                name: entry.name,
                path: modelPath,
                modified_at: stat?.mtime?.toISOString(),
                has_config: hasConfig,
              }
            })
        )

        // Return all directories (not just those with config.json)
        // has_config indicates if it's a valid HuggingFace model format
        return {
          models,
          total: models.length,
          base_path: targetPath,
        }
      } catch (err) {
        fastify.log.error({ err, path: config.localModelsPath }, 'Failed to list local models')
        return reply.status(500).send({
          error: {
            message: `Failed to access local models path: ${err instanceof Error ? err.message : 'Unknown error'}`,
            type: 'internal_error',
          },
        })
      }
    }
  )
}
