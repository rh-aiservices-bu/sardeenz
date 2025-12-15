/**
 * Routes that should have quiet logging (debug level for 2xx responses).
 * Add new high-frequency polling endpoints here to reduce log noise.
 *
 * These routes will only log successful requests (2xx) at debug level,
 * while errors (4xx/5xx) are always logged at warn/error levels.
 */
export const QUIET_ROUTES = [
  '/api/models', // Frontend polling for model list
  '/api/memory/usage', // Frontend polling for memory metrics
  '/api/health', // OpenShift liveness probe
  '/api/health/ready', // OpenShift readiness probe
  '/api/health/live', // OpenShift liveness probe (alternative)
  '/v1/models', // OpenAI-compatible model list endpoint
] as const
