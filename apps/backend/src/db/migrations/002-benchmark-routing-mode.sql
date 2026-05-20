-- Migration 002: Add routing_mode column to benchmark_scenarios

ALTER TABLE benchmark_scenarios ADD COLUMN IF NOT EXISTS routing_mode TEXT NOT NULL DEFAULT 'direct';
