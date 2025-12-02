import { randomUUID } from 'crypto'
import type { InferenceRequest, RequestStatus, ModelInstance } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { requestStore } from '../stores/request-store.js'
import { metricsStore } from '../stores/metrics-store.js'
import { NotFoundError, ServiceUnavailableError } from '../utils/errors.js'
import type { Logger } from '@sardeenz/utils'
import http from 'http'
import https from 'https'

// Connection pool for vLLM instances - optimized for high throughput streaming
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: Infinity,     // No artificial limit - let OS handle it
  maxFreeSockets: 256,      // Keep more sockets warm for reuse
  timeout: 120000,          // Longer timeout for streaming responses
  scheduling: 'fifo',       // FIFO scheduling for predictable latency
})

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  timeout: 120000,
  scheduling: 'fifo',
})

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

  constructor(logger: Logger) {
    this.logger = logger.child({ component: 'ProxyRouter' })
    this.loadBalancer = new RoundRobinBalancer()
  }

  /**
   * Route an inference request to the appropriate model instance
   * Uses round-robin load balancing when multiple instances are available (FR-028)
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
  }): Promise<{
    requestId: string
    response?: unknown | Response
    statusCode: number
    instanceId?: string
    startTime?: number // For streaming: caller computes duration after stream ends
  }> {
    const { modelPath, endpoint, method, body, streaming } = options

    // Find running model instances by model name
    // The modelPath parameter is actually the model name from the request's "model" field
    const instances = modelStore.getRunningByName(modelPath)

    if (instances.length === 0) {
      // Check if any instances exist at all
      const allInstances = modelStore.getAllByName(modelPath)

      if (allInstances.length === 0) {
        throw new NotFoundError(
          `Model ${modelPath} not loaded. Available models: ${modelStore.getAllNames().join(', ')}`
        )
      }

      // Instances exist but none are running
      const statuses = allInstances.map((i) => `${i.id.slice(0, 8)}:${i.status}`).join(', ')
      throw new ServiceUnavailableError(
        `Model ${modelPath} has no running instances. Instance states: ${statuses}`
      )
    }

    // Select instance using round-robin load balancing
    const instance = this.loadBalancer.selectInstance(instances)

    this.logger.debug({
      modelPath,
      instanceId: instance.id,
      port: instance.port,
      totalInstances: instances.length,
    }, 'Selected instance for request')

    // Create inference request record
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

    // Defer initial request record to avoid blocking hot path
    setImmediate(() => requestStore.add(modelPath, request))

    const startTime = Date.now()

    try {
      // Update metrics - keep synchronous for accurate connection tracking
      metricsStore.updateConnections(modelPath, 1)

      // Forward request to vLLM instance
      const targetUrl = `http://localhost:${instance.port}${endpoint}`

      this.logger.debug({ modelPath, instanceId: instance.id, targetUrl, streaming }, 'Forwarding request to vLLM')

      // Removed intermediate "forwarded" status update - minimal debugging value

      if (streaming) {
        // Handle streaming request
        const response = await fetch(targetUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          // @ts-expect-error - Node.js fetch supports agent
          agent: targetUrl.startsWith('https') ? httpsAgent : httpAgent,
        })

        if (!response.ok) {
          // Read error body from vLLM and return it for proper error forwarding
          const errorData = (await response.json().catch(() => ({
            error: { message: response.statusText, type: 'upstream_error' },
          }))) as { error?: { message?: string }; message?: string }

          const durationMs = Date.now() - startTime

          // Defer request record update
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

          // Defer metrics recording for errors too
          setImmediate(() => metricsStore.recordRequest(modelPath, false, durationMs))

          return {
            requestId,
            response: errorData,
            statusCode: response.status,
            instanceId: instance.id,
          }
        }

        // For streaming success: return raw Response for caller to pipe
        // Caller is responsible for recording completion metrics after stream ends
        return {
          requestId,
          response, // WHATWG Response with readable body
          statusCode: response.status,
          instanceId: instance.id,
          startTime, // Caller uses this to compute duration after stream ends
        }
      } else {
        // Handle non-streaming request
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

        // Defer request record update
        const capturedStatus = response.status
        const wasOk = response.ok
        setImmediate(() => {
          request.completedAt = new Date()
          request.status = wasOk ? 'completed' as RequestStatus : 'failed' as RequestStatus
          request.statusCode = capturedStatus
          request.durationMs = durationMs
          requestStore.add(modelPath, request)
        })

        // Defer metrics recording
        setImmediate(() => metricsStore.recordRequest(modelPath, wasOk, durationMs))

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

      // Defer request record update
      setImmediate(() => {
        request.completedAt = new Date()
        request.status = 'failed' as RequestStatus
        request.errorMessage = errorMessage
        request.durationMs = durationMs
        requestStore.add(modelPath, request)
      })

      // Defer metrics recording
      setImmediate(() => metricsStore.recordRequest(modelPath, false, durationMs))

      throw err
    } finally {
      // Decrement active connections - keep synchronous for accuracy
      metricsStore.updateConnections(modelPath, -1)
    }
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
  }
}
