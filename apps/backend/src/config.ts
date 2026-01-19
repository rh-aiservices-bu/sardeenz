import { config as dotenvConfig } from 'dotenv'

// Load environment variables
dotenvConfig()

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
  const parsed = parseInt(value, 10)
  if (isNaN(parsed)) {
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
  vllmBasePort: getEnvInt('VLLM_BASE_PORT', 12346),
  vllmMaxInstances: getEnvInt('VLLM_MAX_INSTANCES', 10),
  vllmStartupTimeout: getEnvInt('VLLM_STARTUP_TIMEOUT', 1800000), // 30 minutes default

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
