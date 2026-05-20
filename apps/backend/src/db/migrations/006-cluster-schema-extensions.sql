-- Migration 006: Cluster schema extensions for multi-pod orchestration

ALTER TABLE model_configurations ADD COLUMN IF NOT EXISTS placement_strategy TEXT;
ALTER TABLE model_configurations ADD COLUMN IF NOT EXISTS min_kv_cache_mb INTEGER;
ALTER TABLE model_configurations ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE model_configuration_entries ADD COLUMN IF NOT EXISTS gpu_type_constraint TEXT;
ALTER TABLE model_configuration_entries ADD COLUMN IF NOT EXISTS min_vram_mb INTEGER;

ALTER TABLE memory_profiles ADD COLUMN IF NOT EXISTS gpu_type TEXT;
ALTER TABLE memory_profiles ADD COLUMN IF NOT EXISTS gpu_vram_mb INTEGER;
ALTER TABLE memory_profiles ADD COLUMN IF NOT EXISTS source_pod_id TEXT;
