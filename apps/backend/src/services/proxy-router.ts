import { randomUUID } from 'crypto'
import type { InferenceRequest, RequestStatus, ModelInstance } from '@sardeenz/types'
import { modelStore } from '../stores/model-store.js'
import { requestStore } from '../stores/request-store.js'
import { metricsStore } from '../stores/metrics-store.js'
import { NotFoundError, ServiceUnavailableError } from '../utils/errors.js'
import type { Logger } from '@sardeenz/utils'
import http from 'http'
import https from 'https'

// Connection pool for vLLM instances
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
})

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000,
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
   */
  async routeRequest(options: {
    modelPath: string
    endpoint: string
    method: string
    body: Record<string, unknown>
    streaming: boolean
    onChunk?: (chunk: Uint8Array) => void
  }): Promise<{
    requestId: string
    response?: unknown
    statusCode: number
    instanceId?: string
  }> {
    const { modelPath, endpoint, method, body, streaming, onChunk } = options

    // Find active model instances
    const instances = modelStore.getActiveByPath(modelPath)

    if (instances.length === 0) {
      // Check if any instances exist at all
      const allInstances = modelStore.getAllByPath(modelPath)
      if (allInstances.length === 0) {
        throw new NotFoundError(
          `Model ${modelPath} not loaded. Available models: ${modelStore.getAllPaths().join(', ')}`
        )
      }

      // Instances exist but none are active
      const statuses = allInstances.map((i) => `${i.id.slice(0, 8)}:${i.status}`).join(', ')
      throw new ServiceUnavailableError(
        `Model ${modelPath} has no active instances. Instance states: ${statuses}`
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

    requestStore.add(modelPath, request)

    const startTime = Date.now()

    try {
      // Update metrics - increment active connections
      metricsStore.updateConnections(modelPath, 1)

      // Forward request to vLLM instance
      const targetUrl = `http://localhost:${instance.port}${endpoint}`

      this.logger.debug({ modelPath, instanceId: instance.id, targetUrl, streaming }, 'Forwarding request to vLLM')

      request.forwardedAt = new Date()
      request.status = 'forwarded' as RequestStatus
      requestStore.add(modelPath, request)

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
          throw new Error(`vLLM returned ${response.status}: ${response.statusText}`)
        }

        // Stream response
        if (response.body && onChunk) {
          const reader = response.body.getReader()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              onChunk(value)
            }
          } finally {
            reader.releaseLock()
          }
        }

        const durationMs = Date.now() - startTime

        // Update request record
        request.completedAt = new Date()
        request.status = 'completed' as RequestStatus
        request.statusCode = response.status
        request.durationMs = durationMs
        requestStore.add(modelPath, request)

        // Update metrics
        metricsStore.recordRequest(modelPath, true, durationMs)

        return {
          requestId,
          statusCode: response.status,
          instanceId: instance.id,
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

        // Update request record
        request.completedAt = new Date()
        request.status = 'completed' as RequestStatus
        request.statusCode = response.status
        request.durationMs = durationMs
        requestStore.add(modelPath, request)

        // Update metrics
        metricsStore.recordRequest(modelPath, response.ok, durationMs)

        return {
          requestId,
          response: responseData,
          statusCode: response.status,
          instanceId: instance.id,
        }
      }
    } catch (err) {
      const durationMs = Date.now() - startTime

      // Update request record
      request.completedAt = new Date()
      request.status = 'failed' as RequestStatus
      request.errorMessage = err instanceof Error ? err.message : 'Unknown error'
      request.durationMs = durationMs
      requestStore.add(modelPath, request)

      // Update metrics
      metricsStore.recordRequest(modelPath, false, durationMs)

      throw err
    } finally {
      // Decrement active connections
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
