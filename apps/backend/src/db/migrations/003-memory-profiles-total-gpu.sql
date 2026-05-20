-- Migration 003: Add total_gpu_memory_gib and overhead_memory_gib to memory_profiles

ALTER TABLE memory_profiles ADD COLUMN IF NOT EXISTS total_gpu_memory_gib REAL;
ALTER TABLE memory_profiles ADD COLUMN IF NOT EXISTS overhead_memory_gib REAL;

UPDATE memory_profiles
SET total_gpu_memory_gib = weights_memory_gib + cuda_graphs_gib,
    overhead_memory_gib = 0
WHERE total_gpu_memory_gib IS NULL;
