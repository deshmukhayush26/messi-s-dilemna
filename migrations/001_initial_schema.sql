-- migrations/001_initial_schema.sql
-- Production PostgreSQL schema for CCG × OpenAI Competition Platform
-- Supports users, submissions, evaluations, timer, audit logs, queue jobs, and evaluation history.

BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    roll_number VARCHAR(64) NOT NULL UNIQUE,
    role VARCHAR(32) NOT NULL DEFAULT 'participant',
    last_login_at VARCHAR(64),
    created_at VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_roll ON users(roll_number);

CREATE TABLE IF NOT EXISTS submissions (
    id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_name VARCHAR(255) NOT NULL,
    submission_name VARCHAR(255) NOT NULL,
    deck_file_name VARCHAR(255),
    deck_file_url TEXT,
    storage_key VARCHAR(512),
    file_type VARCHAR(32),
    file_size BIGINT DEFAULT 0,
    slide_count INT DEFAULT 0,
    submission_duration_sec INT DEFAULT 0,
    notes TEXT,
    review_status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, accepted, rejected, on_hold
    is_published INT NOT NULL DEFAULT 1,                  -- 1 = published, 0 = hidden
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_user_id ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_status_pub ON submissions(review_status, is_published);

CREATE TABLE IF NOT EXISTS evaluations (
    id VARCHAR(64) PRIMARY KEY,
    submission_id VARCHAR(64) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    evaluation_version VARCHAR(64) NOT NULL DEFAULT 'v1',
    evaluation_status VARCHAR(32) NOT NULL DEFAULT 'completed', -- mock_evaluated, placeholder, completed, failed
    overall_score INT NOT NULL DEFAULT 50,
    problem_structuring_score INT NOT NULL DEFAULT 50,
    analytical_rigor_score INT NOT NULL DEFAULT 50,
    strategic_insight_score INT NOT NULL DEFAULT 50,
    feasibility_impact_score INT NOT NULL DEFAULT 50,
    communication_score INT NOT NULL DEFAULT 50,
    ai_rationale TEXT,
    strengths TEXT,
    weaknesses TEXT,
    evidence TEXT,
    is_mock INT NOT NULL DEFAULT 0,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    total_tokens INT NOT NULL DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0.00,
    provider VARCHAR(64) DEFAULT 'openai',
    model VARCHAR(128) DEFAULT 'gpt-4o',
    cached_tokens INT DEFAULT 0,
    reasoning_tokens INT DEFAULT 0,
    provider_request_id VARCHAR(128),
    executive_summary TEXT,
    recommendation TEXT,
    assumptions_and_risks TEXT,
    actionable_feedback TEXT,
    criterion_scores_json TEXT,
    confidence NUMERIC(4, 2) DEFAULT 1.0,
    needs_human_review INT DEFAULT 0,
    review_flags TEXT,
    human_reviewer_id VARCHAR(64),
    human_override_score INT,
    human_override_reason TEXT,
    human_reviewed_at VARCHAR(64),
    attempt_number INT DEFAULT 1,
    created_at VARCHAR(64) NOT NULL,
    CONSTRAINT uq_sub_version UNIQUE (submission_id, evaluation_version)
);

CREATE INDEX IF NOT EXISTS idx_evaluations_submission_id ON evaluations(submission_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token VARCHAR(255) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(32) NOT NULL,
    is_mock INT NOT NULL DEFAULT 0,
    created_at VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);

CREATE TABLE IF NOT EXISTS admin_config (
    id VARCHAR(64) PRIMARY KEY,
    app_token_budget INT NOT NULL DEFAULT 500000,
    is_ai_judge_enabled INT NOT NULL DEFAULT 0,
    leaderboard_visibility VARCHAR(32) NOT NULL DEFAULT 'all',
    enforce_min_slides INT NOT NULL DEFAULT 0,
    ai_judge_provider VARCHAR(64) NOT NULL DEFAULT 'openai',
    ai_judge_model VARCHAR(128) NOT NULL DEFAULT 'gpt-4o',
    ai_judge_rubric_version VARCHAR(64) NOT NULL DEFAULT 'v1',
    ai_judge_max_concurrency INT NOT NULL DEFAULT 2,
    ai_judge_max_retries INT NOT NULL DEFAULT 3,
    ai_judge_budget_usd NUMERIC(10, 2) NOT NULL DEFAULT 50.0,
    ai_judge_spent_usd NUMERIC(10, 4) NOT NULL DEFAULT 0.0,
    feedback_release_mode VARCHAR(32) NOT NULL DEFAULT 'immediate',
    created_at VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS event_timer (
    id VARCHAR(64) PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'not_started', -- not_started, running, paused, expired
    initial_duration_sec INT NOT NULL DEFAULT 3600,
    remaining_duration_sec INT NOT NULL DEFAULT 3600,
    start_timestamp VARCHAR(64),
    end_timestamp VARCHAR(64),
    last_updated_at VARCHAR(64) NOT NULL,
    last_updated_by VARCHAR(255) NOT NULL DEFAULT 'Lead Case Coordinator',
    version INT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS timer_action_log (
    id VARCHAR(64) PRIMARY KEY,
    organizer_id VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    duration_added_sec INT DEFAULT 0,
    previous_state VARCHAR(32) NOT NULL,
    new_state VARCHAR(32) NOT NULL,
    timestamp VARCHAR(64) NOT NULL,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_timer_log_timestamp ON timer_action_log(timestamp);

CREATE TABLE IF NOT EXISTS evaluation_jobs (
    id VARCHAR(64) PRIMARY KEY,
    submission_id VARCHAR(64) NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending, processing, evaluated, needs_review, failed, cancelled
    provider VARCHAR(64) NOT NULL DEFAULT 'openai',
    model VARCHAR(128),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    error_message TEXT,
    created_at VARCHAR(64) NOT NULL,
    updated_at VARCHAR(64) NOT NULL,
    completed_at VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_status ON evaluation_jobs(status);
CREATE INDEX IF NOT EXISTS idx_eval_jobs_sub_id ON evaluation_jobs(submission_id);

CREATE TABLE IF NOT EXISTS evaluation_history (
    id VARCHAR(64) PRIMARY KEY,
    evaluation_id VARCHAR(64) NOT NULL,
    submission_id VARCHAR(64) NOT NULL,
    version VARCHAR(64) NOT NULL,
    provider VARCHAR(64),
    model VARCHAR(128),
    overall_score INT NOT NULL,
    scores_json TEXT,
    rationale TEXT,
    total_tokens INT DEFAULT 0,
    estimated_cost_usd NUMERIC(10, 4) DEFAULT 0.0,
    created_at VARCHAR(64) NOT NULL,
    archived_at VARCHAR(64) NOT NULL,
    archive_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_eval_history_sub ON evaluation_history(submission_id);

COMMIT;
