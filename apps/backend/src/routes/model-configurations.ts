/**
 * Model Configuration API Routes
 *
 * CRUD operations for saved model configurations.
 */

import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import {
  CreateModelConfigurationRequestSchema,
  UpdateModelConfigurationRequestSchema,
  ListModelConfigurationsResponseSchema,
  GetModelConfigurationResponseSchema,
  DeleteModelConfigurationResponseSchema,
  LoadConfigurationResponseSchema,
  ConfigurationErrorResponseSchema,
  type CreateModelConfigurationRequest,
  type UpdateModelConfigurationRequest,
  type SavedModelConfiguration,
  type ModelConfigurationEntry,
} from '@sardeenz/types'
import { getModelConfigurationStore } from '../stores/model-configuration-store.js'
import { modelStore } from '../stores/model-store.js'
import { ModelManager } from '../services/model-manager.js'

const ConfigIdParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
})

// Helper to convert domain object to API response format (snake_case)
function configToResponse(config: SavedModelConfiguration) {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    model_count: config.modelCount,
    created_at: config.createdAt,
    updated_at: config.updatedAt,
    entries: config.entries?.map((e: ModelConfigurationEntry) => ({
      id: e.id,
      config_id: e.configId,
      model_path: e.modelPath,
      served_model_name: e.servedModelName,
      max_tokens: e.maxTokens,
      source_type: e.sourceType,
      extra_args: e.extraArgs,
      gpu_ids: e.gpuIds,
      tensor_parallel_size: e.tensorParallelSize,
      load_order: e.loadOrder,
    })),
  }
}

export default async function modelConfigurationRoutes(fastify: FastifyInstance) {
  const store = getModelConfigurationStore()
  const modelManager = new ModelManager(fastify.log)

  /**
   * GET /api/configurations - List all configurations
   */
  fastify.get(
    '/api/configurations',
    {
      schema: {
        tags: ['configurations'],
        description: 'List all saved model configurations',
        response: {
          200: ListModelConfigurationsResponseSchema,
        },
      },
    },
    async () => {
      const { configurations, total } = store.listConfigurations()
      return {
        configurations: configurations.map(configToResponse),
        total,
      }
    }
  )

  /**
   * GET /api/configurations/:id - Get a configuration with entries
   */
  fastify.get<{ Params: { id: string } }>(
    '/api/configurations/:id',
    {
      schema: {
        tags: ['configurations'],
        description: 'Get a model configuration by ID with all entries',
        params: ConfigIdParamsSchema,
        response: {
          200: GetModelConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const config = store.getConfiguration(id)

      if (!config) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return { configuration: configToResponse(config) }
    }
  )

  /**
   * POST /api/configurations - Create configuration from current models
   */
  fastify.post<{ Body: CreateModelConfigurationRequest }>(
    '/api/configurations',
    {
      schema: {
        tags: ['configurations'],
        description: 'Save current model configuration',
        body: CreateModelConfigurationRequestSchema,
        response: {
          201: GetModelConfigurationResponseSchema,
          400: ConfigurationErrorResponseSchema,
          409: ConfigurationErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { name, description } = request.body

      // Check for duplicate name
      if (store.nameExists(name)) {
        return reply.status(409).send({
          error: {
            message: `Configuration with name "${name}" already exists`,
            type: 'conflict',
          },
        })
      }

      // Get current running models
      const instances = modelStore.getAll()
      const runningInstances = instances.filter((i) => i.status === 'running')

      if (runningInstances.length === 0) {
        return reply.status(400).send({
          error: {
            message: 'No running models to save. Load at least one model first.',
            type: 'validation_error',
          },
        })
      }

      const config = store.createFromRunningModels({ name, description }, instances)

      reply.status(201)
      return { configuration: configToResponse(store.getConfiguration(config.id)!) }
    }
  )

  /**
   * PUT /api/configurations/:id - Update configuration name/description
   */
  fastify.put<{ Params: { id: string }; Body: UpdateModelConfigurationRequest }>(
    '/api/configurations/:id',
    {
      schema: {
        tags: ['configurations'],
        description: 'Update a configuration name or description',
        params: ConfigIdParamsSchema,
        body: UpdateModelConfigurationRequestSchema,
        response: {
          200: GetModelConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
          409: ConfigurationErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const body = request.body

      // Check name conflict if updating name
      if (body.name) {
        const existing = store.getConfiguration(id)
        if (existing && existing.name !== body.name && store.nameExists(body.name)) {
          return reply.status(409).send({
            error: {
              message: `Configuration with name "${body.name}" already exists`,
              type: 'conflict',
            },
          })
        }
      }

      const config = store.updateConfiguration(id, body)

      if (!config) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return { configuration: configToResponse(config) }
    }
  )

  /**
   * DELETE /api/configurations/:id - Delete a configuration
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api/configurations/:id',
    {
      schema: {
        tags: ['configurations'],
        description: 'Delete a model configuration',
        params: ConfigIdParamsSchema,
        response: {
          200: DeleteModelConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      const deleted = store.deleteConfiguration(id)

      if (!deleted) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      return {
        status: 'success' as const,
        id,
        deleted_at: new Date().toISOString(),
      }
    }
  )

  /**
   * POST /api/configurations/:id/load - Load a configuration
   * Unloads all current models and loads the saved configuration
   */
  fastify.post<{ Params: { id: string } }>(
    '/api/configurations/:id/load',
    {
      schema: {
        tags: ['configurations'],
        description: 'Load a saved configuration (unloads current models first)',
        params: ConfigIdParamsSchema,
        response: {
          200: LoadConfigurationResponseSchema,
          404: ConfigurationErrorResponseSchema,
          400: ConfigurationErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      const config = store.getConfiguration(id)

      if (!config) {
        return reply.status(404).send({
          error: {
            message: `Configuration not found: ${id}`,
            type: 'not_found',
          },
        })
      }

      if (!config.entries || config.entries.length === 0) {
        return reply.status(400).send({
          error: {
            message: 'Configuration has no model entries',
            type: 'validation_error',
          },
        })
      }

      // Start the load process in background
      setImmediate(async () => {
        try {
          // 1. Unload all current models
          const currentInstances = modelStore.getAll()
          for (const instance of currentInstances) {
            try {
              await modelManager.unloadModel(instance.id)
              fastify.log.info({ instanceId: instance.id }, 'Unloaded model during config load')
            } catch (err) {
              fastify.log.error(
                { err, instanceId: instance.id },
                'Failed to unload model during config load'
              )
            }
          }

          // 2. Load each model from configuration
          for (const entry of config.entries!) {
            try {
              await modelManager.launchModel({
                modelPath: entry.modelPath,
                maxTokens: entry.maxTokens,
                gpuIds: entry.gpuIds,
                tensorParallelSize: entry.tensorParallelSize,
                sourceType: entry.sourceType,
                servedModelName: entry.servedModelName,
                extraArgs: entry.extraArgs,
              })
              fastify.log.info({ modelPath: entry.modelPath }, 'Loaded model from config')
            } catch (err) {
              fastify.log.error(
                { err, modelPath: entry.modelPath },
                'Failed to load model during config load'
              )
            }
          }

          fastify.log.info(
            { configId: id, configName: config.name },
            'Configuration load completed'
          )
        } catch (err) {
          fastify.log.error({ err, configId: id }, 'Configuration load failed')
        }
      })

      return {
        status: 'started' as const,
        configuration_id: id,
        configuration_name: config.name,
        message: `Loading configuration "${config.name}" with ${config.modelCount} models. Current models will be unloaded first.`,
      }
    }
  )
}
