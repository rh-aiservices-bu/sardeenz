-- Migration 002: Add routing_mode column to benchmark_scenarios
-- Created: 2025-12-01
--
-- Adds support for per-scenario routing mode (direct vLLM vs proxy)

-- Add routing_mode column with default 'direct' for backward compatibility
ALTER TABLE benchmark_scenarios ADD COLUMN routing_mode TEXT NOT NULL DEFAULT 'direct';

-- Mark this migration as applied
INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, datetime('now'));
