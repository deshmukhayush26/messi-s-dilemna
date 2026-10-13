-- migrations/003_featherless_default_model.sql
-- Migration 003: Update default Featherless model from retired 404 model to Meta-Llama-3.1-8B-Instruct
-- Preserves all existing evaluations, submissions, users, and timer records without data loss.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at VARCHAR(64) NOT NULL
);

-- Update admin_config to replace stale 404 model with Meta-Llama-3.1-8B-Instruct
UPDATE admin_config
SET ai_judge_provider = 'featherless',
    ai_judge_model = 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    is_ai_judge_enabled = 1
WHERE id = 'global' AND (
    ai_judge_model IS NULL 
    OR ai_judge_model LIKE '%Llama-3.2-11B-Vision-Instruct%'
    OR ai_judge_provider = 'openai'
);

INSERT INTO schema_migrations (version, applied_at)
VALUES ('003_featherless_default_model', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

COMMIT;
