import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import { getBenchmarkStore } from '../../stores/benchmark-store.js'

export default async function clusterBenchmarkRoutes(fastify: FastifyInstance) {
  // ---------------------------------------------------------------------------
  // T078: GET /api/cluster/benchmarks/export — export benchmark runs as JSON
  // ---------------------------------------------------------------------------
  fastify.get(
    '/api/cluster/benchmarks/export',
    {
      schema: {
        tags: ['cluster', 'benchmarks'],
        description: 'Export all benchmark runs with details for backup/migration',
        response: {
          200: Type.Object({
            runs: Type.Array(Type.Any()),
            exportedAt: Type.String(),
          }),
        },
      },
    },
    async () => {
      const store = getBenchmarkStore()
      const { runs } = await store.listRuns({ limit: 10000 })

      const runsWithDetails = (await Promise.all(runs.map((run) => store.getRunWithDetails(run.id)))).filter(Boolean)

      return {
        runs: runsWithDetails,
        exportedAt: new Date().toISOString(),
      }
    }
  )

  // ---------------------------------------------------------------------------
  // T078: POST /api/cluster/benchmarks/import — import benchmark runs from backup
  // ---------------------------------------------------------------------------
  fastify.post<{
    Body: {
      runs: Array<Record<string, unknown>>
    }
  }>(
    '/api/cluster/benchmarks/import',
    {
      schema: {
        tags: ['cluster', 'benchmarks'],
        description: 'Import benchmark runs from a backup file',
        body: Type.Object({
          runs: Type.Array(Type.Any()),
        }),
        response: {
          200: Type.Object({
            imported: Type.Integer(),
            skipped: Type.Integer(),
          }),
        },
      },
    },
    async (request) => {
      const store = getBenchmarkStore()
      const { runs } = request.body
      let imported = 0
      let skipped = 0

      for (const run of runs) {
        const r = run as {
          id?: string
          name?: string
          status?: string
          mode?: string
          kvcachedEnabled?: boolean
          configJson?: string
          scenarios?: Array<{
            instanceId?: string
            routingMode?: string
            modelPath?: string
            modelName?: string
            inputTokens?: number
            outputTokens?: number
            concurrency?: number
            warmupRequests?: number
            totalRequests?: number
            slaThresholdMs?: number
            metrics?: Record<string, unknown>
          }>
        }

        if (!r.id || !r.configJson) {
          skipped++
          continue
        }

        // Check if run already exists
        const existing = await store.getRun(r.id)
        if (existing) {
          skipped++
          continue
        }

        try {
          const benchmarkConfig = JSON.parse(r.configJson) as {
            name?: string
            mode: string
            scenarios: Array<Record<string, unknown>>
          }

          const createdRun = await store.createRun(benchmarkConfig as never, r.kvcachedEnabled ?? false)

          // Import scenarios if present
          if (r.scenarios) {
            for (const scenario of r.scenarios) {
              if (!scenario.modelPath || !scenario.modelName) continue

              await store.createScenario({
                runId: createdRun.id,
                instanceId: scenario.instanceId ?? '',
                routingMode: (scenario.routingMode ?? 'direct') as 'direct' | 'proxy',
                modelPath: scenario.modelPath,
                modelName: scenario.modelName,
                inputTokens: scenario.inputTokens ?? 0,
                outputTokens: scenario.outputTokens ?? 0,
                concurrency: scenario.concurrency ?? 1,
                warmupRequests: scenario.warmupRequests ?? 0,
                totalRequests: scenario.totalRequests ?? 0,
                slaThresholdMs: scenario.slaThresholdMs,
              })
            }
          }

          imported++
        } catch {
          skipped++
        }
      }

      return { imported, skipped }
    }
  )
}
