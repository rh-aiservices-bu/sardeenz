/**
 * TypeBox Validation Schemas for Model Configuration Save/Load
 */

import { Type, Static } from '@sinclair/typebox'
import { ConfigurationLoadStatus } from '../model-configuration.js'

// Enum schema
export const ConfigurationLoadStatusSchema = Type.Enum(ConfigurationLoadStatus)

// Entry schema for API responses (snake_case)
export const ModelConfigurationEntrySchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  config_id: Type.String({ format: 'uuid' }),
  model_path: Type.String(),
  served_model_name: Type.Optional(Type.String()),
  max_tokens: Type.Integer(),
  source_type: Type.Union([Type.Literal('huggingface'), Type.Literal('local')]),
  extra_args: Type.Optional(Type.Array(Type.String())),
  gpu_ids: Type.Optional(Type.Array(Type.Integer())),
  tensor_parallel_size: Type.Integer(),
  load_order: Type.Integer(),
  sleep_mode_enabled: Type.Optional(Type.Boolean()),
  pod_id: Type.Optional(Type.String()),
})

// Configuration schema for API responses
export const SavedModelConfigurationSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  description: Type.Optional(Type.String()),
  model_count: Type.Integer(),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.Optional(Type.String({ format: 'date-time' })),
  entries: Type.Optional(Type.Array(ModelConfigurationEntrySchema)),
})

// Create configuration request
export const CreateModelConfigurationRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
})

// Update configuration request
export const UpdateModelConfigurationRequestSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
})

// Response schemas
export const ListModelConfigurationsResponseSchema = Type.Object({
  configurations: Type.Array(SavedModelConfigurationSchema),
  total: Type.Integer(),
})

export const GetModelConfigurationResponseSchema = Type.Object({
  configuration: SavedModelConfigurationSchema,
})

export const DeleteModelConfigurationResponseSchema = Type.Object({
  status: Type.Literal('success'),
  id: Type.String({ format: 'uuid' }),
  deleted_at: Type.String({ format: 'date-time' }),
})

// Load configuration progress schema
export const ConfigurationLoadProgressSchema = Type.Object({
  status: ConfigurationLoadStatusSchema,
  total_models: Type.Integer(),
  models_unloaded: Type.Integer(),
  models_loaded: Type.Integer(),
  current_model: Type.Optional(Type.String()),
  errors: Type.Array(Type.String()),
})

export const LoadConfigurationResponseSchema = Type.Object({
  status: Type.Literal('started'),
  configuration_id: Type.String({ format: 'uuid' }),
  configuration_name: Type.String(),
  message: Type.String(),
  skipped_pods: Type.Optional(Type.Array(Type.String())),
  loaded_model_count: Type.Optional(Type.Integer()),
})

// Error response schema (reuse from existing if available)
export const ConfigurationErrorResponseSchema = Type.Object({
  error: Type.Object({
    message: Type.String(),
    type: Type.String(),
  }),
})

// Type exports
export type ModelConfigurationEntryDTO = Static<typeof ModelConfigurationEntrySchema>
export type SavedModelConfigurationDTO = Static<typeof SavedModelConfigurationSchema>
export type CreateModelConfigurationRequest = Static<typeof CreateModelConfigurationRequestSchema>
export type UpdateModelConfigurationRequest = Static<typeof UpdateModelConfigurationRequestSchema>
export type ListModelConfigurationsResponse = Static<typeof ListModelConfigurationsResponseSchema>
export type GetModelConfigurationResponse = Static<typeof GetModelConfigurationResponseSchema>
export type DeleteModelConfigurationResponse = Static<typeof DeleteModelConfigurationResponseSchema>
export type ConfigurationLoadProgressDTO = Static<typeof ConfigurationLoadProgressSchema>
export type LoadConfigurationResponse = Static<typeof LoadConfigurationResponseSchema>
