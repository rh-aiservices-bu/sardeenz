import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'

const REPLAY_WINDOW_MS = 30_000

/**
 * Creates an HMAC-SHA256 signature for inter-pod request authentication.
 * Signs: method + path + timestamp + body
 */
export function signRequest(
  method: string,
  path: string,
  body: string,
  secret: string,
  timestamp?: number
): { signature: string; timestamp: number } {
  const ts = timestamp ?? Date.now()
  const payload = `${method.toUpperCase()}\n${path}\n${ts}\n${body}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return { signature, timestamp: ts }
}

/**
 * Verifies an HMAC-SHA256 signature with replay protection.
 * Returns true if the signature is valid and within the replay window.
 */
export function verifyRequest(
  method: string,
  path: string,
  body: string,
  signature: string,
  timestamp: number,
  secret: string
): boolean {
  // Replay protection: reject timestamps older than 30 seconds
  const age = Math.abs(Date.now() - timestamp)
  if (age > REPLAY_WINDOW_MS) {
    return false
  }

  const payload = `${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`
  const expected = createHmac('sha256', secret).update(payload).digest('hex')

  // Constant-time comparison to prevent timing attacks
  const sigBuf = Buffer.from(signature, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')

  if (sigBuf.length !== expectedBuf.length) {
    return false
  }

  return timingSafeEqual(sigBuf, expectedBuf)
}

/**
 * Verifies a request against one or two secrets (for rotation support).
 * Tries the current secret first, then the previous secret if provided.
 */
export function verifyRequestDualSecret(
  method: string,
  path: string,
  body: string,
  signature: string,
  timestamp: number,
  currentSecret: string,
  previousSecret?: string
): boolean {
  if (verifyRequest(method, path, body, signature, timestamp, currentSecret)) {
    return true
  }

  if (previousSecret && verifyRequest(method, path, body, signature, timestamp, previousSecret)) {
    return true
  }

  return false
}

/**
 * Build HMAC-signed headers for inter-pod requests.
 * Shared utility to avoid duplicating signing logic across services.
 */
export function buildSignedHeaders(method: string, path: string, body: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.clusterSecret) {
    const { signature, timestamp } = signRequest(method, path, body, config.clusterSecret)
    headers['x-cluster-signature'] = signature
    headers['x-cluster-timestamp'] = String(timestamp)
  }
  return headers
}

/**
 * Make an HMAC-signed fetch to a peer pod.
 */
export async function signedFetch(url: string, method: string, body?: string, timeoutMs = 10_000): Promise<Response> {
  const path = new URL(url).pathname
  const bodyStr = body ?? ''
  const headers = buildSignedHeaders(method, path, bodyStr)
  return fetch(url, {
    method,
    headers,
    body: bodyStr || undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
}
