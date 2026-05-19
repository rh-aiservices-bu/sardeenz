-- Migration 006: Cluster schema extensions for School of Sardeenz (004)
-- Extends model_configurations, model_configuration_entries, and memory_profiles
-- with columns needed for declarative presets and cross-pod memory profiling.

-- Track migration
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Model configurations: preset scheduling columns
ALTER TABLE model_configurations ADD COLUMN placement_strategy TEXT;
ALTER TABLE model_configurations ADD COLUMN min_kv_cache_mb INTEGER;
ALTER TABLE model_configurations ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- Model configuration entries: GPU constraint columns
ALTER TABLE model_configuration_entries ADD COLUMN gpu_type_constraint TEXT;
ALTER TABLE model_configuration_entries ADD COLUMN min_vram_mb INTEGER;

-- Memory profiles: cluster context columns
ALTER TABLE memory_profiles ADD COLUMN gpu_type TEXT;
ALTER TABLE memory_profiles ADD COLUMN gpu_vram_mb INTEGER;
ALTER TABLE memory_profiles ADD COLUMN source_pod_id TEXT;

INSERT OR IGNORE INTO schema_migrations (version) VALUES (6);
