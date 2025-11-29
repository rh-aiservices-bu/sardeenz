-- Migration 003: Add total_gpu_memory_gib and overhead_memory_gib to memory_profiles
-- Created: 2024-12-01
--
-- Previously, memory profiles only stored weights + CUDA graphs from vLLM logs.
-- Now we store actual GPU memory consumption from nvidia-smi as the source of truth.

-- Add new columns for actual GPU memory tracking
ALTER TABLE memory_profiles ADD COLUMN total_gpu_memory_gib REAL;
ALTER TABLE memory_profiles ADD COLUMN overhead_memory_gib REAL;

-- Backfill existing rows with best approximation
-- (Real values should be obtained by re-profiling models)
UPDATE memory_profiles
SET total_gpu_memory_gib = weights_memory_gib + cuda_graphs_gib,
    overhead_memory_gib = 0
WHERE total_gpu_memory_gib IS NULL;

-- Mark this migration as applied
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (3, datetime('now'));
