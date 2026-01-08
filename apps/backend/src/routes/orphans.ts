import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { OrphanDetector } from '../services/orphan-detector.js'
import { BadRequestError, NotFoundError } from '../utils/errors.js'

// Response schemas for orphan endpoints
const OrphanProcessSchema = Type.Object({
  pid: Type.Number(),
  command: Type.String(),
  args: Type.Array(Type.String()),
  port: Type.Optional(Type.Number()),
  model_path: Type.Optional(Type.String()),
  started_at: Type.Optional(Type.String()),
})

const OrphanScanResponseSchema = Type.Object({
  orphans: Type.Array(OrphanProcessSchema),
  tracked_pids: Type.Array(Type.Number()),
  scanned_at: Type.String(),
})

const KillOrphanResponseSchema = Type.Object({
  success: Type.Boolean(),
  message: Type.String(),
})

const KillAllOrphansResponseSchema = Type.Object({
  killed: Type.Array(Type.Number()),
  failed: Type.Array(
    Type.Object({
      pid: Type.Number(),
      error: Type.String(),
    })
  ),
})

const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    message: Type.String(),
    type: Type.String(),
    code: Type.Optional(Type.String()),
  }),
})

export default async function orphansRoutes(fastify: FastifyInstance) {
  const orphanDetector = new OrphanDetector(fastify.log)

  /**
   * GET /api/orphans - Scan for orphan vLLM processes
   */
  fastify.get(
    '/api/orphans',
    {
      schema: {
        tags: ['orphans'],
        description: 'Scan for orphan vLLM processes not tracked by the controller',
        response: {
          200: OrphanScanResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async () => {
      const result = await orphanDetector.scan()

      return {
        orphans: result.orphans.map((o) => ({
          pid: o.pid,
          command: o.command,
          args: o.args,
          port: o.port,
          model_path: o.modelPath,
          started_at: o.startedAt?.toISOString(),
        })),
        tracked_pids: result.trackedPids,
        scanned_at: result.scannedAt.toISOString(),
      }
    }
  )

  /**
   * DELETE /api/orphans/:pid - Kill a specific orphan process
   */
  fastify.delete<{ Params: { pid: string } }>(
    '/api/orphans/:pid',
    {
      schema: {
        tags: ['orphans'],
        description: 'Kill a specific orphan vLLM process by PID',
        params: Type.Object({
          pid: Type.String({ pattern: '^[0-9]+$' }),
        }),
        response: {
          200: KillOrphanResponseSchema,
          400: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request) => {
      const pid = parseInt(request.params.pid, 10)

      if (isNaN(pid) || pid <= 0) {
        throw new BadRequestError('Invalid PID')
      }

      const result = await orphanDetector.killOrphan(pid)

      if (!result.success) {
        if (result.message.includes('not a vLLM process')) {
          throw new NotFoundError(result.message)
        }
        throw new BadRequestError(result.message)
      }

      return result
    }
  )

  /**
   * POST /api/orphans/kill-all - Kill all orphan processes
   */
  fastify.post(
    '/api/orphans/kill-all',
    {
      schema: {
        tags: ['orphans'],
        description: 'Kill all orphan vLLM processes',
        response: {
          200: KillAllOrphansResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async () => {
      return orphanDetector.killAllOrphans()
    }
  )
}
