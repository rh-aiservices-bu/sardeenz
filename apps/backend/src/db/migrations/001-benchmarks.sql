-- Migration 001: LLM Benchmarking & Memory Profiling Tables

CREATE TABLE IF NOT EXISTS benchmark_runs (
  id TEXT PRIMARY KEY,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  mode TEXT NOT NULL,
  kvcached_enabled INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  config_json TEXT NOT NULL,
  error_message TEXT,
  total_requests INTEGER,
  successful_requests INTEGER,
  failed_requests INTEGER,
  duration_seconds REAL
);

CREATE TABLE IF NOT EXISTS benchmark_scenarios (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES benchmark_runs(id) ON DELETE CASCADE,
  instance_id TEXT NOT NULL,
  model_path TEXT NOT NULL,
  model_name TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  concurrency INTEGER NOT NULL,
  warmup_requests INTEGER NOT NULL DEFAULT 3,
  total_requests INTEGER NOT NULL,
  sla_threshold_ms REAL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS benchmark_results (
  id SERIAL PRIMARY KEY,
  scenario_id TEXT NOT NULL REFERENCES benchmark_scenarios(id) ON DELETE CASCADE,
  request_sequence INTEGER NOT NULL,
  is_warmup INTEGER NOT NULL DEFAULT 0,
  ttft_ms REAL,
  total_latency_ms REAL NOT NULL,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  tokens_per_second REAL,
  success INTEGER NOT NULL DEFAULT 1,
  error_message TEXT,
  http_status INTEGER,
  executed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS benchmark_metrics (
  scenario_id TEXT PRIMARY KEY REFERENCES benchmark_scenarios(id) ON DELETE CASCADE,
  ttft_min REAL, ttft_max REAL, ttft_avg REAL,
  ttft_p50 REAL, ttft_p90 REAL, ttft_p95 REAL, ttft_p99 REAL,
  tps_min REAL, tps_max REAL, tps_avg REAL,
  tps_p50 REAL, tps_p90 REAL, tps_p95 REAL, tps_p99 REAL,
  e2e_min REAL, e2e_max REAL, e2e_avg REAL,
  e2e_p50 REAL, e2e_p90 REAL, e2e_p95 REAL, e2e_p99 REAL,
  goodput_count INTEGER,
  goodput_percent REAL,
  sla_threshold_ms REAL,
  kvcache_used_avg_gb REAL,
  kvcache_peak_gb REAL,
  gpu_memory_peak_gb REAL,
  total_requests INTEGER NOT NULL,
  successful_requests INTEGER NOT NULL,
  failed_requests INTEGER NOT NULL,
  requests_per_second REAL,
  tokens_per_second_total REAL
);

CREATE TABLE IF NOT EXISTS memory_profiles (
  id TEXT PRIMARY KEY,
  profile_name TEXT NOT NULL,
  model_path TEXT NOT NULL,
  max_tokens INTEGER NOT NULL,
  weights_memory_gib REAL NOT NULL,
  cuda_graphs_gib REAL NOT NULL,
  kv_cache_available_gib REAL NOT NULL,
  kv_cache_per_request_mib REAL,
  gpu_name TEXT,
  gpu_total_memory_gib REAL,
  comments TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(model_path, max_tokens, gpu_name)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_runs_status ON benchmark_runs(status);
CREATE INDEX IF NOT EXISTS idx_benchmark_runs_created_at ON benchmark_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_benchmark_scenarios_run_id ON benchmark_scenarios(run_id);
CREATE INDEX IF NOT EXISTS idx_benchmark_results_scenario_warmup ON benchmark_results(scenario_id, is_warmup);
CREATE INDEX IF NOT EXISTS idx_memory_profiles_model_path ON memory_profiles(model_path);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
