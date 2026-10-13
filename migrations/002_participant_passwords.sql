-- migrations/002_participant_passwords.sql
-- Safe migration for password-based participant authentication and Featherless AI judging.
-- Preserves all existing submissions, users, evaluations, and timer records without data loss.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(64) PRIMARY KEY,
    applied_at VARCHAR(64) NOT NULL
);

-- Add password_hash and email to users table safely
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Update default admin config to Featherless and enable AI judge
UPDATE admin_config
SET ai_judge_provider = 'featherless',
    ai_judge_model = 'meta-llama/Llama-3.2-11B-Vision-Instruct',
    is_ai_judge_enabled = 1
WHERE id = 'global';

INSERT INTO schema_migrations (version, applied_at)
VALUES ('002_participant_passwords', CURRENT_TIMESTAMP)
ON CONFLICT (version) DO NOTHING;

COMMIT;
