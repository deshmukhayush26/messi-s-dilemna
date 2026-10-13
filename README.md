# CCG × OpenAI: Inter Miami's Messi Dilemma — Case Competition Platform

A production-ready full-stack case competition evaluation and presentation management platform for the **CCG × OpenAI: Inter Miami's Messi Dilemma** strategy challenge.

---

## 🏛️ System Architecture & 3-Service Deployment Topology

The application is architected into three dedicated microservices with persistent storage:

```
┌─────────────────────────────────┐
│     Vercel (Static / SPA)       │
│  React 19 + TypeScript + Vite   │
│   (Canonical routing, uploads)  │
└────────────────┬────────────────┘
                 │ HTTPS / REST (Configured via VITE_API_URL)
                 ▼
┌────────────────────────────────────────────────────────┐
│               Render (Web Service API)                 │
│                 Node.js / Express                      │
│  - Authoritative Event Timer & Audit Logging           │
│  - Slide-Count Validation (5-6 slides PDF / PPTX)      │
│  - Request-ID Traced Structured Error Handling         │
│  - Centralized API / Admin Dashboard                   │
│  - AI Case Judge Pipeline (OpenAI & Featherless)       │
└───────┬──────────────────────────────┬─────────────────┘
        │ Private Internal REST        │ S3 API
        ▼                              ▼
┌───────────────────────────┐  ┌─────────────────────────┐
│  Render (Python Service)  │  │   Object Storage (S3)   │
│   Gunicorn + Webmail OTP  │  │ Cloudflare R2 / AWS S3  │
│  - URLSafeTimedSerializer │  │ Private presentation    │
│  - HMAC-SHA256 Stateless  │  │ decks & download links  │
│  - Institutional Webmail  │  └─────────────────────────┘
└───────────────┬───────────┘
                │ SMTP / STARTTLS (Port 587)
                ▼
┌───────────────────────────┐
│ Institutional Mail Server │
│ (e.g. smtp-auth.iitb.ac.in)│
└───────────────────────────┘
```

1. **Frontend (Vercel)**: Fast, globally distributed static Vite SPA with canonical client routing (`/`, `/verify-otp`, `/submission`, `/leaderboard`, `/admin`), live countdown sync, centralized API client, and drag-and-drop presentation uploads.
2. **Backend API (Render)**: Node.js/Express service orchestrating timer states, slide inspection, participant sessions, leaderboard scoring, and administrative audit trails.
3. **Webmail OTP Microservice (Render)**: Dedicated Python 3 service wrapping `webmail_otp_sdk.py` running on Gunicorn, ensuring cryptographic fidelity without cross-language runtime overhead.
4. **Persistent Database (Managed PostgreSQL / Persistent SQLite)**: Transaction-safe storage for event countdown states, audit logs, submissions, queue jobs, and evaluation records.
5. **Private Object Storage**: S3-compatible cloud storage (Cloudflare R2 or AWS S3) for presentation decks with time-limited authenticated download URLs (`/api/submissions/:id/download`).

---

## 🌐 Canonical Application Routes

The frontend exposes the following clean production paths:

| Path | Access Level | Description |
| :--- | :--- | :--- |
| `/` | Public | Main landing page & student institutional roll-number entry |
| `/verify-otp` | Public / Pending | 6-digit Webmail OTP verification screen |
| `/submission` | Authenticated | Problem brief, presentation upload, evaluation guidelines, submission modal |
| `/submision` | Redirect | Automatically redirects legacy typos to `/submission` |
| `/leaderboard` | Public | Real-time standings with public scores and team names |
| `/admin` | Protected (Organizer) | Passkey-protected organizer command center, timer controls, AI judge config, token ledger |
| `/docs` | Public / Informational | API and competition documentation overview |
| `/health` | Public | API health probe (`/health` and `/api/health`) |
| `*` | Public | Clean 404 Not Found screen with return-to-home navigation |

---

## 🔑 Key Features & Production Hardening

### 1. Webmail OTP Authentication & Open Participation
- **Zero Pre-Registration Barrier**: Every student with a valid institutional roll number (e.g., `23B1234`, `22M0456`) can participate immediately.
- **Stateless Cryptographic Challenge**: Uses `URLSafeTimedSerializer` with HMAC-SHA256 constant-time hash comparisons (`compare_digest`).
- **Normalized Roll Numbers**: Automatically normalized to uppercase on login.
- **Idempotent User Records**: Re-authenticating reuses the existing participant account without creating duplicates.
- **No Mock Auth in Production**: Development bypass (`DEV_BYPASS_OTP=true`) is strictly disabled in production.

### 2. Event-Wide Authoritative Countdown Timer
- **Authoritative Server Timing**: Time is computed against UTC timestamps (`end_timestamp - Date.now()`).
- **Survives Restarts**: Timer state and remaining seconds persist across backend restarts and redeployments.
- **Pause & Resume**: Paused time freezes remaining duration; time extensions (+5m, +15m) work both while running and while paused.
- **Submission Guard**: Submissions are strictly rejected at the backend if the timer is not running (`not_started`, `paused`, or `expired`).
- **Action Audit History**: Every start, pause, time extension, and reset is logged in `timer_action_log` with organizer attribution.

### 3. Presentation Requirements: 5–6 Slides, No Arbitrary File Cap
- **Strict 6-Slide Maximum**: Decks with 7 or more slides are strictly rejected with an actionable error.
- **Target Size**: Designed for 5–6 slide executive consulting decks.
- **Deep Document Inspection**:
  - **PDF**: Verified using `pdf-lib` to count actual rendered pages. Malformed or encrypted files are safely caught.
  - **PPTX**: Verified using `jszip` to inspect OpenXML presentation structure (`ppt/presentation.xml` and `ppt/slides/slide*.xml`). Non-slide components (speaker notes, slide masters, slide layouts, embedded media) are strictly excluded from the slide count.
- **Private Storage**: Stored privately (via S3 or persistent volume disk) and accessed only via authenticated download endpoints.

### 4. Robust Centralized API Client & Tracing
- **Configurable Base URL**: Reads `VITE_API_URL` for multi-domain hosting (Vercel + Render) with automatic fallback for local proxying.
- **Multipart Uploads**: Automatically omits `Content-Type` on `FormData` uploads so browsers populate the multipart boundary correctly.
- **Structured Error Tracing**: Backend injects `X-Request-Id` headers and logs request durations; client surfaces safe, actionable error messages.

### 5. AI Case Judge Pipeline (OpenAI & Featherless)
- **Opt-In Production Activation**: Real judging is disabled by default (`AI_JUDGE_ENABLED=false`).
- **Provider-Independent Architecture**: Seamlessly switch between official **OpenAI** (e.g., `gpt-4o`) and **Featherless AI** (OpenAI-compatible vision models).
- **Deterministic 5-Criterion Rubric**:
  1. *Problem Structuring & Understanding* (20%)
  2. *Analytical Rigor & Evidence* (25%)
  3. *Strategic Insight & Originality* (25%)
  4. *Feasibility & Business Impact* (20%)
  5. *Communication & Storytelling* (10%)
- **Score Calculation**: Computed in application code (`overall_score = sum((rating / 5) * weight)`).
- **Budget Hard-Stop**: Atomic budget reservations prevent exceeding `AI_JUDGE_BUDGET_USD`.
- **Human Overrides**: Historical evaluation versions preserved in `evaluation_history` with organizer override capabilities.

---

## 🛠️ Local Development Setup

### Prerequisites
- **Node.js**: v20+ or v24+
- **Python**: v3.9+ with `pip`
- **npm**: v10+

### Step 1: Install Dependencies
```bash
# Install Node dependencies
npm install

# Install Python microservice dependencies
pip install -r requirements.txt
```

### Step 2: Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Ensure `.env` contains:
```env
PORT=3001
VITE_API_URL=
OTP_SERVICE_URL=http://127.0.0.1:5001
OTP_PORT=5001
ORGANIZER_SECRET_KEY=ccg-admin-2026
DEV_BYPASS_OTP=false
```

> **Simulated Mail Delivery in Local Development**: When `SMTP_USER` and `SMTP_PASS` are blank, the Python OTP microservice simulates delivery by printing the 6-digit OTP code directly to the terminal console (`[OTP Service Simulated Mail] Delivering OTP [XXXXXX] to ...`). This allows full testing without an institutional email account.

### Step 3: Run the Full Application
```bash
# Starts Python OTP (5001) + Node API (3001) + Vite Frontend (3000) concurrently
npm run dev:full
```

Access the application at:
- **Frontend**: [http://localhost:3000](http://localhost:3000)
- **Node Backend API**: [http://localhost:3001](http://localhost:3001)
- **Python OTP Service**: [http://localhost:5001](http://localhost:5001)

### Step 4: Run the Quality Checks
```bash
# Run TypeScript compilation
npm run build

# Run Oxlint linter
npm run lint

# Run full 81-test automated suite
npm test
```

---

## 🗄️ Database Management & Migration

### Database Options
1. **SQLite (Local Development / Persistent Disk)**: Default in `data/app.db`. Thread-safe, transaction-safe, and zero configuration.
2. **Managed PostgreSQL (Production / Render Postgres)**: Recommended for enterprise production deployments.

### Running PostgreSQL Migration
To migrate your existing SQLite database to a production PostgreSQL database:
```bash
DATABASE_URL="postgresql://user:password@hostname:5432/dbname" npx tsx scripts/migrate_to_postgres.ts
```
The migration script will:
1. Apply `migrations/001_initial_schema.sql` to create all tables and indexes.
2. Transfer all users, submissions, evaluations, timer states, audit logs, and history inside an ACID transaction.
3. Verify data integrity and report record counts.

### Database Backup & Restore
```bash
# Create a timestamped JSON backup in data/backups/
npx tsx scripts/backup_db.ts

# Restore from a backup file
npx tsx scripts/restore_db.ts data/backups/ccg_backup_<timestamp>.json
```

---

## 🚀 Step-by-Step Production Deployment Guide

### Required Accounts to Create
1. **GitHub**: To host your private code repository.
2. **Render** ([render.com](https://render.com)): To host the Node Express backend API, the Python OTP microservice, and the Managed PostgreSQL database.
3. **Vercel** ([vercel.com](https://vercel.com)): To host the React Vite frontend SPA.
4. **Cloudflare R2** or **AWS S3** (Optional): For private presentation deck storage.
5. **OpenAI** or **Featherless AI** (Optional): For live AI judging.

---

### Step 1: Push Code to GitHub
Initialize git and push the repository:
```bash
git init
git add .
git commit -m "feat: production-ready CCG competition platform"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo-name>.git
git push -u origin main
```
*(Notice: `.gitignore` protects your `.env`, local database, and uploaded presentations from being tracked).*

---

### Step 2: Deploy Backend & Database on Render

You can deploy the backend services using Render's Blueprint or manually:

#### Option A: Using `render.yaml` Blueprint (Recommended)
1. Go to the **Render Dashboard** ➔ Click **New +** ➔ **Blueprint**.
2. Connect your GitHub repository.
3. Render reads `render.yaml` and will automatically configure:
   - **`ccg-postgres`**: Managed PostgreSQL database.
   - **`ccg-case-backend`**: Node.js Web Service.
   - **`ccg-webmail-otp-service`**: Python Web Service.
4. In the Render Dashboard, fill in any secret environment variables marked `sync: false`:
   - `ORGANIZER_SECRET_KEY`: High-entropy string (must be set; default placeholder rejected in production).
   - `SMTP_USER`: Institutional email ID.
   - `SMTP_PASS`: Institutional email password.
5. Click **Apply**.

#### Database Migration & Snapshot Commands
To migrate local SQLite data to production PostgreSQL:
```bash
# 1. Take a verified pre-migration snapshot
npx tsx scripts/backup_db.ts

# 2. Test migration in dry-run mode (verifies schema, excludes seeds, reports reconciliation without persisting)
DATABASE_URL="<your-render-postgres-url>" npx tsx scripts/migrate_to_postgres.ts --dry-run

# 3. Execute live atomic migration
DATABASE_URL="<your-render-postgres-url>" npx tsx scripts/migrate_to_postgres.ts

# 4. If rollback is ever required:
npx tsx scripts/restore_db.ts data/backups/ccg_backup_<timestamp>.json
```

#### Option B: Manual Web Service Setup
1. **Create PostgreSQL Database**:
   - Click **New +** ➔ **PostgreSQL**.
   - Name: `ccg-postgres`, Database: `ccg_competition`.
   - Copy the **Internal Database URL**.
2. **Create Python OTP Microservice**:
   - Click **New +** ➔ **Web Service**.
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn otp_server:app --bind 0.0.0.0:$PORT`
   - Environment variables:
     - `DEV_BYPASS_OTP`: `false`
     - `SMTP_HOST`: `smtp-auth.iitb.ac.in`
     - `SMTP_PORT`: `587`
     - `SMTP_USER`: `<your-smtp-user>`
     - `SMTP_PASS`: `<your-smtp-password>`
     - `FLASK_SECRET`: `<secure-hex-key>`
     - `OTP_SERVICE_SHARED_SECRET`: `<shared-secret-key>`
   - Copy the service address (e.g., `https://ccg-webmail-otp-service.onrender.com`).
3. **Create Node API Service**:
   - Click **New +** ➔ **Web Service**.
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment variables:
     - `NODE_ENV`: `production`
     - `PORT`: `3001`
     - `DATABASE_URL`: `<Render-PostgreSQL-Internal-URL>`
     - `OTP_SERVICE_URL`: `<Python-OTP-Service-Address>`
     - `OTP_SERVICE_SHARED_SECRET`: `<shared-secret-key>`
     - `ORGANIZER_SECRET_KEY`: `<your-organizer-key>`
     - `CLIENT_ORIGIN`: `https://<your-vercel-app>.vercel.app`
     - `AI_JUDGE_ENABLED`: `false`

---

### Step 3: Deploy Frontend on Vercel

1. Log in to **Vercel** ➔ Click **Add New...** ➔ **Project**.
2. Import your GitHub repository.
3. Configure Project Settings:
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Environment Variables:
   - `VITE_API_URL`: The public URL of your Render Node backend (e.g. `https://ccg-case-backend.onrender.com`).
5. Click **Deploy**.
6. Once deployed, copy your Vercel deployment URL (e.g. `https://ccg-case.vercel.app`) and update the `CLIENT_ORIGIN` variable in your Render backend service.

---

### Step 4: Live Email Verification Procedure

To verify real email delivery using your institutional Webmail credentials:
1. Ensure `SMTP_USER` and `SMTP_PASS` are configured on the Python OTP service.
2. In a browser or via `curl`, initiate an OTP challenge for your student roll number:
   ```bash
   curl -X POST https://ccg-case-backend.onrender.com/api/auth/send-otp \
     -H "Content-Type: application/json" \
     -d '{"rollNumber": "23B1234", "name": "Your Name"}'
   ```
3. Check your institutional inbox (`student_id@iitb.ac.in`) for the 6-digit OTP code.
4. Verify the OTP on the login screen or via API:
   ```bash
   curl -X POST https://ccg-case-backend.onrender.com/api/auth/verify-otp \
     -H "Content-Type: application/json" \
     -d '{"otpToken": "<token-from-step-2>", "otpCode": "<6-digit-code>"}'
   ```
5. Confirm that a valid `authToken` is returned.

---

### Step 5: Controlled AI Judging Activation Pilot

1. **Keep judging disabled** (`AI_JUDGE_ENABLED=false`) during initial setup.
2. Before the competition, set provider credentials:
   - `AI_PROVIDER=openai`
   - `OPENAI_API_KEY=sk-...`
   - `AI_JUDGE_BUDGET_USD=25.0`
3. Access `/admin` using your organizer passkey.
4. In the **AI Judge Configuration** panel, click **Test Provider Connection** to verify API keys and vision model connectivity.
5. Trigger a pilot evaluation on a single sample deck and inspect the generated slide rationales, criteria scores, and cost ledger.
6. Once satisfied, enable the **Master AI Judge Toggle** for the event.

---

## 🚨 Incident Recovery & Rollback Procedures

### 1. Database Rollback
- Backups are stored in `data/backups/`.
- If an operational error occurs, restore the snapshot using:
  ```bash
  npx tsx scripts/restore_db.ts data/backups/ccg_backup_<timestamp>.json
  ```

### 2. Emergency Timer Freeze
- If a technical difficulty arises during the live event, organizers can instantly pause the countdown in `/admin` via the **Pause Timer** button.
- Submissions will be automatically suspended while participants resolve issues.

### 3. AI Judge Budget Stop
- If OpenAI or Featherless costs approach the threshold, the backend halts automated evaluations atomically and marks remaining queue jobs as `needs_review`.
- No additional provider charges will be incurred. Organizers can adjudicate scores manually in `/admin`.
