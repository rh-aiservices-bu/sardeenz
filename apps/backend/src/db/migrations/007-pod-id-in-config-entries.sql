-- Migration 007: Add pod_id to model_configuration_entries

ALTER TABLE model_configuration_entries ADD COLUMN IF NOT EXISTS pod_id TEXT;
