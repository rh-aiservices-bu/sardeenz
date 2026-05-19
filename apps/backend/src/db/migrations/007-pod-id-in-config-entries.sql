-- Migration 007: Add pod_id to model_configuration_entries
-- Enables cluster-aware save/load: each entry records which pod it should run on.

ALTER TABLE model_configuration_entries ADD COLUMN pod_id TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (7);
