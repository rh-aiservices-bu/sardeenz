-- Migration 004: Model Configurations Save/Load

CREATE TABLE IF NOT EXISTS model_configurations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  model_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS model_configuration_entries (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL REFERENCES model_configurations(id) ON DELETE CASCADE,
  model_path TEXT NOT NULL,
  served_model_name TEXT,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  source_type TEXT NOT NULL DEFAULT 'huggingface',
  extra_args TEXT,
  gpu_ids TEXT,
  tensor_parallel_size INTEGER DEFAULT 1,
  load_order INTEGER NOT NULL,
  UNIQUE(config_id, load_order)
);

CREATE INDEX IF NOT EXISTS idx_model_configurations_name ON model_configurations(name);
CREATE INDEX IF NOT EXISTS idx_model_configurations_created_at ON model_configurations(created_at);
CREATE INDEX IF NOT EXISTS idx_model_configuration_entries_config_id ON model_configuration_entries(config_id);
