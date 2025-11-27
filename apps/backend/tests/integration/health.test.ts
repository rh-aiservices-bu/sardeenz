import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createTestApp, clearAllStores } from '../setup.js'

describe('Health Routes', () => {
  let app: FastifyInstance

  beforeEach(async () => {
    clearAllStores()
    app = await createTestApp()
    await app.ready()
  })

  afterEach(async () => {
    await app.close()
  })

  describe('GET /api/health', () => {
    it('should return healthy status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('healthy')
      expect(body.timestamp).toBeDefined()
      expect(body.uptime).toBeTypeOf('number')
      expect(body.version).toBe('0.1.0')
    })

    it('should return valid ISO timestamp', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health',
      })

      const body = JSON.parse(response.payload)
      const timestamp = new Date(body.timestamp)
      expect(timestamp.toISOString()).toBe(body.timestamp)
    })
  })

  describe('GET /api/health/ready', () => {
    it('should return ready status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health/ready',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('ready')
      expect(body.timestamp).toBeDefined()
    })
  })

  describe('GET /api/health/live', () => {
    it('should return alive status', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/health/live',
      })

      expect(response.statusCode).toBe(200)

      const body = JSON.parse(response.payload)
      expect(body.status).toBe('alive')
      expect(body.timestamp).toBeDefined()
    })
  })
})
