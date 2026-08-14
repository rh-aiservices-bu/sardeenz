import { config as dotenvConfig } from 'dotenv'

// Load environment variables (DOTENV_CONFIG_PATH overrides the default .env)
dotenvConfig({ path: process.env.DOTENV_CONFIG_PATH || '.env' })

import type { AuthMode } from '@sardeenz/types'

export interface Config {
  // Server configuration
  port: number
  host: string
  nodeEnv: string

  // Authentication configuration
  authMode: AuthMode
  adminUsername: string
  adminPassword: string
  jwtSecret: string
  jwtExpirationHours: number
  apiBaseUrl: string
  frontendUrl: string

  // OAuth configuration (used when authMode is 'oauth')
  oauthClientId: string
  oauthClientSecret: string
  oauthIssuerUrl: string
  k8sApiUrl: string
  namespace: string
  serviceAccountToken: string
  serviceAccountTokenPath: string

  // Inference API key (optional, for protecting inference endpoints separately)
  inferenceApiKey: string

  // vLLM configuration
  vllmBasePort: number
  vllmMaxInstances: number
  vllmStartupTimeout: number

  // kvcached configuration
  enableKvcached: boolean
  kvcachedAutopatch: boolean

  // Local models configuration
  localModelsPath: string

  // Logging
  logLevel: string
  logAllRequests: boolean

  // Streaming debug
  debugStreaming: boolean

  // Virtual GPU configuration (dev mode only)
  virtualGpuCount: number

  // Cluster configuration
  clusterPeers: string
  clusterSecret: string
  clusterExpectedPods: number

  // Inference backend configuration
  inferenceBackend: 'vllm' | 'inference-sim'
  simGpuMemoryGB: number
  simModelMemoryGB: number
  simStartupDuration: string
  inferenceSimBinary: string
}

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key]
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function getEnvInt(key: string, defaultValue?: number): number {
  const value = process.env[key]
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue
    }
    throw new Error(`Missing required environment variable: ${key}`)
  }
  // Use Number() rather than parseInt() so numeric forms like "1.8e+06"
  // (e.g. from Helm rendering 1800000 in scientific notation) parse correctly
  // instead of being silently truncated to 1. Reject anything that is not a
  // finite integer so misconfiguration fails loudly at startup.
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`Invalid integer value for ${key}: ${value}`)
  }
  return parsed
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]
  if (value === undefined) {
    return defaultValue
  }
  return value === 'true' || value === '1'
}

function getAuthMode(): AuthMode {
  const mode = getEnv('AUTH_MODE', 'none')
  if (mode !== 'none' && mode !== 'simple' && mode !== 'oauth') {
    throw new Error(`Invalid AUTH_MODE: ${mode}. Must be 'none', 'simple', or 'oauth'`)
  }
  return mode
}

export const config: Config = {
  // Server configuration
  port: getEnvInt('PORT', 3000),
  host: getEnv('HOST', '0.0.0.0'),
  nodeEnv: getEnv('NODE_ENV', 'development'),

  // Authentication configuration
  authMode: getAuthMode(),
  adminUsername: getEnv('ADMIN_USERNAME', 'admin'),
  adminPassword: getEnv('ADMIN_PASSWORD', ''),
  jwtSecret: getEnv('JWT_SECRET', 'change-me-in-production'),
  jwtExpirationHours: getEnvInt('JWT_EXPIRATION_HOURS', 8),
  apiBaseUrl: getEnv('API_BASE_URL', 'http://localhost:3000'),
  frontendUrl: getEnv(
    'FRONTEND_URL',
    getEnv('NODE_ENV', 'development') === 'development'
      ? 'http://localhost:5173'
      : getEnv('API_BASE_URL', 'http://localhost:3000')
  ),

  // OAuth configuration (used when authMode is 'oauth')
  oauthClientId: getEnv('OAUTH_CLIENT_ID', 'sardeenz'),
  oauthClientSecret: getEnv('OAUTH_CLIENT_SECRET', ''),
  oauthIssuerUrl: getEnv('OAUTH_ISSUER_URL', ''),
  k8sApiUrl: getEnv('K8S_API_URL', ''),
  namespace: getEnv('NAMESPACE', 'sardeenz'),
  serviceAccountToken: getEnv('SERVICE_ACCOUNT_TOKEN', ''),
  serviceAccountTokenPath: getEnv(
    'SERVICE_ACCOUNT_TOKEN_PATH',
    '/var/run/secrets/kubernetes.io/serviceaccount/token'
  ),

  // Inference API key (optional, for protecting inference endpoints separately)
  inferenceApiKey: getEnv('INFERENCE_API_KEY', ''),

  // vLLM configuration
  // In cluster mode with CLUSTER_PEERS, auto-offset by pod index * 100 to avoid
  // port collisions when multiple pods share the same host (local dev).
  // Explicit SARDEENZ_VLLM_BASE_PORT always takes precedence.
  vllmBasePort: (() => {
    const STRIDE = 100
    const base = getEnvInt('SARDEENZ_VLLM_BASE_PORT', 12346)
    const peers = getEnv('CLUSTER_PEERS', '')
    if (!peers) return base
    const peerList = peers.split(',').map((p) => p.trim())
    const selfPort = getEnvInt('PORT', 3000)
    const podIndex = peerList.findIndex((entry) => {
      const port = parseInt(entry.split(':')[1], 10)
      return port === selfPort
    })
    return base + Math.max(podIndex, 0) * STRIDE
  })(),
  vllmMaxInstances: getEnvInt('SARDEENZ_VLLM_MAX_INSTANCES', 10),
  vllmStartupTimeout: getEnvInt('SARDEENZ_VLLM_STARTUP_TIMEOUT', 1800000), // 30 minutes default

  // kvcached configuration
  enableKvcached: getEnvBool('ENABLE_KVCACHED', true),
  kvcachedAutopatch: getEnvBool('KVCACHED_AUTOPATCH', true),

  // Local models configuration
  localModelsPath: getEnv('LOCAL_MODELS_PATH', ''),

  // Logging
  logLevel: getEnv('LOG_LEVEL', 'info'),
  logAllRequests: getEnvBool('LOG_ALL_REQUESTS', false),

  // Streaming debug
  debugStreaming: getEnvBool('DEBUG_STREAMING', false),

  // Virtual GPU configuration (dev mode only)
  // 0 = disabled (use real GPUs), N = create N virtual GPUs mapping to physical GPU 0
  virtualGpuCount: getEnvInt('DEV_VIRTUAL_GPU_COUNT', 0),

  // Cluster configuration
  clusterPeers: getEnv('CLUSTER_PEERS', ''),
  clusterSecret: getEnv('CLUSTER_SECRET', ''),
  clusterExpectedPods: getEnvInt('CLUSTER_EXPECTED_PODS', 0),

  // Inference backend configuration
  inferenceBackend: (() => {
    const backend = getEnv('INFERENCE_BACKEND', 'vllm')
    if (backend !== 'vllm' && backend !== 'inference-sim') {
      throw new Error(
        `Invalid INFERENCE_BACKEND: '${backend}'. Must be 'vllm' or 'inference-sim'`
      )
    }
    return backend
  })(),
  simGpuMemoryGB: getEnvInt('SIM_GPU_MEMORY_GB', 24),
  simModelMemoryGB: getEnvInt('SIM_MODEL_MEMORY_GB', 4),
  simStartupDuration: getEnv('SIM_STARTUP_DURATION', '3s'),
  inferenceSimBinary: getEnv('INFERENCE_SIM_BINARY', 'llm-d-inference-sim'),
}

// Validate auth configuration
function validateAuthConfig(): void {
  if (config.authMode === 'simple') {
    if (!config.adminPassword) {
      throw new Error('ADMIN_PASSWORD is required when AUTH_MODE is "simple"')
    }
  }

  if (config.authMode === 'oauth') {
    if (!config.oauthIssuerUrl) {
      throw new Error('OAUTH_ISSUER_URL is required when AUTH_MODE is "oauth"')
    }
    if (!config.oauthClientSecret) {
      throw new Error('OAUTH_CLIENT_SECRET is required when AUTH_MODE is "oauth"')
    }
    if (!config.k8sApiUrl) {
      throw new Error('K8S_API_URL is required when AUTH_MODE is "oauth"')
    }
  }

  // CRITICAL: Block startup with default JWT secret in production
  if (config.authMode !== 'none' && config.jwtSecret === 'change-me-in-production') {
    if (config.nodeEnv === 'production') {
      throw new Error(
        'CRITICAL: JWT_SECRET must be set in production. ' +
          'Using the default secret "change-me-in-production" is not allowed. ' +
          'Generate a secure value with: openssl rand -hex 32'
      )
    }
    console.warn('WARNING: Using default JWT_SECRET. This is insecure for production environments.')
  }
}

validateAuthConfig()

/**
 * Whether the app should run in multi-pod cluster mode.
 *
 * Cluster coordination (peer discovery, leader election, heartbeat) is enabled
 * only when more than one pod is expected (CLUSTER_EXPECTED_PODS > 1) or static
 * peers are configured for local dev (CLUSTER_PEERS). Merely running inside
 * Kubernetes is NOT sufficient: KUBERNETES_SERVICE_HOST is injected into every
 * pod, so a single-replica in-cluster deploy runs in zero-overhead single-pod
 * mode and needs no cluster RBAC (pod list/watch, leases) or cluster secret.
 */
export function isClusterMode(): boolean {
  return config.clusterExpectedPods > 1 || !!config.clusterPeers
}

// Validate cluster configuration
function validateClusterConfig(): void {
  const isCluster = isClusterMode()
  if (isCluster && config.clusterSecret) {
    const MIN_SECRET_LENGTH = 16
    if (config.clusterSecret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `CLUSTER_SECRET must be at least ${MIN_SECRET_LENGTH} characters for secure inter-pod HMAC authentication. ` +
          `Current length: ${config.clusterSecret.length}. Generate a secure value with: openssl rand -hex 32`
      )
    }
  }
  if (isCluster && !config.clusterSecret) {
    throw new Error(
      'CLUSTER_SECRET is required in cluster mode. Inter-pod communication cannot be secured without it. ' +
        'Generate a secure value with: openssl rand -hex 32'
    )
  }
  if (isCluster && config.authMode === 'none') {
    console.warn(
      'WARNING: Cluster mode with AUTH_MODE=none. The cluster admin API (/api/cluster/*) is unauthenticated. ' +
        'Set AUTH_MODE to "simple" or "oauth" for production deployments.'
    )
  }
}

validateClusterConfig()

export function isInferenceSimMode(): boolean {
  return config.inferenceBackend === 'inference-sim'
}
