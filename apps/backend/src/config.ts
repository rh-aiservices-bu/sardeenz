import { config as dotenvConfig } from 'dotenv'

// Load environment variables
dotenvConfig()

export interface Config {
  // Server configuration
  port: number
  host: string
  nodeEnv: string

  // OAuth/OIDC configuration
  oauthClientId: string
  oauthClientSecret: string
  oidcIssuerUrl: string
  jwtSecret: string
  apiBaseUrl: string

  // vLLM configuration
  vllmBasePort: number
  vllmMaxInstances: number
  vllmStartupTimeout: number

  // KVCached configuration
  enableKvcached: boolean
  kvcachedAutopatch: boolean

  // Local models configuration
  localModelsPath: string

  // Logging
  logLevel: string
  logAllRequests: boolean
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

export const config: Config = {
  // Server configuration
  port: getEnvInt('PORT', 3000),
  host: getEnv('HOST', '0.0.0.0'),
  nodeEnv: getEnv('NODE_ENV', 'development'),

  // OAuth/OIDC configuration (optional for development)
  oauthClientId: getEnv('OAUTH_CLIENT_ID', 'sardeenz'),
  oauthClientSecret: getEnv('OAUTH_CLIENT_SECRET', 'change-me-in-production'),
  oidcIssuerUrl: getEnv('OIDC_ISSUER_URL', ''),
  jwtSecret: getEnv('JWT_SECRET', 'change-me-in-production'),
  apiBaseUrl: getEnv('API_BASE_URL', 'http://localhost:3000'),

  // vLLM configuration
  vllmBasePort: getEnvInt('VLLM_BASE_PORT', 12346),
  vllmMaxInstances: getEnvInt('VLLM_MAX_INSTANCES', 10),
  vllmStartupTimeout: getEnvInt('VLLM_STARTUP_TIMEOUT', 1800000), // 30 minutes default

  // KVCached configuration
  enableKvcached: getEnvBool('ENABLE_KVCACHED', true),
  kvcachedAutopatch: getEnvBool('KVCACHED_AUTOPATCH', true),

  // Local models configuration
  localModelsPath: getEnv('LOCAL_MODELS_PATH', ''),

  // Logging
  logLevel: getEnv('LOG_LEVEL', 'info'),
  logAllRequests: getEnvBool('LOG_ALL_REQUESTS', false),
}
