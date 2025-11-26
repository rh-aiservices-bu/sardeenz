import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'
import metricsPlugin from 'fastify-metrics'
import { register, Counter, Histogram, Gauge } from 'prom-client'

declare module 'fastify' {
  interface FastifyInstance {
    sardeenzMetrics: {
      modelLoadDuration: Histogram
      modelUnloadDuration: Histogram
      routingLatency: Histogram
      activeModels: Gauge
      activeConnections: Gauge
      inferenceRequests: Counter
    }
  }
}

async function customMetricsPlugin(fastify: FastifyInstance) {
  // Register fastify-metrics for automatic HTTP metrics
  await fastify.register(metricsPlugin, {
    endpoint: '/metrics',
    routeMetrics: {
      enabled: true,
      registeredRoutesOnly: true,
      groupStatusCodes: true,
    },
  })

  // Custom metrics for vLLM operations
  const modelLoadDuration = new Histogram({
    name: 'vllm_model_load_duration_seconds',
    help: 'Duration of model load operations',
    labelNames: ['model_path', 'status'],
    buckets: [10, 30, 60, 120, 300], // 10s, 30s, 1m, 2m, 5m
  })

  const modelUnloadDuration = new Histogram({
    name: 'vllm_model_unload_duration_seconds',
    help: 'Duration of model unload operations',
    labelNames: ['model_path'],
    buckets: [1, 5, 10, 30], // 1s, 5s, 10s, 30s
  })

  const routingLatency = new Histogram({
    name: 'vllm_routing_latency_milliseconds',
    help: 'Latency of request routing to vLLM instances',
    labelNames: ['model', 'endpoint'],
    buckets: [1, 5, 10, 25, 50, 100, 250], // milliseconds
  })

  const activeModels = new Gauge({
    name: 'vllm_active_models',
    help: 'Number of currently loaded models',
  })

  const activeConnections = new Gauge({
    name: 'vllm_active_connections',
    help: 'Number of active connections to vLLM instances',
    labelNames: ['model'],
  })

  const inferenceRequests = new Counter({
    name: 'vllm_inference_requests_total',
    help: 'Total number of inference requests',
    labelNames: ['model', 'status', 'streaming'],
  })

  // Register custom metrics
  register.registerMetric(modelLoadDuration)
  register.registerMetric(modelUnloadDuration)
  register.registerMetric(routingLatency)
  register.registerMetric(activeModels)
  register.registerMetric(activeConnections)
  register.registerMetric(inferenceRequests)

  // Decorate fastify with custom sardeenz metrics
  fastify.decorate('sardeenzMetrics', {
    modelLoadDuration,
    modelUnloadDuration,
    routingLatency,
    activeModels,
    activeConnections,
    inferenceRequests,
  })
}

export default fp(customMetricsPlugin, {
  name: 'metrics-plugin',
})
