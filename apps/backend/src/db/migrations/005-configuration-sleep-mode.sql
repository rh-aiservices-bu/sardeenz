-- Migration 005: Add sleep_mode_enabled to model configuration entries

ALTER TABLE model_configuration_entries ADD COLUMN IF NOT EXISTS sleep_mode_enabled INTEGER DEFAULT 0;
