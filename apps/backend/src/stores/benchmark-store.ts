/**
 * Benchmark Store
 *
 * SQLite persistence layer for benchmark runs, scenarios, results, and metrics.
 */

import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { getDb } from '../db/index.js'
import type {
  BenchmarkRun,
  BenchmarkScenario,
  BenchmarkResult,
  BenchmarkMetrics,
  BenchmarkConfig,
  BenchmarkStatus,
  BenchmarkMode,
  ScenarioStatus,
  BenchmarkRunWithDetails,
  RoutingMode,
} from '@sardeenz/types'

// Row types for SQLite (snake_case)
interface BenchmarkRunRow {
  id: string
  name: string | null
  status: string
  mode: string
  kvcached_enabled: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  config_json: string
  error_message: string | null
  total_requests: number | null
  successful_requests: number | null
  failed_requests: number | null
  duration_seconds: number | null
}

interface BenchmarkScenarioRow {
  id: string
  run_id: string
  instance_id: string
  routing_mode: string
  model_path: string
  model_name: string
  input_tokens: number
  output_tokens: number
  concurrency: number
  warmup_requests: number
  total_requests: number
  sla_threshold_ms: number | null
  status: string
  started_at: string | null
  completed_at: string | null
  error_message: string | null
}

interface BenchmarkResultRow {
  id: number
  scenario_id: string
  request_sequence: number
  is_warmup: number
  ttft_ms: number | null
  total_latency_ms: number
  prompt_tokens: number | null
  completion_tokens: number | null
  tokens_per_second: number | null
  success: number
  error_message: string | null
  http_status: number | null
  executed_at: string
}

interface BenchmarkMetricsRow {
  scenario_id: string
  ttft_min: number | null
  ttft_max: number | null
  ttft_avg: number | null
  ttft_p50: number | null
  ttft_p90: number | null
  ttft_p95: number | null
  ttft_p99: number | null
  tps_min: number | null
  tps_max: number | null
  tps_avg: number | null
  tps_p50: number | null
  tps_p90: number | null
  tps_p95: number | null
  tps_p99: number | null
  e2e_min: number | null
  e2e_max: number | null
  e2e_avg: number | null
  e2e_p50: number | null
  e2e_p90: number | null
  e2e_p95: number | null
  e2e_p99: number | null
  goodput_count: number | null
  goodput_percent: number | null
  sla_threshold_ms: number | null
  kvcache_used_avg_gb: number | null
  kvcache_peak_gb: number | null
  gpu_memory_peak_gb: number | null
  total_requests: number
  successful_requests: number
  failed_requests: number
  requests_per_second: number | null
  tokens_per_second_total: number | null
}

// Convert row to domain object
function rowToRun(row: BenchmarkRunRow): BenchmarkRun {
  return {
    id: row.id,
    name: row.name ?? undefined,
    status: row.status as BenchmarkStatus,
    mode: row.mode as BenchmarkMode,
    kvcachedEnabled: row.kvcached_enabled === 1,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    configJson: row.config_json,
    errorMessage: row.error_message ?? undefined,
    totalRequests: row.total_requests ?? undefined,
    successfulRequests: row.successful_requests ?? undefined,
    failedRequests: row.failed_requests ?? undefined,
    durationSeconds: row.duration_seconds ?? undefined,
  }
}

function rowToScenario(row: BenchmarkScenarioRow): BenchmarkScenario {
  return {
    id: row.id,
    runId: row.run_id,
    instanceId: row.instance_id,
    routingMode: (row.routing_mode || 'direct') as RoutingMode,
    modelPath: row.model_path,
    modelName: row.model_name,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    concurrency: row.concurrency,
    warmupRequests: row.warmup_requests,
    totalRequests: row.total_requests,
    slaThresholdMs: row.sla_threshold_ms ?? undefined,
    status: row.status as ScenarioStatus,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
  }
}

function rowToResult(row: BenchmarkResultRow): BenchmarkResult {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    requestSequence: row.request_sequence,
    isWarmup: row.is_warmup === 1,
    ttftMs: row.ttft_ms ?? undefined,
    totalLatencyMs: row.total_latency_ms,
    promptTokens: row.prompt_tokens ?? undefined,
    completionTokens: row.completion_tokens ?? undefined,
    tokensPerSecond: row.tokens_per_second ?? undefined,
    success: row.success === 1,
    errorMessage: row.error_message ?? undefined,
    httpStatus: row.http_status ?? undefined,
    executedAt: row.executed_at,
  }
}

function rowToMetrics(row: BenchmarkMetricsRow): BenchmarkMetrics {
  return {
    scenarioId: row.scenario_id,
    ttftMin: row.ttft_min ?? undefined,
    ttftMax: row.ttft_max ?? undefined,
    ttftAvg: row.ttft_avg ?? undefined,
    ttftP50: row.ttft_p50 ?? undefined,
    ttftP90: row.ttft_p90 ?? undefined,
    ttftP95: row.ttft_p95 ?? undefined,
    ttftP99: row.ttft_p99 ?? undefined,
    tpsMin: row.tps_min ?? undefined,
    tpsMax: row.tps_max ?? undefined,
    tpsAvg: row.tps_avg ?? undefined,
    tpsP50: row.tps_p50 ?? undefined,
    tpsP90: row.tps_p90 ?? undefined,
    tpsP95: row.tps_p95 ?? undefined,
    tpsP99: row.tps_p99 ?? undefined,
    e2eMin: row.e2e_min ?? undefined,
    e2eMax: row.e2e_max ?? undefined,
    e2eAvg: row.e2e_avg ?? undefined,
    e2eP50: row.e2e_p50 ?? undefined,
    e2eP90: row.e2e_p90 ?? undefined,
    e2eP95: row.e2e_p95 ?? undefined,
    e2eP99: row.e2e_p99 ?? undefined,
    goodputCount: row.goodput_count ?? undefined,
    goodputPercent: row.goodput_percent ?? undefined,
    slaThresholdMs: row.sla_threshold_ms ?? undefined,
    kvcacheUsedAvgGb: row.kvcache_used_avg_gb ?? undefined,
    kvcachePeakGb: row.kvcache_peak_gb ?? undefined,
    gpuMemoryPeakGb: row.gpu_memory_peak_gb ?? undefined,
    totalRequests: row.total_requests,
    successfulRequests: row.successful_requests,
    failedRequests: row.failed_requests,
    requestsPerSecond: row.requests_per_second ?? undefined,
    tokenPerSecondTotal: row.tokens_per_second_total ?? undefined,
  }
}

export interface ListBenchmarksOptions {
  page?: number
  limit?: number
  status?: BenchmarkStatus
}

export interface CreateScenarioInput {
  runId: string
  instanceId: string
  routingMode: RoutingMode
  modelPath: string
  modelName: string
  inputTokens: number
  outputTokens: number
  concurrency: number
  warmupRequests: number
  totalRequests: number
  slaThresholdMs?: number
}

export interface AddResultInput {
  scenarioId: string
  requestSequence: number
  isWarmup: boolean
  ttftMs?: number
  totalLatencyMs: number
  promptTokens?: number
  completionTokens?: number
  tokensPerSecond?: number
  success: boolean
  errorMessage?: string
  httpStatus?: number
}

class BenchmarkStore {
  private db: Database.Database

  constructor(database?: Database.Database) {
    this.db = database || getDb()
  }

  /**
   * Create a new benchmark run
   */
  createRun(config: BenchmarkConfig, kvcachedEnabled: boolean): BenchmarkRun {
    const id = randomUUID()
    const now = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO benchmark_runs (id, name, status, mode, kvcached_enabled, created_at, config_json)
      VALUES (?, ?, 'pending', ?, ?, ?, ?)
    `)

    stmt.run(id, config.name ?? null, config.mode, kvcachedEnabled ? 1 : 0, now, JSON.stringify(config))

    return {
      id,
      name: config.name,
      status: 'pending' as BenchmarkStatus,
      mode: config.mode,
      kvcachedEnabled,
      createdAt: now,
      configJson: JSON.stringify(config),
    }
  }

  /**
   * Get a benchmark run by ID
   */
  getRun(id: string): BenchmarkRun | null {
    const stmt = this.db.prepare('SELECT * FROM benchmark_runs WHERE id = ?')
    const row = stmt.get(id) as BenchmarkRunRow | undefined
    return row ? rowToRun(row) : null
  }

  /**
   * Get a benchmark run with all scenarios and metrics
   */
  getRunWithDetails(id: string): BenchmarkRunWithDetails | null {
    const run = this.getRun(id)
    if (!run) return null

    const scenariosStmt = this.db.prepare('SELECT * FROM benchmark_scenarios WHERE run_id = ?')
    const scenarioRows = scenariosStmt.all(id) as BenchmarkScenarioRow[]

    const scenarios = scenarioRows.map((row) => {
      const scenario = rowToScenario(row)
      const metricsStmt = this.db.prepare('SELECT * FROM benchmark_metrics WHERE scenario_id = ?')
      const metricsRow = metricsStmt.get(row.id) as BenchmarkMetricsRow | undefined
      return {
        ...scenario,
        metrics: metricsRow ? rowToMetrics(metricsRow) : undefined,
      }
    })

    return { ...run, scenarios }
  }

  /**
   * List benchmark runs with pagination and filtering
   */
  listRuns(options: ListBenchmarksOptions = {}): { runs: BenchmarkRun[]; total: number } {
    const { page = 1, limit = 20, status } = options
    const offset = (page - 1) * limit

    let countSql = 'SELECT COUNT(*) as count FROM benchmark_runs'
    let selectSql = 'SELECT * FROM benchmark_runs'
    const params: (string | number)[] = []

    if (status) {
      countSql += ' WHERE status = ?'
      selectSql += ' WHERE status = ?'
      params.push(status)
    }

    selectSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'

    const countStmt = this.db.prepare(countSql)
    const countResult = (status ? countStmt.get(status) : countStmt.get()) as { count: number }
    const total = countResult.count

    const selectStmt = this.db.prepare(selectSql)
    const rows = selectStmt.all(...params, limit, offset) as BenchmarkRunRow[]

    return {
      runs: rows.map(rowToRun),
      total,
    }
  }

  /**
   * Update benchmark run status
   */
  updateRunStatus(
    id: string,
    status: BenchmarkStatus,
    updates?: {
      startedAt?: string
      completedAt?: string
      errorMessage?: string
      totalRequests?: number
      successfulRequests?: number
      failedRequests?: number
      durationSeconds?: number
    }
  ): void {
    const fields = ['status = ?']
    const values: (string | number | null)[] = [status]

    if (updates?.startedAt !== undefined) {
      fields.push('started_at = ?')
      values.push(updates.startedAt)
    }
    if (updates?.completedAt !== undefined) {
      fields.push('completed_at = ?')
      values.push(updates.completedAt)
    }
    if (updates?.errorMessage !== undefined) {
      fields.push('error_message = ?')
      values.push(updates.errorMessage)
    }
    if (updates?.totalRequests !== undefined) {
      fields.push('total_requests = ?')
      values.push(updates.totalRequests)
    }
    if (updates?.successfulRequests !== undefined) {
      fields.push('successful_requests = ?')
      values.push(updates.successfulRequests)
    }
    if (updates?.failedRequests !== undefined) {
      fields.push('failed_requests = ?')
      values.push(updates.failedRequests)
    }
    if (updates?.durationSeconds !== undefined) {
      fields.push('duration_seconds = ?')
      values.push(updates.durationSeconds)
    }

    const stmt = this.db.prepare(`UPDATE benchmark_runs SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values, id)
  }

  /**
   * Create a scenario for a benchmark run
   */
  createScenario(input: CreateScenarioInput): BenchmarkScenario {
    const id = randomUUID()

    const stmt = this.db.prepare(`
      INSERT INTO benchmark_scenarios (
        id, run_id, instance_id, routing_mode, model_path, model_name,
        input_tokens, output_tokens, concurrency, warmup_requests,
        total_requests, sla_threshold_ms, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `)

    stmt.run(
      id,
      input.runId,
      input.instanceId,
      input.routingMode,
      input.modelPath,
      input.modelName,
      input.inputTokens,
      input.outputTokens,
      input.concurrency,
      input.warmupRequests,
      input.totalRequests,
      input.slaThresholdMs ?? null
    )

    return {
      id,
      runId: input.runId,
      instanceId: input.instanceId,
      routingMode: input.routingMode,
      modelPath: input.modelPath,
      modelName: input.modelName,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      concurrency: input.concurrency,
      warmupRequests: input.warmupRequests,
      totalRequests: input.totalRequests,
      slaThresholdMs: input.slaThresholdMs,
      status: 'pending' as ScenarioStatus,
    }
  }

  /**
   * Update scenario status
   */
  updateScenarioStatus(
    id: string,
    status: ScenarioStatus,
    updates?: {
      startedAt?: string
      completedAt?: string
      errorMessage?: string
    }
  ): void {
    const fields = ['status = ?']
    const values: (string | null)[] = [status]

    if (updates?.startedAt !== undefined) {
      fields.push('started_at = ?')
      values.push(updates.startedAt)
    }
    if (updates?.completedAt !== undefined) {
      fields.push('completed_at = ?')
      values.push(updates.completedAt)
    }
    if (updates?.errorMessage !== undefined) {
      fields.push('error_message = ?')
      values.push(updates.errorMessage)
    }

    const stmt = this.db.prepare(`UPDATE benchmark_scenarios SET ${fields.join(', ')} WHERE id = ?`)
    stmt.run(...values, id)
  }

  /**
   * Add a benchmark result
   */
  addResult(input: AddResultInput): BenchmarkResult {
    const now = new Date().toISOString()

    const stmt = this.db.prepare(`
      INSERT INTO benchmark_results (
        scenario_id, request_sequence, is_warmup, ttft_ms, total_latency_ms,
        prompt_tokens, completion_tokens, tokens_per_second, success,
        error_message, http_status, executed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      input.scenarioId,
      input.requestSequence,
      input.isWarmup ? 1 : 0,
      input.ttftMs ?? null,
      input.totalLatencyMs,
      input.promptTokens ?? null,
      input.completionTokens ?? null,
      input.tokensPerSecond ?? null,
      input.success ? 1 : 0,
      input.errorMessage ?? null,
      input.httpStatus ?? null,
      now
    )

    return {
      id: Number(result.lastInsertRowid),
      scenarioId: input.scenarioId,
      requestSequence: input.requestSequence,
      isWarmup: input.isWarmup,
      ttftMs: input.ttftMs,
      totalLatencyMs: input.totalLatencyMs,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      tokensPerSecond: input.tokensPerSecond,
      success: input.success,
      errorMessage: input.errorMessage,
      httpStatus: input.httpStatus,
      executedAt: now,
    }
  }

  /**
   * Get results for a scenario with pagination
   */
  getResults(
    scenarioId: string,
    options: { page?: number; limit?: number; excludeWarmup?: boolean } = {}
  ): { results: BenchmarkResult[]; total: number } {
    const { page = 1, limit = 100, excludeWarmup = true } = options
    const offset = (page - 1) * limit

    let countSql = 'SELECT COUNT(*) as count FROM benchmark_results WHERE scenario_id = ?'
    let selectSql = 'SELECT * FROM benchmark_results WHERE scenario_id = ?'

    if (excludeWarmup) {
      countSql += ' AND is_warmup = 0'
      selectSql += ' AND is_warmup = 0'
    }

    selectSql += ' ORDER BY request_sequence LIMIT ? OFFSET ?'

    const countStmt = this.db.prepare(countSql)
    const countResult = countStmt.get(scenarioId) as { count: number }
    const total = countResult.count

    const selectStmt = this.db.prepare(selectSql)
    const rows = selectStmt.all(scenarioId, limit, offset) as BenchmarkResultRow[]

    return {
      results: rows.map(rowToResult),
      total,
    }
  }

  /**
   * Save aggregated metrics for a scenario
   */
  saveMetrics(metrics: BenchmarkMetrics): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO benchmark_metrics (
        scenario_id,
        ttft_min, ttft_max, ttft_avg, ttft_p50, ttft_p90, ttft_p95, ttft_p99,
        tps_min, tps_max, tps_avg, tps_p50, tps_p90, tps_p95, tps_p99,
        e2e_min, e2e_max, e2e_avg, e2e_p50, e2e_p90, e2e_p95, e2e_p99,
        goodput_count, goodput_percent, sla_threshold_ms,
        kvcache_used_avg_gb, kvcache_peak_gb, gpu_memory_peak_gb,
        total_requests, successful_requests, failed_requests,
        requests_per_second, tokens_per_second_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      metrics.scenarioId,
      metrics.ttftMin ?? null,
      metrics.ttftMax ?? null,
      metrics.ttftAvg ?? null,
      metrics.ttftP50 ?? null,
      metrics.ttftP90 ?? null,
      metrics.ttftP95 ?? null,
      metrics.ttftP99 ?? null,
      metrics.tpsMin ?? null,
      metrics.tpsMax ?? null,
      metrics.tpsAvg ?? null,
      metrics.tpsP50 ?? null,
      metrics.tpsP90 ?? null,
      metrics.tpsP95 ?? null,
      metrics.tpsP99 ?? null,
      metrics.e2eMin ?? null,
      metrics.e2eMax ?? null,
      metrics.e2eAvg ?? null,
      metrics.e2eP50 ?? null,
      metrics.e2eP90 ?? null,
      metrics.e2eP95 ?? null,
      metrics.e2eP99 ?? null,
      metrics.goodputCount ?? null,
      metrics.goodputPercent ?? null,
      metrics.slaThresholdMs ?? null,
      metrics.kvcacheUsedAvgGb ?? null,
      metrics.kvcachePeakGb ?? null,
      metrics.gpuMemoryPeakGb ?? null,
      metrics.totalRequests,
      metrics.successfulRequests,
      metrics.failedRequests,
      metrics.requestsPerSecond ?? null,
      metrics.tokenPerSecondTotal ?? null
    )
  }

  /**
   * Delete a benchmark run and all related data (cascade)
   */
  deleteRun(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM benchmark_runs WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  /**
   * Get all results for a scenario (for percentile calculation)
   */
  getAllResults(scenarioId: string, excludeWarmup = true): BenchmarkResult[] {
    let sql = 'SELECT * FROM benchmark_results WHERE scenario_id = ?'
    if (excludeWarmup) {
      sql += ' AND is_warmup = 0'
    }
    sql += ' ORDER BY request_sequence'

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(scenarioId) as BenchmarkResultRow[]
    return rows.map(rowToResult)
  }

  /**
   * Get all results for a run (across all scenarios)
   * Used for export functionality
   */
  getRunResults(runId: string, excludeWarmup = true): Array<BenchmarkResult & { modelPath: string; modelName: string }> {
    let sql = `
      SELECT r.*, s.model_path, s.model_name
      FROM benchmark_results r
      JOIN benchmark_scenarios s ON r.scenario_id = s.id
      WHERE s.run_id = ?
    `
    if (excludeWarmup) {
      sql += ' AND r.is_warmup = 0'
    }
    sql += ' ORDER BY s.id, r.request_sequence'

    const stmt = this.db.prepare(sql)
    const rows = stmt.all(runId) as Array<BenchmarkResultRow & { model_path: string; model_name: string }>
    return rows.map((row) => ({
      ...rowToResult(row),
      modelPath: row.model_path,
      modelName: row.model_name,
    }))
  }
}

// Singleton instance
let benchmarkStore: BenchmarkStore | null = null

export function getBenchmarkStore(): BenchmarkStore {
  if (!benchmarkStore) {
    benchmarkStore = new BenchmarkStore()
  }
  return benchmarkStore
}

// For testing with custom database
export function createBenchmarkStore(database: Database.Database): BenchmarkStore {
  return new BenchmarkStore(database)
}
