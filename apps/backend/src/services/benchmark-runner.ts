/**
 * Benchmark Runner Service
 *
 * Core execution engine for LLM performance benchmarks.
 * Handles concurrent request execution, TTFT measurement, and metrics calculation.
 */

import pLimit from 'p-limit'
import { EventBus } from './event-bus.js'
import { getBenchmarkStore } from '../stores/benchmark-store.js'
import { modelStore } from '../stores/model-store.js'
import { peerStore } from '../stores/peer-store.js'
import { generateChatMessages } from '../utils/prompt-generator.js'
import { config } from '../config.js'
import type {
  BenchmarkScenario,
  BenchmarkStatus,
  ScenarioStatus,
  BenchmarkMetrics,
  BenchmarkProgressEvent,
  BenchmarkRequestEvent,
  SSEEvent,
} from '@sardeenz/types'

// Running benchmarks map for cancellation support
const runningBenchmarks = new Map<string, AbortController>()

/**
 * Resolve the base URL for a benchmark scenario.
 * - Local model: use proxy port (routingMode=proxy) or direct port (routingMode=direct).
 * - Remote model: always route through the local proxy (only proxy mode is valid for remote).
 * Returns null if the model cannot be found.
 */
function resolveBaseUrl(scenario: BenchmarkScenario): string | null {
  const local = modelStore.get(scenario.instanceId)
  if (local) {
    return scenario.routingMode === 'proxy'
      ? `http://localhost:${config.port}`
      : `http://localhost:${local.port}`
  }

  // Remote model — should only reach here in proxy routing mode
  for (const peer of peerStore.getHealthyPeers()) {
    if (peer.models.some((m) => m.instanceId === scenario.instanceId)) {
      return `http://localhost:${config.port}`
    }
  }

  return null
}

interface RequestResult {
  sequence: number
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

/**
 * Emit a benchmark progress event via EventBus
 * Note: We cast through unknown to SSEEvent since benchmark progress uses different data shape
 */
function emitProgress(event: BenchmarkProgressEvent['data']): void {
  EventBus.getInstance().emitEvent({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    instanceId: event.runId, // Use runId as instanceId for filtering
    eventType: 'progress',
    data: event,
  } as unknown as SSEEvent)
}

/**
 * Emit a benchmark request event via EventBus
 * Note: We cast through unknown to SSEEvent since benchmark request uses different data shape
 */
function emitRequestResult(event: BenchmarkRequestEvent['data']): void {
  EventBus.getInstance().emitEvent({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    instanceId: event.runId,
    eventType: 'progress',
    data: event,
  } as unknown as SSEEvent)
}

/**
 * Execute a single streaming request and measure TTFT
 */
async function executeStreamingRequest(
  baseUrl: string,
  modelName: string,
  inputTokens: number,
  outputTokens: number,
  signal: AbortSignal
): Promise<RequestResult & { sequence: number; isWarmup: boolean }> {
  const startTime = performance.now()
  let ttftMs: number | undefined
  let promptTokens: number | undefined
  let completionTokens: number | undefined
  let httpStatus: number | undefined

  try {
    const messages = generateChatMessages(inputTokens)

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages,
        max_tokens: outputTokens,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal,
    })

    httpStatus = response.status

    if (!response.ok) {
      const errorText = await response.text()
      return {
        sequence: 0,
        isWarmup: false,
        totalLatencyMs: performance.now() - startTime,
        success: false,
        errorMessage: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
        httpStatus,
      }
    }

    // Read the streaming response
    const reader = response.body?.getReader()
    if (!reader) {
      return {
        sequence: 0,
        isWarmup: false,
        totalLatencyMs: performance.now() - startTime,
        success: false,
        errorMessage: 'No response body',
        httpStatus,
      }
    }

    const decoder = new TextDecoder()
    let firstChunk = true
    // Content is accumulated but unused (only needed for potential future debugging)
    let _fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (firstChunk) {
        ttftMs = performance.now() - startTime
        firstChunk = false
      }

      // Parse SSE data to extract content and token counts
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n')

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6)
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)
            // Extract content
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              _fullContent += delta
            }
            // Extract token counts from final message
            if (parsed.usage) {
              promptTokens = parsed.usage.prompt_tokens
              completionTokens = parsed.usage.completion_tokens
            }
          } catch {
            // Ignore JSON parse errors in SSE stream
          }
        }
      }
    }

    const totalLatencyMs = performance.now() - startTime

    // Calculate tokens per second
    let tokensPerSecond: number | undefined
    if (completionTokens && ttftMs !== undefined) {
      const generationTimeMs = totalLatencyMs - ttftMs
      if (generationTimeMs > 0) {
        tokensPerSecond = (completionTokens / generationTimeMs) * 1000
      }
    }

    return {
      sequence: 0,
      isWarmup: false,
      ttftMs,
      totalLatencyMs,
      promptTokens,
      completionTokens,
      tokensPerSecond,
      success: true,
      httpStatus,
    }
  } catch (error) {
    const totalLatencyMs = performance.now() - startTime
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    return {
      sequence: 0,
      isWarmup: false,
      ttftMs,
      totalLatencyMs,
      success: false,
      errorMessage: errorMessage.includes('abort') ? 'Request cancelled' : errorMessage,
      httpStatus,
    }
  }
}

/**
 * Calculate percentile from sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

/**
 * Calculate metrics from results
 */
function calculateMetrics(
  scenarioId: string,
  results: RequestResult[],
  slaThresholdMs?: number
): BenchmarkMetrics {
  const successful = results.filter((r) => r.success)
  const failed = results.filter((r) => !r.success)

  // Extract arrays for percentile calculation
  const ttftValues = successful.map((r) => r.ttftMs).filter((v): v is number => v !== undefined)
  const tpsValues = successful
    .map((r) => r.tokensPerSecond)
    .filter((v): v is number => v !== undefined)
  const e2eValues = successful.map((r) => r.totalLatencyMs)

  // Sort for percentile calculation
  ttftValues.sort((a, b) => a - b)
  tpsValues.sort((a, b) => a - b)
  e2eValues.sort((a, b) => a - b)

  // Calculate goodput (requests meeting SLA)
  let goodputCount = 0
  if (slaThresholdMs !== undefined) {
    goodputCount = successful.filter((r) => r.totalLatencyMs < slaThresholdMs).length
  }

  const totalRequests = results.length
  const goodputPercent = totalRequests > 0 ? (goodputCount / totalRequests) * 100 : 0

  // Calculate total tokens per second
  const totalCompletionTokens = successful.reduce((sum, r) => sum + (r.completionTokens ?? 0), 0)
  const totalTimeMs = e2eValues.reduce((sum, v) => sum + v, 0)
  const tokensPerSecondTotal = totalTimeMs > 0 ? (totalCompletionTokens / totalTimeMs) * 1000 : 0

  return {
    scenarioId,

    // TTFT metrics
    ttftMin: ttftValues.length > 0 ? Math.min(...ttftValues) : undefined,
    ttftMax: ttftValues.length > 0 ? Math.max(...ttftValues) : undefined,
    ttftAvg:
      ttftValues.length > 0 ? ttftValues.reduce((a, b) => a + b, 0) / ttftValues.length : undefined,
    ttftP50: ttftValues.length > 0 ? percentile(ttftValues, 50) : undefined,
    ttftP90: ttftValues.length > 0 ? percentile(ttftValues, 90) : undefined,
    ttftP95: ttftValues.length > 0 ? percentile(ttftValues, 95) : undefined,
    ttftP99: ttftValues.length > 0 ? percentile(ttftValues, 99) : undefined,

    // TPS metrics
    tpsMin: tpsValues.length > 0 ? Math.min(...tpsValues) : undefined,
    tpsMax: tpsValues.length > 0 ? Math.max(...tpsValues) : undefined,
    tpsAvg:
      tpsValues.length > 0 ? tpsValues.reduce((a, b) => a + b, 0) / tpsValues.length : undefined,
    tpsP50: tpsValues.length > 0 ? percentile(tpsValues, 50) : undefined,
    tpsP90: tpsValues.length > 0 ? percentile(tpsValues, 90) : undefined,
    tpsP95: tpsValues.length > 0 ? percentile(tpsValues, 95) : undefined,
    tpsP99: tpsValues.length > 0 ? percentile(tpsValues, 99) : undefined,

    // E2E latency metrics
    e2eMin: e2eValues.length > 0 ? Math.min(...e2eValues) : undefined,
    e2eMax: e2eValues.length > 0 ? Math.max(...e2eValues) : undefined,
    e2eAvg:
      e2eValues.length > 0 ? e2eValues.reduce((a, b) => a + b, 0) / e2eValues.length : undefined,
    e2eP50: e2eValues.length > 0 ? percentile(e2eValues, 50) : undefined,
    e2eP90: e2eValues.length > 0 ? percentile(e2eValues, 90) : undefined,
    e2eP95: e2eValues.length > 0 ? percentile(e2eValues, 95) : undefined,
    e2eP99: e2eValues.length > 0 ? percentile(e2eValues, 99) : undefined,

    // Goodput
    goodputCount: slaThresholdMs !== undefined ? goodputCount : undefined,
    goodputPercent: slaThresholdMs !== undefined ? goodputPercent : undefined,
    slaThresholdMs,

    // Request stats
    totalRequests,
    successfulRequests: successful.length,
    failedRequests: failed.length,
    requestsPerSecond: totalTimeMs > 0 ? (totalRequests / totalTimeMs) * 1000 : undefined,
    tokenPerSecondTotal: tokensPerSecondTotal > 0 ? tokensPerSecondTotal : undefined,
  }
}

/** Result of warmup phase execution */
interface WarmupResult {
  scenarioId: string
  success: boolean
  error?: string
}

/**
 * Execute warmup phase for a single scenario
 * Runs warmup requests without tracking metrics
 */
async function executeWarmupPhase(
  runId: string,
  scenario: BenchmarkScenario,
  abortController: AbortController,
  onComplete: () => void
): Promise<WarmupResult> {
  const baseUrl = resolveBaseUrl(scenario)

  if (!baseUrl) {
    return {
      scenarioId: scenario.id,
      success: false,
      error: `Model instance not found: ${scenario.instanceId}`,
    }
  }

  // Skip if no warmup requests configured
  if (scenario.warmupRequests === 0) {
    onComplete()
    return { scenarioId: scenario.id, success: true }
  }

  const limit = pLimit(scenario.concurrency)
  let inFlightRequests = 0
  let completedRequests = 0

  // Periodic progress interval to show ongoing activity during long-running warmup requests
  const progressInterval = setInterval(() => {
    if (inFlightRequests > 0 && !abortController.signal.aborted) {
      emitProgress({
        runId,
        phase: 'warmup',
        scenarioId: scenario.id,
        inFlightRequests,
        message: `${scenario.modelName}: ${inFlightRequests} warmup request(s) in progress...`,
      })
    }
  }, 5000)

  try {
    const warmupTasks = Array.from({ length: scenario.warmupRequests }, () =>
      limit(async () => {
        if (abortController.signal.aborted) return

        // Emit event when warmup request starts
        inFlightRequests++
        emitProgress({
          runId,
          phase: 'warmup',
          scenarioId: scenario.id,
          inFlightRequests,
          message: `${scenario.modelName}: ${inFlightRequests} warmup request(s) in progress`,
        })

        await executeStreamingRequest(
          baseUrl,
          scenario.modelName,
          scenario.inputTokens,
          scenario.outputTokens,
          abortController.signal
        )

        inFlightRequests--
        completedRequests++

        // Emit progress when warmup request completes
        emitProgress({
          runId,
          phase: 'warmup',
          scenarioId: scenario.id,
          inFlightRequests,
          message: `${scenario.modelName}: ${completedRequests}/${scenario.warmupRequests} warmup complete`,
        })
      })
    )

    await Promise.all(warmupTasks)

    // Clean up the periodic progress interval
    clearInterval(progressInterval)

    if (abortController.signal.aborted) {
      return { scenarioId: scenario.id, success: false, error: 'Cancelled' }
    }

    onComplete()
    return { scenarioId: scenario.id, success: true }
  } catch (error) {
    clearInterval(progressInterval)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return { scenarioId: scenario.id, success: false, error: errorMessage }
  }
}

/**
 * Execute measured phase for a single scenario
 * Runs measured requests and collects metrics
 */
async function executeMeasuredPhase(
  runId: string,
  scenario: BenchmarkScenario,
  abortController: AbortController
): Promise<void> {
  const store = getBenchmarkStore()
  const baseUrl = resolveBaseUrl(scenario)

  if (!baseUrl) {
    await store.updateScenarioStatus(scenario.id, 'failed' as ScenarioStatus, {
      errorMessage: `Model instance not found: ${scenario.instanceId}`,
    })
    return
  }

  const results: RequestResult[] = []
  const limit = pLimit(scenario.concurrency)

  // Update scenario status to running
  await store.updateScenarioStatus(scenario.id, 'running' as ScenarioStatus, {
    startedAt: new Date().toISOString(),
  })

  let completedRequests = 0
  let inFlightRequests = 0

  // Periodic progress interval to show ongoing activity during long-running requests
  const progressInterval = setInterval(() => {
    if (inFlightRequests > 0 && !abortController.signal.aborted) {
      emitProgress({
        runId,
        phase: 'running',
        scenarioId: scenario.id,
        currentRequest: completedRequests,
        totalRequests: scenario.totalRequests,
        inFlightRequests,
        message: `${scenario.modelName}: ${inFlightRequests} request(s) in progress...`,
      })
    }
  }, 5000)

  const measurementTasks = Array.from({ length: scenario.totalRequests }, (_, i) =>
    limit(async () => {
      if (abortController.signal.aborted) return

      // Emit event when request starts
      inFlightRequests++
      emitProgress({
        runId,
        phase: 'running',
        scenarioId: scenario.id,
        currentRequest: completedRequests,
        totalRequests: scenario.totalRequests,
        inFlightRequests,
        message: `${scenario.modelName}: ${inFlightRequests} request(s) in progress`,
      })

      const result = await executeStreamingRequest(
        baseUrl,
        scenario.modelName,
        scenario.inputTokens,
        scenario.outputTokens,
        abortController.signal
      )

      inFlightRequests--
      result.sequence = i + 1
      result.isWarmup = false
      results.push(result)

      // Store result in database
      await store.addResult({
        scenarioId: scenario.id,
        requestSequence: result.sequence,
        isWarmup: false,
        ttftMs: result.ttftMs,
        totalLatencyMs: result.totalLatencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        tokensPerSecond: result.tokensPerSecond,
        success: result.success,
        errorMessage: result.errorMessage,
        httpStatus: result.httpStatus,
      })

      completedRequests++

      // Emit individual request result
      emitRequestResult({
        runId,
        scenarioId: scenario.id,
        sequence: result.sequence,
        ttftMs: result.ttftMs ?? 0,
        tps: result.tokensPerSecond ?? 0,
        totalLatencyMs: result.totalLatencyMs,
        success: result.success,
      })

      // Emit progress update periodically
      if (completedRequests % Math.max(1, Math.floor(scenario.totalRequests / 10)) === 0) {
        emitProgress({
          runId,
          phase: 'running',
          scenarioId: scenario.id,
          currentRequest: completedRequests,
          totalRequests: scenario.totalRequests,
          inFlightRequests,
          message: `${scenario.modelName}: ${completedRequests}/${scenario.totalRequests} requests`,
        })
      }
    })
  )

  await Promise.all(measurementTasks)

  // Clean up the periodic progress interval
  clearInterval(progressInterval)

  // Check if aborted
  if (abortController.signal.aborted) {
    await store.updateScenarioStatus(scenario.id, 'failed' as ScenarioStatus, {
      completedAt: new Date().toISOString(),
      errorMessage: 'Benchmark cancelled',
    })
    return
  }

  // Calculate metrics
  const metrics = calculateMetrics(scenario.id, results, scenario.slaThresholdMs)
  await store.saveMetrics(metrics)

  // Update scenario status to completed
  await store.updateScenarioStatus(scenario.id, 'completed' as ScenarioStatus, {
    completedAt: new Date().toISOString(),
  })
}

/**
 * Start executing a benchmark run
 *
 * Execution flow:
 * 1. Phase 1 (Warmup): Run all scenario warmups in parallel
 * 2. BARRIER: Wait for all warmups to complete
 * 3. Phase 2 (Measured): Run measured requests (parallel for contention, sequential for isolated)
 */
export async function startBenchmark(runId: string): Promise<void> {
  const store = getBenchmarkStore()
  const run = await store.getRunWithDetails(runId)

  if (!run) {
    throw new Error(`Benchmark run not found: ${runId}`)
  }

  if (run.status !== 'pending') {
    throw new Error(`Benchmark run is not pending: ${run.status}`)
  }

  // Create abort controller for cancellation
  const abortController = new AbortController()
  runningBenchmarks.set(runId, abortController)

  const startTime = performance.now()

  try {
    // Update run status to running
    await store.updateRunStatus(runId, 'running' as BenchmarkStatus, {
      startedAt: new Date().toISOString(),
    })

    emitProgress({
      runId,
      phase: 'starting',
      totalScenarios: run.scenarios.length,
      message: `Starting benchmark with ${run.scenarios.length} scenario(s)...`,
    })

    // Parse config for mode
    const benchmarkConfig = JSON.parse(run.configJson)

    // Check if any scenarios have warmup requests
    const hasWarmup = run.scenarios.some((s) => s.warmupRequests > 0)

    // ===== PHASE 1: WARMUP (all scenarios in parallel) =====
    if (hasWarmup) {
      const warmupTotal = run.scenarios.length
      let warmupComplete = 0

      emitProgress({
        runId,
        phase: 'warmup',
        warmupTotal,
        warmupComplete: 0,
        message: `Warming up ${warmupTotal} scenario(s)...`,
      })

      // Create callback to track warmup completion
      const onWarmupComplete = (scenarioId: string, modelName: string) => {
        warmupComplete++
        emitProgress({
          runId,
          phase: 'warmup',
          scenarioId,
          warmupTotal,
          warmupComplete,
          message: `${modelName} warmup complete (${warmupComplete}/${warmupTotal})`,
        })
      }

      // Run all warmups in parallel (even in isolated mode)
      const warmupResults = await Promise.all(
        run.scenarios.map((scenario) =>
          executeWarmupPhase(runId, scenario, abortController, () =>
            onWarmupComplete(scenario.id, scenario.modelName)
          )
        )
      )

      // Check for warmup failures
      const failedWarmups = warmupResults.filter((r) => !r.success)
      if (failedWarmups.length > 0) {
        const errorMessages = failedWarmups.map((f) => f.error).join('; ')
        throw new Error(`Warmup failed: ${errorMessages}`)
      }

      // Check if cancelled during warmup
      if (abortController.signal.aborted) {
        throw new Error('Benchmark cancelled during warmup')
      }
    }

    // ===== BARRIER: All warmups complete =====

    // ===== PHASE 2: MEASURED REQUESTS =====
    emitProgress({
      runId,
      phase: 'running',
      totalScenarios: run.scenarios.length,
      message:
        benchmarkConfig.mode === 'isolated'
          ? `Running ${run.scenarios.length} scenario(s) sequentially...`
          : `Running ${run.scenarios.length} scenario(s) in parallel (contention mode)...`,
    })

    if (benchmarkConfig.mode === 'isolated') {
      // Sequential execution of measured phases
      for (let i = 0; i < run.scenarios.length; i++) {
        if (abortController.signal.aborted) break

        emitProgress({
          runId,
          phase: 'running',
          completedScenarios: i,
          totalScenarios: run.scenarios.length,
          message: `Measuring scenario ${i + 1}/${run.scenarios.length}: ${run.scenarios[i].modelName}...`,
        })

        await executeMeasuredPhase(runId, run.scenarios[i], abortController)
      }
    } else {
      // Contention mode - parallel execution of measured phases
      await Promise.all(
        run.scenarios.map((scenario) => executeMeasuredPhase(runId, scenario, abortController))
      )
    }

    // ===== PHASE 3: COMPLETION =====
    emitProgress({
      runId,
      phase: 'calculating',
      message: 'Calculating final metrics...',
    })

    // Calculate final stats
    const updatedRun = await store.getRunWithDetails(runId)
    if (updatedRun) {
      const totalRequests = updatedRun.scenarios.reduce(
        (sum, s) => sum + (s.metrics?.totalRequests ?? 0),
        0
      )
      const successfulRequests = updatedRun.scenarios.reduce(
        (sum, s) => sum + (s.metrics?.successfulRequests ?? 0),
        0
      )
      const failedRequests = updatedRun.scenarios.reduce(
        (sum, s) => sum + (s.metrics?.failedRequests ?? 0),
        0
      )
      const durationSeconds = (performance.now() - startTime) / 1000

      // Update run status to completed
      await store.updateRunStatus(runId, 'completed' as BenchmarkStatus, {
        completedAt: new Date().toISOString(),
        totalRequests,
        successfulRequests,
        failedRequests,
        durationSeconds,
      })

      emitProgress({
        runId,
        phase: 'completed',
        completedScenarios: run.scenarios.length,
        totalScenarios: run.scenarios.length,
        message: `Benchmark completed: ${successfulRequests}/${totalRequests} successful requests in ${durationSeconds.toFixed(1)}s`,
      })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const durationSeconds = (performance.now() - startTime) / 1000

    await store.updateRunStatus(runId, 'failed' as BenchmarkStatus, {
      completedAt: new Date().toISOString(),
      errorMessage,
      durationSeconds,
    })

    emitProgress({
      runId,
      phase: 'failed',
      message: `Benchmark failed: ${errorMessage}`,
    })
  } finally {
    runningBenchmarks.delete(runId)
  }
}

/**
 * Cancel a running benchmark
 */
export async function cancelBenchmark(runId: string): Promise<boolean> {
  const controller = runningBenchmarks.get(runId)
  if (controller) {
    controller.abort()
    runningBenchmarks.delete(runId)

    const store = getBenchmarkStore()
    await store.updateRunStatus(runId, 'cancelled' as BenchmarkStatus, {
      completedAt: new Date().toISOString(),
      errorMessage: 'Cancelled by user',
    })

    emitProgress({
      runId,
      phase: 'failed',
      message: 'Benchmark cancelled by user',
    })

    return true
  }
  return false
}

/**
 * Check if a benchmark is currently running
 */
export function isBenchmarkRunning(runId: string): boolean {
  return runningBenchmarks.has(runId)
}
