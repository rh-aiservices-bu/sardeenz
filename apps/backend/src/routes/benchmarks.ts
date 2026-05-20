/**
 * Benchmark API Routes
 *
 * CRUD operations for benchmark runs and results.
 */

import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  CreateBenchmarkRequestSchema,
  ListBenchmarksResponseSchema,
  GetBenchmarkResponseSchema,
  DeleteBenchmarkResponseSchema,
  ListBenchmarkResultsResponseSchema,
  ErrorResponseSchema,
  type CreateBenchmarkRequestType,
  BenchmarkStatus,
} from '@sardeenz/types'
import { getBenchmarkStore } from '../stores/benchmark-store.js'
import { modelStore } from '../stores/model-store.js'
import { peerStore } from '../stores/peer-store.js'
import { config } from '../config.js'
import { startBenchmark, cancelBenchmark } from '../services/benchmark-runner.js'
import { eventBus, type SSEConnection } from '../services/event-bus.js'
import { randomUUID } from 'node:crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { SSEEvent } from '@sardeenz/types'

// Query params schemas
const ListBenchmarksQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
  status: Type.Optional(Type.String()),
})

const ListResultsQuerySchema = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 100 })),
})

const BenchmarkIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

const ScenarioResultsParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  sid: Type.String({ format: 'uuid' }),
})

import type { PeerModelEntry, PeerInfo } from '@sardeenz/types'

/** Look up a model by instanceId across all healthy remote peers. */
function findModelInCluster(instanceId: string): { entry: PeerModelEntry; peer: PeerInfo } | null {
  for (const peer of peerStore.getHealthyPeers()) {
    const entry = peer.models.find((m) => m.instanceId === instanceId)
    if (entry) return { entry, peer }
  }
  return null
}

export default async function benchmarkRoutes(fastify: FastifyInstance) {
  const store = getBenchmarkStore()

  /**
   * POST /api/benchmarks - Create a new benchmark run
   * Note: In Phase 1, this only creates the run. Execution is added in Phase 3.
   */
  fastify.post<{ Body: CreateBenchmarkRequestType }>(
    '/api/benchmarks',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'Create and start a new benchmark run',
        body: CreateBenchmarkRequestSchema,
        response: {
          201: GetBenchmarkResponseSchema,
          400: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      try {
        const { name, mode, scenarios } = request.body

        // Validate all instance IDs exist (locally or on a healthy remote peer)
        for (const scenario of scenarios) {
          const local = modelStore.get(scenario.instanceId)
          if (local) {
            if (local.status !== 'running') {
              return reply.status(400).send({
                error: {
                  message: `Model instance is not running: ${scenario.instanceId} (status: ${local.status})`,
                  type: 'validation_error',
                },
              })
            }
          } else {
            const remote = findModelInCluster(scenario.instanceId)
            if (!remote) {
              return reply.status(400).send({
                error: {
                  message: `Model instance not found: ${scenario.instanceId}`,
                  type: 'validation_error',
                },
              })
            }
            if (remote.entry.status !== 'running') {
              return reply.status(400).send({
                error: {
                  message: `Model instance is not running: ${scenario.instanceId} (status: ${remote.entry.status})`,
                  type: 'validation_error',
                },
              })
            }
            if (scenario.routingMode === 'direct') {
              return reply.status(400).send({
                error: {
                  message: `Direct routing mode is not supported for models on remote pods. Use proxy mode for ${scenario.instanceId}.`,
                  type: 'validation_error',
                },
              })
            }
          }
        }

        // Detect if kvcached is enabled
        const kvcachedEnabled = config.enableKvcached ?? false

        // Create the benchmark run
        const benchmarkConfig = { name, mode, scenarios, kvcachedEnabled }
        const run = await store.createRun(benchmarkConfig, kvcachedEnabled)

        // Create scenarios
        for (const scenarioConfig of scenarios) {
          const local = modelStore.get(scenarioConfig.instanceId)
          const remote = local ? null : findModelInCluster(scenarioConfig.instanceId)
          const modelPath = local ? local.modelPath : remote!.entry.modelPath
          const modelName = local ? local.modelName : remote!.entry.modelName
          await store.createScenario({
            runId: run.id,
            instanceId: scenarioConfig.instanceId,
            routingMode: scenarioConfig.routingMode || 'direct',
            modelPath,
            modelName,
            inputTokens: scenarioConfig.inputTokens,
            outputTokens: scenarioConfig.outputTokens,
            concurrency: scenarioConfig.concurrency,
            warmupRequests: scenarioConfig.warmupRequests,
            totalRequests: scenarioConfig.totalRequests,
            slaThresholdMs: scenarioConfig.slaThresholdMs,
          })
        }

        // Get the full run with details
        const runWithDetails = (await store.getRunWithDetails(run.id))!

        // Start the benchmark execution asynchronously
        startBenchmark(run.id).catch((err) => {
          fastify.log.error({ err, runId: run.id }, 'Benchmark execution failed')
        })

        reply.status(201)
        return {
          benchmark: {
            id: runWithDetails.id,
            name: runWithDetails.name,
            status: runWithDetails.status,
            mode: runWithDetails.mode,
            kvcached_enabled: runWithDetails.kvcachedEnabled,
            created_at: runWithDetails.createdAt,
            started_at: runWithDetails.startedAt,
            completed_at: runWithDetails.completedAt,
            error_message: runWithDetails.errorMessage,
            total_requests: runWithDetails.totalRequests,
            successful_requests: runWithDetails.successfulRequests,
            failed_requests: runWithDetails.failedRequests,
            duration_seconds: runWithDetails.durationSeconds,
            scenarios: runWithDetails.scenarios.map((s) => ({
              id: s.id,
              run_id: s.runId,
              instance_id: s.instanceId,
              routing_mode: s.routingMode,
              model_path: s.modelPath,
              model_name: s.modelName,
              input_tokens: s.inputTokens,
              output_tokens: s.outputTokens,
              concurrency: s.concurrency,
              warmup_requests: s.warmupRequests,
              total_requests: s.totalRequests,
              sla_threshold_ms: s.slaThresholdMs,
              status: s.status,
              started_at: s.startedAt,
              completed_at: s.completedAt,
              error_message: s.errorMessage,
              metrics: s.metrics
                ? {
                    scenario_id: s.metrics.scenarioId,
                    ttft_min: s.metrics.ttftMin,
                    ttft_max: s.metrics.ttftMax,
                    ttft_avg: s.metrics.ttftAvg,
                    ttft_p50: s.metrics.ttftP50,
                    ttft_p90: s.metrics.ttftP90,
                    ttft_p95: s.metrics.ttftP95,
                    ttft_p99: s.metrics.ttftP99,
                    tps_min: s.metrics.tpsMin,
                    tps_max: s.metrics.tpsMax,
                    tps_avg: s.metrics.tpsAvg,
                    tps_p50: s.metrics.tpsP50,
                    tps_p90: s.metrics.tpsP90,
                    tps_p95: s.metrics.tpsP95,
                    tps_p99: s.metrics.tpsP99,
                    e2e_min: s.metrics.e2eMin,
                    e2e_max: s.metrics.e2eMax,
                    e2e_avg: s.metrics.e2eAvg,
                    e2e_p50: s.metrics.e2eP50,
                    e2e_p90: s.metrics.e2eP90,
                    e2e_p95: s.metrics.e2eP95,
                    e2e_p99: s.metrics.e2eP99,
                    goodput_count: s.metrics.goodputCount,
                    goodput_percent: s.metrics.goodputPercent,
                    sla_threshold_ms: s.metrics.slaThresholdMs,
                    kvcache_used_avg_gb: s.metrics.kvcacheUsedAvgGb,
                    kvcache_peak_gb: s.metrics.kvcachePeakGb,
                    gpu_memory_peak_gb: s.metrics.gpuMemoryPeakGb,
                    total_requests: s.metrics.totalRequests,
                    successful_requests: s.metrics.successfulRequests,
                    failed_requests: s.metrics.failedRequests,
                    requests_per_second: s.metrics.requestsPerSecond,
                    tokens_per_second_total: s.metrics.tokenPerSecondTotal,
                  }
                : undefined,
            })),
          },
        }
      } catch (err) {
        fastify.log.error({ err, body: request.body }, 'Benchmark creation failed')
        throw err
      }
    }
  )

  /**
   * GET /api/benchmarks - List benchmark runs
   */
  fastify.get<{ Querystring: { page?: number; limit?: number; status?: string } }>(
    '/api/benchmarks',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'List benchmark runs with pagination and optional filtering',
        querystring: ListBenchmarksQuerySchema,
        response: {
          200: ListBenchmarksResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request) => {
      const { page = 1, limit = 20, status } = request.query

      const { runs, total } = await store.listRuns({
        page,
        limit,
        status: status as BenchmarkStatus | undefined,
      })

      return {
        benchmarks: runs.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          mode: r.mode,
          kvcached_enabled: r.kvcachedEnabled,
          created_at: r.createdAt,
          started_at: r.startedAt,
          completed_at: r.completedAt,
          error_message: r.errorMessage,
          total_requests: r.totalRequests,
          successful_requests: r.successfulRequests,
          failed_requests: r.failedRequests,
          duration_seconds: r.durationSeconds,
        })),
        total,
        page,
        limit,
      }
    }
  )

  /**
   * GET /api/benchmarks/:id - Get a benchmark run with details
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/benchmarks/:id',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'Get a benchmark run with all scenarios and metrics',
        params: BenchmarkIdParamsSchema,
        response: {
          200: GetBenchmarkResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { id } = request.params
      const run = await store.getRunWithDetails(id)

      if (!run) {
        return reply.status(404).send({
          error: {
            message: `Benchmark run not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return {
        benchmark: {
          id: run.id,
          name: run.name,
          status: run.status,
          mode: run.mode,
          kvcached_enabled: run.kvcachedEnabled,
          created_at: run.createdAt,
          started_at: run.startedAt,
          completed_at: run.completedAt,
          error_message: run.errorMessage,
          total_requests: run.totalRequests,
          successful_requests: run.successfulRequests,
          failed_requests: run.failedRequests,
          duration_seconds: run.durationSeconds,
          scenarios: run.scenarios.map((s) => ({
            id: s.id,
            run_id: s.runId,
            instance_id: s.instanceId,
            routing_mode: s.routingMode,
            model_path: s.modelPath,
            model_name: s.modelName,
            input_tokens: s.inputTokens,
            output_tokens: s.outputTokens,
            concurrency: s.concurrency,
            warmup_requests: s.warmupRequests,
            total_requests: s.totalRequests,
            sla_threshold_ms: s.slaThresholdMs,
            status: s.status,
            started_at: s.startedAt,
            completed_at: s.completedAt,
            error_message: s.errorMessage,
            metrics: s.metrics
              ? {
                  scenario_id: s.metrics.scenarioId,
                  ttft_min: s.metrics.ttftMin,
                  ttft_max: s.metrics.ttftMax,
                  ttft_avg: s.metrics.ttftAvg,
                  ttft_p50: s.metrics.ttftP50,
                  ttft_p90: s.metrics.ttftP90,
                  ttft_p95: s.metrics.ttftP95,
                  ttft_p99: s.metrics.ttftP99,
                  tps_min: s.metrics.tpsMin,
                  tps_max: s.metrics.tpsMax,
                  tps_avg: s.metrics.tpsAvg,
                  tps_p50: s.metrics.tpsP50,
                  tps_p90: s.metrics.tpsP90,
                  tps_p95: s.metrics.tpsP95,
                  tps_p99: s.metrics.tpsP99,
                  e2e_min: s.metrics.e2eMin,
                  e2e_max: s.metrics.e2eMax,
                  e2e_avg: s.metrics.e2eAvg,
                  e2e_p50: s.metrics.e2eP50,
                  e2e_p90: s.metrics.e2eP90,
                  e2e_p95: s.metrics.e2eP95,
                  e2e_p99: s.metrics.e2eP99,
                  goodput_count: s.metrics.goodputCount,
                  goodput_percent: s.metrics.goodputPercent,
                  sla_threshold_ms: s.metrics.slaThresholdMs,
                  kvcache_used_avg_gb: s.metrics.kvcacheUsedAvgGb,
                  kvcache_peak_gb: s.metrics.kvcachePeakGb,
                  gpu_memory_peak_gb: s.metrics.gpuMemoryPeakGb,
                  total_requests: s.metrics.totalRequests,
                  successful_requests: s.metrics.successfulRequests,
                  failed_requests: s.metrics.failedRequests,
                  requests_per_second: s.metrics.requestsPerSecond,
                  tokens_per_second_total: s.metrics.tokenPerSecondTotal,
                }
              : undefined,
          })),
        },
      }
    }
  )

  /**
   * DELETE /api/benchmarks/:id - Delete a benchmark run
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/benchmarks/:id',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'Delete a benchmark run and all related data',
        params: BenchmarkIdParamsSchema,
        response: {
          200: DeleteBenchmarkResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin'),
    },
    async (request, reply) => {
      const { id } = request.params
      const run = await store.getRun(id)

      if (!run) {
        return reply.status(404).send({
          error: {
            message: `Benchmark run not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      // If running, cancel it first
      if (run.status === 'running') {
        await cancelBenchmark(id)
      }

      await store.deleteRun(id)

      return {
        status: 'success' as const,
        id,
        deleted_at: new Date().toISOString(),
      }
    }
  )

  /**
   * GET /api/benchmarks/:id/scenarios/:sid/results - Get paginated results for a scenario
   */
  fastify.get<{
    Params: { id: string; sid: string }
    Querystring: { page?: number; limit?: number }
  }>(
    '/api/benchmarks/:id/scenarios/:sid/results',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'Get paginated individual request results for a scenario',
        params: ScenarioResultsParamsSchema,
        querystring: ListResultsQuerySchema,
        response: {
          200: ListBenchmarkResultsResponseSchema,
          404: ErrorResponseSchema,
        },
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { id, sid } = request.params
      const { page = 1, limit = 100 } = request.query

      // Verify run exists
      const run = await store.getRun(id)
      if (!run) {
        return reply.status(404).send({
          error: {
            message: `Benchmark run not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      const { results, total } = await store.getResults(sid, { page, limit })

      return {
        results: results.map((r) => ({
          id: r.id,
          scenario_id: r.scenarioId,
          request_sequence: r.requestSequence,
          is_warmup: r.isWarmup,
          ttft_ms: r.ttftMs,
          total_latency_ms: r.totalLatencyMs,
          prompt_tokens: r.promptTokens,
          completion_tokens: r.completionTokens,
          tokens_per_second: r.tokensPerSecond,
          success: r.success,
          error_message: r.errorMessage,
          http_status: r.httpStatus,
          executed_at: r.executedAt,
        })),
        total,
        page,
        limit,
      }
    }
  )

  /**
   * POST /api/benchmarks/:id/export - Export benchmark results
   */
  fastify.post<{
    Params: { id: string }
    Body: { format?: 'csv' | 'json'; include_warmup?: boolean }
  }>(
    '/api/benchmarks/:id/export',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'Export benchmark results as CSV or JSON',
        params: BenchmarkIdParamsSchema,
        body: Type.Object({
          format: Type.Optional(
            Type.Union([Type.Literal('csv'), Type.Literal('json')], { default: 'csv' })
          ),
          include_warmup: Type.Optional(Type.Boolean({ default: false })),
        }),
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request, reply) => {
      const { id } = request.params
      const { format = 'csv', include_warmup = false } = request.body

      const run = await store.getRunWithDetails(id)
      if (!run) {
        return reply.status(404).send({
          error: {
            message: `Benchmark run not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      const results = await store.getRunResults(id, !include_warmup)
      const filename = `benchmark-${run.name || run.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}`

      if (format === 'json') {
        reply.header('Content-Type', 'application/json')
        reply.header('Content-Disposition', `attachment; filename="${filename}.json"`)

        return {
          benchmark: {
            id: run.id,
            name: run.name,
            status: run.status,
            mode: run.mode,
            created_at: run.createdAt,
            completed_at: run.completedAt,
            duration_seconds: run.durationSeconds,
          },
          scenarios: run.scenarios.map((s) => ({
            id: s.id,
            model_path: s.modelPath,
            model_name: s.modelName,
            input_tokens: s.inputTokens,
            output_tokens: s.outputTokens,
            concurrency: s.concurrency,
            total_requests: s.totalRequests,
            metrics: s.metrics
              ? {
                  ttft_p50: s.metrics.ttftP50,
                  ttft_p90: s.metrics.ttftP90,
                  ttft_p99: s.metrics.ttftP99,
                  tps_p50: s.metrics.tpsP50,
                  tps_p90: s.metrics.tpsP90,
                  tps_p99: s.metrics.tpsP99,
                  goodput_percent: s.metrics.goodputPercent,
                  requests_per_second: s.metrics.requestsPerSecond,
                }
              : null,
          })),
          results: results.map((r) => ({
            model_path: r.modelPath,
            model_name: r.modelName,
            request_sequence: r.requestSequence,
            ttft_ms: r.ttftMs,
            total_latency_ms: r.totalLatencyMs,
            prompt_tokens: r.promptTokens,
            completion_tokens: r.completionTokens,
            tokens_per_second: r.tokensPerSecond,
            success: r.success,
            error_message: r.errorMessage,
            executed_at: r.executedAt,
          })),
        }
      }

      // CSV format
      reply.header('Content-Type', 'text/csv')
      reply.header('Content-Disposition', `attachment; filename="${filename}.csv"`)

      const headers = [
        'model_path',
        'model_name',
        'request_sequence',
        'ttft_ms',
        'total_latency_ms',
        'prompt_tokens',
        'completion_tokens',
        'tokens_per_second',
        'success',
        'error_message',
        'executed_at',
      ]

      const csvRows = [headers.join(',')]
      for (const r of results) {
        const row = [
          `"${r.modelPath}"`,
          `"${r.modelName || ''}"`,
          r.requestSequence,
          r.ttftMs ?? '',
          r.totalLatencyMs,
          r.promptTokens ?? '',
          r.completionTokens ?? '',
          r.tokensPerSecond ?? '',
          r.success,
          `"${(r.errorMessage || '').replace(/"/g, '""')}"`,
          r.executedAt,
        ]
        csvRows.push(row.join(','))
      }

      return csvRows.join('\n')
    }
  )

  /**
   * GET /api/benchmarks/:id/events - SSE stream for benchmark progress
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/benchmarks/:id/events',
    {
      schema: {
        tags: ['benchmarks'],
        description: 'Subscribe to real-time benchmark progress events (SSE)',
        params: BenchmarkIdParamsSchema,
      },
      onRequest: fastify.requireRole('admin-readonly'),
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const { id } = request.params

      // Verify run exists
      const run = await store.getRun(id)
      if (!run) {
        return reply.status(404).send({
          error: {
            message: `Benchmark run not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      // Set up SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': '*',
      })

      const connectionId = randomUUID()
      fastify.log.info({ connectionId, benchmarkId: id }, 'Benchmark SSE connection opened')

      // Helper to send SSE event
      const sendEvent = (event: SSEEvent): void => {
        // Only send progress events for this benchmark
        if (event.eventType !== 'progress') return
        if (event.instanceId !== id) return

        try {
          const data = JSON.stringify(event)
          reply.raw.write(`id: ${event.id}\n`)
          reply.raw.write(`event: progress\n`)
          reply.raw.write(`data: ${data}\n\n`)
        } catch (err) {
          fastify.log.debug({ connectionId, err }, 'Failed to write SSE event')
        }
      }

      // Create SSE connection object
      const connection: SSEConnection = {
        id: connectionId,
        send: sendEvent,
        filters: ['progress'],
      }

      // Send current status
      const currentRun = await store.getRun(id)
      if (currentRun) {
        const statusMessage =
          currentRun.status === 'pending'
            ? 'Benchmark pending'
            : currentRun.status === 'running'
              ? 'Benchmark in progress'
              : currentRun.status === 'completed'
                ? 'Benchmark completed'
                : currentRun.status === 'cancelled'
                  ? 'Benchmark cancelled'
                  : 'Benchmark failed'

        // Cast through unknown to SSEEvent since benchmark progress uses different data shape than model progress
        sendEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          instanceId: id,
          eventType: 'progress',
          data: {
            runId: id,
            phase:
              currentRun.status === 'completed'
                ? 'completed'
                : currentRun.status === 'failed'
                  ? 'failed'
                  : 'starting',
            message: statusMessage,
          },
        } as unknown as SSEEvent)
      }

      // Subscribe to future events
      eventBus.subscribe(id, connection)

      // Heartbeat every 30 seconds
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(': heartbeat\n\n')
        } catch {
          // Connection closed
        }
      }, 30000)

      // Clean up on connection close
      request.raw.on('close', () => {
        clearInterval(heartbeat)
        eventBus.unsubscribe(id, connection)
        fastify.log.info({ connectionId, benchmarkId: id }, 'Benchmark SSE connection closed')
      })
    }
  )
}
