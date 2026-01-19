-- Migration 005: Add sleep_mode_enabled to model configuration entries
-- Tracks whether sleep mode should be enabled when loading models from a configuration

ALTER TABLE model_configuration_entries ADD COLUMN sleep_mode_enabled INTEGER DEFAULT 0;

-- Mark this migration as applied
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (5, datetime('now'));
