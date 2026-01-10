/**
 * LLM Benchmarking Types
 *
 * Types for performance benchmarking of loaded models.
 */

// Benchmark run status
export enum BenchmarkStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Cancelled = 'cancelled',
  Failed = 'failed',
}

// Benchmark mode
export enum BenchmarkMode {
  /** Run scenarios one at a time for clean metrics */
  Isolated = 'isolated',
  /** Run all scenarios simultaneously for contention testing */
  Contention = 'contention',
}

// Scenario status
export enum ScenarioStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
}

/** Routing mode for benchmark requests */
export type RoutingMode = 'direct' | 'proxy'

/**
 * Configuration for a single benchmark scenario
 */
export interface BenchmarkScenarioConfig {
  /** Model instance ID to benchmark */
  instanceId: string
  /** Routing mode: 'direct' to vLLM or 'proxy' through unified endpoint */
  routingMode?: RoutingMode
  /** Target input token count (approximate) */
  inputTokens: number
  /** Target output token count (max_tokens for request) */
  outputTokens: number
  /** Number of concurrent requests */
  concurrency: number
  /** Total number of measured requests */
  totalRequests: number
  /** Number of warmup requests (not measured) */
  warmupRequests: number
  /** SLA threshold in ms for goodput calculation */
  slaThresholdMs?: number
}

/**
 * Configuration for a benchmark run
 */
export interface BenchmarkConfig {
  /** Optional name for this benchmark run */
  name?: string
  /** Execution mode: isolated or contention */
  mode: BenchmarkMode
  /** Whether kvcached is enabled at system level */
  kvcachedEnabled: boolean
  /** Scenarios to run */
  scenarios: BenchmarkScenarioConfig[]
}

/**
 * A benchmark scenario within a run
 */
export interface BenchmarkScenario {
  id: string
  runId: string
  instanceId: string
  /** Routing mode: 'direct' to vLLM or 'proxy' through unified endpoint */
  routingMode: RoutingMode
  modelPath: string
  modelName: string
  inputTokens: number
  outputTokens: number
  concurrency: number
  warmupRequests: number
  totalRequests: number
  slaThresholdMs?: number
  status: ScenarioStatus
  startedAt?: string
  completedAt?: string
  errorMessage?: string
}

/**
 * Result of a single benchmark request
 */
export interface BenchmarkResult {
  id: number
  scenarioId: string
  /** Request sequence number (1-based) */
  requestSequence: number
  /** Whether this was a warmup request */
  isWarmup: boolean
  /** Time to first token in ms */
  ttftMs?: number
  /** Total request latency in ms */
  totalLatencyMs: number
  /** Actual prompt tokens (from response) */
  promptTokens?: number
  /** Actual completion tokens (from response) */
  completionTokens?: number
  /** Tokens per second (generation speed) */
  tokensPerSecond?: number
  /** Whether the request succeeded */
  success: boolean
  /** Error message if failed */
  errorMessage?: string
  /** HTTP status code */
  httpStatus?: number
  /** When the request was executed */
  executedAt: string
}

/**
 * Aggregated metrics for a scenario
 */
export interface BenchmarkMetrics {
  scenarioId: string

  // TTFT metrics (ms)
  ttftMin?: number
  ttftMax?: number
  ttftAvg?: number
  ttftP50?: number
  ttftP90?: number
  ttftP95?: number
  ttftP99?: number

  // TPS metrics (tokens/second)
  tpsMin?: number
  tpsMax?: number
  tpsAvg?: number
  tpsP50?: number
  tpsP90?: number
  tpsP95?: number
  tpsP99?: number

  // E2E latency metrics (ms)
  e2eMin?: number
  e2eMax?: number
  e2eAvg?: number
  e2eP50?: number
  e2eP90?: number
  e2eP95?: number
  e2eP99?: number

  // Goodput
  goodputCount?: number
  goodputPercent?: number
  slaThresholdMs?: number

  // Memory metrics (sampled during run)
  kvcacheUsedAvgGb?: number
  kvcachePeakGb?: number
  gpuMemoryPeakGb?: number

  // Request stats
  totalRequests: number
  successfulRequests: number
  failedRequests: number
  requestsPerSecond?: number
  tokenPerSecondTotal?: number
}

/**
 * A complete benchmark run with scenarios and metrics
 */
export interface BenchmarkRun {
  id: string
  name?: string
  status: BenchmarkStatus
  mode: BenchmarkMode
  kvcachedEnabled: boolean
  createdAt: string
  startedAt?: string
  completedAt?: string
  /** Original config JSON */
  configJson: string
  errorMessage?: string
  totalRequests?: number
  successfulRequests?: number
  failedRequests?: number
  durationSeconds?: number
}

/**
 * Full benchmark run with related data
 */
export interface BenchmarkRunWithDetails extends BenchmarkRun {
  scenarios: (BenchmarkScenario & { metrics?: BenchmarkMetrics })[]
}

/**
 * SSE progress event during benchmark execution
 */
export interface BenchmarkProgressEvent {
  channel: 'benchmark'
  type: 'progress'
  data: {
    runId: string
    phase: 'starting' | 'warmup' | 'running' | 'calculating' | 'completed' | 'failed'
    scenarioId?: string
    currentRequest?: number
    totalRequests?: number
    completedScenarios?: number
    totalScenarios?: number
    /** Number of scenarios that have completed warmup */
    warmupComplete?: number
    /** Total number of scenarios in warmup phase */
    warmupTotal?: number
    /** Number of requests currently in-flight */
    inFlightRequests?: number
    message: string
  }
}

/**
 * SSE event for individual request completion
 */
export interface BenchmarkRequestEvent {
  channel: 'benchmark'
  type: 'request'
  data: {
    runId: string
    scenarioId: string
    sequence: number
    ttftMs: number
    tps: number
    totalLatencyMs: number
    success: boolean
  }
}

/**
 * Union type for all benchmark SSE events
 */
export type BenchmarkEvent = BenchmarkProgressEvent | BenchmarkRequestEvent
