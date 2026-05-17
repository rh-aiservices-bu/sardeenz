import { randomUUID } from 'crypto'
import type { InferenceRequest, RequestStatus, ModelInstance, RoutingEntry } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { requestStore } from '../stores/request-store.js'
import { metricsStore } from '../stores/metrics-store.js'
import { clusterRoutingStore } from '../stores/cluster-routing-store.js'
import { NotFoundError, ServiceUnavailableError } from '../utils/errors.js'
import { config } from '../config.js'
import type { Logger } from '@sardeenz/utils'
import http from 'http'
import https from 'https'
import { Pool } from 'undici'

/** Header injected on cross-pod forwards for loop detection (T046) */
export const FORWARDED_HEADER = 'x-sardeenz-forwarded'

// Connection pool for local vLLM instances - optimized for high throughput streaming
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: Infinity, // No artificial limit - let OS handle it
  maxFreeSockets: 256, // Keep more sockets warm for reuse
  timeout: 120000, // Longer timeout for streaming responses
  scheduling: 'fifo', // FIFO scheduling for predictable latency
})

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  timeout: 120000,
  scheduling: 'fifo',
})

// ── T049: Per-pod circuit breaker ──────────────────────────────────

interface CircuitBreakerState {
  failures: number[]  // timestamps of recent failures
  cooldownUntil: number  // 0 = not in cooldown
}

const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3
const CIRCUIT_BREAKER_WINDOW_MS = 30_000  // 30 seconds
const CIRCUIT_BREAKER_COOLDOWN_MS = 15_000  // 15 seconds

class CircuitBreaker {
  private states: Map<string, CircuitBreakerState> = new Map()

  isOpen(podId: string): boolean {
    const state = this.states.get(podId)
    if (!state) return false
    if (state.cooldownUntil > 0 && Date.now() < state.cooldownUntil) {
      return true  // circuit is open (in cooldown)
    }
    if (state.cooldownUntil > 0 && Date.now() >= state.cooldownUntil) {
      // Cooldown expired, reset
      this.states.delete(podId)
    }
    return false
  }

  recordFailure(podId: string): void {
    let state = this.states.get(podId)
    if (!state) {
      state = { failures: [], cooldownUntil: 0 }
      this.states.set(podId, state)
    }

    const now = Date.now()
    state.failures.push(now)

    // Prune failures outside the window
    state.failures = state.failures.filter((t) => now - t < CIRCUIT_BREAKER_WINDOW_MS)

    if (state.failures.length >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      state.cooldownUntil = now + CIRCUIT_BREAKER_COOLDOWN_MS
      state.failures = []
    }
  }

  recordSuccess(podId: string): void {
    this.states.delete(podId)
  }

  removePod(podId: string): void {
    this.states.delete(podId)
  }

  clear(): void {
    this.states.clear()
  }
}

// ── T044: Per-pod connection pool management ──────────────────────

class PodPoolManager {
  private pools: Map<string, Pool> = new Map()  // keyed by podId

  getOrCreate(podId: string, baseUrl: string): Pool {
    let pool = this.pools.get(podId)
    if (!pool) {
      pool = new Pool(baseUrl, {
        connections: 64,
        pipelining: 1,
        keepAliveTimeout: 120_000,
      })
      this.pools.set(podId, pool)
    }
    return pool
  }

  async destroyPool(podId: string): Promise<void> {
    const pool = this.pools.get(podId)
    if (pool) {
      await pool.close()
      this.pools.delete(podId)
    }
  }

  async destroyAll(): Promise<void> {
    for (const [podId, pool] of this.pools) {
      await pool.close()
      this.pools.delete(podId)
    }
  }

  hasPod(podId: string): boolean {
    return this.pools.has(podId)
  }
}

// ── T048: Weighted round-robin for cluster routing ────────────────

class WeightedRoundRobin {
  private counters: Map<string, number> = new Map()
  private cachedWeighted: Map<string, { entries: RoutingEntry[]; version: number }> = new Map()

  /**
   * Select next entry using weighted round-robin.
   * Entries with weight=2 (local) are selected twice as often as weight=1 (remote).
   * Caches the expanded weighted list and invalidates when routing table version changes.
   */
  select(modelName: string, entries: RoutingEntry[]): RoutingEntry {
    if (entries.length === 1) return entries[0]

    const tableVersion = clusterRoutingStore.getVersion()
    let cached = this.cachedWeighted.get(modelName)
    if (!cached || cached.version !== tableVersion) {
      const weighted: RoutingEntry[] = []
      for (const entry of entries) {
        for (let i = 0; i < entry.weight; i++) {
          weighted.push(entry)
        }
      }
      cached = { entries: weighted, version: tableVersion }
      this.cachedWeighted.set(modelName, cached)
    }

    const idx = this.counters.get(modelName) ?? 0
    const selected = cached.entries[idx % cached.entries.length]
    this.counters.set(modelName, (idx + 1) % cached.entries.length)
    return selected
  }

  reset(modelName?: string): void {
    if (modelName) {
      this.counters.delete(modelName)
      this.cachedWeighted.delete(modelName)
    } else {
      this.counters.clear()
      this.cachedWeighted.clear()
    }
  }
}

/**
 * Round-robin load balancer for multi-instance support (FR-028)
 */
class RoundRobinBalancer {
  private nextIndex: Map<string, number> = new Map()

  /**
   * Select the next instance using round-robin
   */
  selectInstance(instances: ModelInstance[]): ModelInstance {
    if (instances.length === 0) {
      throw new Error('No instances available')
    }

    if (instances.length === 1) {
      return instances[0]
    }

    const modelPath = instances[0].modelPath
    const currentIndex = this.nextIndex.get(modelPath) || 0
    const selected = instances[currentIndex % instances.length]

    // Update index for next request
    this.nextIndex.set(modelPath, (currentIndex + 1) % instances.length)

    return selected
  }

  /**
   * Reset the index for a model path (e.g., when instances change)
   */
  reset(modelPath?: string): void {
    if (modelPath) {
      this.nextIndex.delete(modelPath)
    } else {
      this.nextIndex.clear()
    }
  }
}

export class ProxyRouter {
  private logger: Logger
  private loadBalancer: RoundRobinBalancer
  private podPools: PodPoolManager
  private circuitBreaker: CircuitBreaker
  private weightedRR: WeightedRoundRobin

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'ProxyRouter' })
    this.loadBalancer = new RoundRobinBalancer()
    this.podPools = new PodPoolManager()
    this.circuitBreaker = new CircuitBreaker()
    this.weightedRR = new WeightedRoundRobin()
  }

  // ── T044: Pool lifecycle ──────────────────────────────────────

  /**
   * Remove connection pool and circuit breaker state for a departing peer.
   * Call this when PeerStore removes a pod.
   */
  async removePeer(podId: string): Promise<void> {
    await this.podPools.destroyPool(podId)
    this.circuitBreaker.removePod(podId)
    this.logger.info({ podId }, 'Destroyed connection pool for departed peer')
  }

  /**
   * Destroy all remote pod pools (shutdown cleanup).
   */
  async destroyAllPools(): Promise<void> {
    await this.podPools.destroyAll()
    this.circuitBreaker.clear()
  }

  // ── T046: Loop detection ──────────────────────────────────────

  /**
   * Check if a request has already been forwarded (loop detection).
   * Returns true if the request carries the forwarded header.
   */
  isForwardedRequest(headers: Record<string, string | string[] | undefined>): boolean {
    return !!headers[FORWARDED_HEADER]
  }

  // ── T045/T047/T048: Cross-pod forwarding ──────────────────────

  /**
   * Route an inference request to the appropriate model instance.
   * First checks local instances, then falls back to cluster routing table
   * for cross-pod forwarding (FR-008 bypass: forward directly to remote vLLM port).
   *
   * For streaming requests: returns raw WHATWG Response for caller to pipe to client.
   * Caller is responsible for recording completion metrics after stream ends.
   */
  async routeRequest(options: {
    modelPath: string
    endpoint: string
    method: string
    body: Record<string, unknown>
    streaming: boolean
    isForwarded?: boolean  // true if request already carries X-Sardeenz-Forwarded
  }): Promise<{
    requestId: string
    response?: unknown | Response
    statusCode: number
    instanceId?: string
    startTime?: number
    onStreamComplete?: () => void
  }> {
    const { modelPath, endpoint, method, body, streaming, isForwarded } = options

    // T046: Reject forwarded requests that would need another forward (loop prevention)
    if (isForwarded) {
      // This request was already forwarded to us — only serve locally
      return this.routeLocal(modelPath, endpoint, method, body, streaming)
    }

    // Try local instances first
    const localInstances = modelStore.getRunningByName(modelPath)
    if (localInstances.length > 0) {
      // Check if cluster routing has remote entries too for weighted selection
      const routingEntries = clusterRoutingStore.getRoutingEntries(modelPath)
      if (routingEntries.length > 1) {
        // Multiple pods serve this model — use weighted round-robin (T048)
        return this.routeWithWeightedRR(modelPath, endpoint, method, body, streaming, routingEntries)
      }
      // Only local — route directly
      return this.routeLocal(modelPath, endpoint, method, body, streaming)
    }

    // No local instances — try cross-pod routing via cluster routing table (T045)
    const routingEntries = clusterRoutingStore.getRoutingEntries(modelPath)
    const availableEntries = routingEntries.filter(
      (e) => !this.circuitBreaker.isOpen(e.podId)
    )

    if (availableEntries.length > 0) {
      const entry = this.weightedRR.select(modelPath, availableEntries)
      return this.forwardToRemotePod(modelPath, endpoint, method, body, streaming, entry)
    }

    // No routing entries either — generate helpful error
    const allInstances = modelStore.getAllByName(modelPath)
    if (allInstances.length === 0) {
      // Check if circuit-broken pods had entries
      if (routingEntries.length > 0) {
        throw new ServiceUnavailableError(
          `Model ${modelPath} is available on remote pods but all are circuit-broken. Retry after cooldown.`
        )
      }
      throw new NotFoundError(
        `Model ${modelPath} not loaded. Available models: ${modelStore.getAllNames().join(', ')}`
      )
    }

    const sleepingInstances = allInstances.filter((i) => i.status === 'sleeping')
    if (sleepingInstances.length > 0) {
      throw new ServiceUnavailableError(
        `Model ${modelPath} is sleeping. Wake it up to serve requests.`
      )
    }

    const statuses = allInstances.map((i) => `${i.id.slice(0, 8)}:${i.status}`).join(', ')
    throw new ServiceUnavailableError(
      `Model ${modelPath} has no running instances. Instance states: ${statuses}`
    )
  }

  /**
   * Route using weighted round-robin across local and remote entries (T048).
   */
  private async routeWithWeightedRR(
    modelPath: string,
    endpoint: string,
    method: string,
    body: Record<string, unknown>,
    streaming: boolean,
    entries: RoutingEntry[]
  ): ReturnType<ProxyRouter['routeRequest']> {
    // Filter out circuit-broken pods
    const available = entries.filter((e) => !this.circuitBreaker.isOpen(e.podId))
    if (available.length === 0) {
      // Fall back to local-only if all remotes are broken
      return this.routeLocal(modelPath, endpoint, method, body, streaming)
    }

    const selected = this.weightedRR.select(modelPath, available)

    // Check if selected entry is local (weight=2 means local per ClusterRoutingStore convention)
    const localEntries = clusterRoutingStore.getLocalEntries(modelPath)
    const isLocal = localEntries.some((e) => e.podId === selected.podId)
    if (isLocal) {
      return this.routeLocal(modelPath, endpoint, method, body, streaming)
    }

    // Forward to remote pod
    return this.forwardToRemotePod(modelPath, endpoint, method, body, streaming, selected)
  }

  /**
   * Route to a local vLLM instance (original behavior).
   */
  private async routeLocal(
    modelPath: string,
    endpoint: string,
    method: string,
    body: Record<string, unknown>,
    streaming: boolean
  ): ReturnType<ProxyRouter['routeRequest']> {
    const instances = modelStore.getRunningByName(modelPath)
    if (instances.length === 0) {
      throw new ServiceUnavailableError(`Model ${modelPath} has no running local instances`)
    }

    const instance = this.loadBalancer.selectInstance(instances)

    this.logger.debug(
      {
        modelPath,
        instanceId: instance.id,
        port: instance.port,
        totalInstances: instances.length,
      },
      'Selected local instance for request'
    )

    const requestId = randomUUID()
    const request: InferenceRequest = {
      id: requestId,
      modelPath,
      endpoint,
      method: method as 'POST',
      requestBody: body,
      streaming,
      receivedAt: new Date(),
      status: 'pending' as RequestStatus,
    }

    setImmediate(() => requestStore.add(modelPath, request))

    const startTime = Date.now()

    try {
      metricsStore.updateConnections(modelPath, 1)
      metricsStore.updateInstanceConnections(instance.id, 1)

      const targetUrl = `http://localhost:${instance.port}${endpoint}`

      this.logger.debug(
        { modelPath, instanceId: instance.id, targetUrl, streaming },
        'Forwarding request to vLLM'
      )

      const requestHeaders = { 'Content-Type': 'application/json' }

      if (streaming) {
        if (config.debugStreaming) {
          this.logger.info(
            {
              stage: 'request_to_vllm',
              requestId,
              targetUrl,
              method,
              headers: requestHeaders,
              body,
              instanceId: instance.id,
              instancePort: instance.port,
            },
            'SSE Debug: Sending streaming request to vLLM'
          )
        }

        const response = await fetch(targetUrl, {
          method,
          headers: requestHeaders,
          body: JSON.stringify(body),
          // @ts-expect-error - Node.js fetch supports agent
          agent: targetUrl.startsWith('https') ? httpsAgent : httpAgent,
        })

        if (config.debugStreaming) {
          const responseHeaders: Record<string, string> = {}
          response.headers.forEach((value, key) => {
            responseHeaders[key] = value
          })
          const contentType = response.headers.get('content-type') || ''
          this.logger.info(
            {
              stage: 'vllm_response',
              requestId,
              status: response.status,
              statusText: response.statusText,
              contentType,
              allHeaders: responseHeaders,
              isStreaming: contentType.includes('text/event-stream'),
              hasBody: !!response.body,
            },
            'SSE Debug: vLLM response received'
          )

          if (!contentType.includes('text/event-stream') && response.ok) {
            this.logger.warn(
              {
                stage: 'vllm_response_warning',
                requestId,
                expectedContentType: 'text/event-stream',
                actualContentType: contentType,
              },
              'SSE Debug: WARNING - vLLM did not return text/event-stream content-type'
            )
          }
        }

        if (!response.ok) {
          const errorData = (await response.json().catch(() => ({
            error: { message: response.statusText, type: 'upstream_error' },
          }))) as { error?: { message?: string }; message?: string }

          const durationMs = Date.now() - startTime

          const capturedStatus = response.status
          const capturedError = errorData.error?.message || errorData.message || response.statusText
          setImmediate(() => {
            request.completedAt = new Date()
            request.status = 'failed' as RequestStatus
            request.statusCode = capturedStatus
            request.errorMessage = capturedError
            request.durationMs = durationMs
            requestStore.add(modelPath, request)
          })

          setImmediate(() => metricsStore.recordRequest(modelPath, false, durationMs))

          metricsStore.updateConnections(modelPath, -1)
          metricsStore.updateInstanceConnections(instance.id, -1)

          return {
            requestId,
            response: errorData,
            statusCode: response.status,
            instanceId: instance.id,
          }
        }

        const onStreamComplete = () => {
          metricsStore.updateConnections(modelPath, -1)
          metricsStore.updateInstanceConnections(instance.id, -1)
        }

        return {
          requestId,
          response,
          statusCode: response.status,
          instanceId: instance.id,
          startTime,
          onStreamComplete,
        }
      } else {
        const response = await fetch(targetUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          // @ts-expect-error - Node.js fetch supports agent
          agent: targetUrl.startsWith('https') ? httpsAgent : httpAgent,
        })

        const responseData = await response.json()
        const durationMs = Date.now() - startTime

        const capturedStatus = response.status
        const wasOk = response.ok
        setImmediate(() => {
          request.completedAt = new Date()
          request.status = wasOk ? ('completed' as RequestStatus) : ('failed' as RequestStatus)
          request.statusCode = capturedStatus
          request.durationMs = durationMs
          requestStore.add(modelPath, request)
        })

        setImmediate(() => metricsStore.recordRequest(modelPath, wasOk, durationMs))

        metricsStore.updateConnections(modelPath, -1)
        metricsStore.updateInstanceConnections(instance.id, -1)

        return {
          requestId,
          response: responseData,
          statusCode: response.status,
          instanceId: instance.id,
        }
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'

      setImmediate(() => {
        request.completedAt = new Date()
        request.status = 'failed' as RequestStatus
        request.errorMessage = errorMessage
        request.durationMs = durationMs
        requestStore.add(modelPath, request)
      })

      setImmediate(() => metricsStore.recordRequest(modelPath, false, durationMs))

      metricsStore.updateConnections(modelPath, -1)
      metricsStore.updateInstanceConnections(instance.id, -1)

      throw err
    }
  }

  // ── T045/T046/T047: Cross-pod forwarding ──────────────────────

  /**
   * Forward a request to a remote pod's vLLM port directly (FR-008 bypass).
   * Injects X-Sardeenz-Forwarded header for loop detection.
   * Pipes streaming responses without buffering.
   */
  private async forwardToRemotePod(
    modelPath: string,
    endpoint: string,
    method: string,
    body: Record<string, unknown>,
    streaming: boolean,
    entry: RoutingEntry
  ): ReturnType<ProxyRouter['routeRequest']> {
    const { podId, podAddress, vllmPort } = entry
    const baseUrl = `http://${podAddress}:${vllmPort}`
    const pool = this.podPools.getOrCreate(podId, baseUrl)

    const requestId = randomUUID()

    this.logger.info(
      { modelPath, podId, targetUrl: `${baseUrl}${endpoint}`, streaming },
      'Forwarding request to remote pod'
    )

    const startTime = Date.now()
    const bodyStr = JSON.stringify(body)

    try {
      const { statusCode, headers, body: responseBody } = await pool.request({
        path: endpoint,
        method: method as 'GET' | 'POST' | 'PUT' | 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          [FORWARDED_HEADER]: 'true',  // T046: inject loop detection header
        },
        body: bodyStr,
      })

      if (statusCode >= 400) {
        let errorData: Record<string, unknown>
        try {
          errorData = (await responseBody.json()) as Record<string, unknown>
        } catch {
          errorData = { error: { message: `HTTP ${statusCode}`, type: 'upstream_error' } }
        }

        // Record failure for circuit breaker (T049)
        this.circuitBreaker.recordFailure(podId)

        // Error-driven routing entry invalidation on 404 (stale entry)
        if (statusCode === 404) {
          clusterRoutingStore.removeEntry(modelPath, podId)
          this.logger.warn(
            { modelPath, podId },
            'Removed stale routing entry after 404 from remote pod'
          )
        }

        return {
          requestId,
          response: errorData,
          statusCode,
        }
      }

      // Success — reset circuit breaker
      this.circuitBreaker.recordSuccess(podId)

      if (streaming) {
        // T047: Streaming response relay — pipe SSE/chunked transfer without buffering
        // Convert undici Readable to a WHATWG Response for caller to pipe
        const webResponse = new Response(responseBody as unknown as ReadableStream, {
          status: statusCode,
          headers: headers as unknown as Record<string, string>,
        })
        return {
          requestId,
          response: webResponse,
          statusCode,
          startTime,
          onStreamComplete: () => {
            // No local instance metrics to update for remote forwarding
          },
        }
      }

      const responseData = await responseBody.json()
      return {
        requestId,
        response: responseData,
        statusCode,
      }
    } catch (err) {
      // Connection error — record failure for circuit breaker (T049)
      this.circuitBreaker.recordFailure(podId)

      this.logger.error(
        { modelPath, podId, targetUrl: `${baseUrl}${endpoint}`, err: err instanceof Error ? err.message : String(err) },
        'Cross-pod forwarding failed'
      )

      // Error-driven routing entry invalidation on connection errors
      clusterRoutingStore.removeEntry(modelPath, podId)
      this.logger.warn(
        { modelPath, podId },
        'Removed routing entry after connection error to remote pod'
      )

      throw new ServiceUnavailableError(
        `Failed to forward request to remote pod ${podId}: ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  /**
   * Select an instance for audio requests with connection tracking.
   * Returns the selected instance and a release callback to decrement connections.
   */
  selectInstanceForAudio(modelName: string): {
    instance: ModelInstance
    releaseConnection: () => void
  } {
    const instances = modelStore.getRunningByName(modelName)

    if (instances.length === 0) {
      const allInstances = modelStore.getAllByName(modelName)
      if (allInstances.length === 0) {
        throw new NotFoundError(
          `Model ${modelName} not loaded. Available models: ${modelStore.getAllNames().join(', ')}`
        )
      }
      throw new ServiceUnavailableError(`Model ${modelName} has no running instances`)
    }

    const instance = this.loadBalancer.selectInstance(instances)

    // Track connections for both model path and instance
    metricsStore.updateConnections(modelName, 1)
    metricsStore.updateInstanceConnections(instance.id, 1)

    const releaseConnection = () => {
      metricsStore.updateConnections(modelName, -1)
      metricsStore.updateInstanceConnections(instance.id, -1)
    }

    return { instance, releaseConnection }
  }

  /**
   * Get request statistics for a model
   */
  getRequestStats(modelPath: string) {
    return requestStore.getStats(modelPath)
  }

  /**
   * Reset load balancer state
   */
  resetLoadBalancer(modelPath?: string): void {
    this.loadBalancer.reset(modelPath)
    this.weightedRR.reset(modelPath)
  }
}
