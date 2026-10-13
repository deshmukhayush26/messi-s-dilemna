# CCG × OpenAI: Inter Miami's Messi Dilemma — Case Competition Platform

A production-ready full-stack case competition evaluation and presentation management platform for the **CCG × OpenAI: Inter Miami's Messi Dilemma** strategy challenge.

---

## 🏛️ System Architecture & Production Deployment Topology

The application is architected into a resilient modern web stack:

```
┌─────────────────────────────────┐
│     Vercel (Static / SPA)       │
│  React 19 + TypeScript + Vite   │
│   (Canonical routing, uploads)  │
└────────────────┬────────────────┘
                 │ HTTPS / REST (Configured via VITE_API_URL or Vercel /api rewrites)
                 ▼
┌────────────────────────────────────────────────────────┐
│               Render (Web Service API)                 │
│                 Node.js / Express                      │
│  - Authoritative Event Timer & Audit Logging           │
│  - Slide-Count Validation (5-6 slides PDF / PPTX)      │
│  - Participant Password Auth (scrypt HMAC)             │
│  - Dedicated Organizer Passkey Portal                  │
│  - Featherless AI Judge Pipeline                       │
│    (meta-llama/Meta-Llama-3.1-8B-Instruct)             │
└───────┬──────────────────────────────┬─────────────────┘
        │ PostgreSQL Connection        │ S3 / R2 API
        ▼                              ▼
┌───────────────────────────┐  ┌─────────────────────────┐
│     Render PostgreSQL     │  │   Object Storage (S3)   │
│   Persistent Relational   │  │ Cloudflare R2 / AWS S3  │
│   Database with Migrations│  │ Private presentation    │
│                           │  │ decks & download links  │
└───────────────────────────┘  └─────────────────────────┘
```

1. **Frontend (Vercel)**: Fast, globally distributed static Vite SPA with canonical client routing (`/`, `/submission`, `/leaderboard`, `/admin`), live countdown sync, centralized API client, and presentation deck uploads. Requests to `/api/*` are transparently proxied to Render.
2. **Backend API (Render)**: Node.js/Express service orchestrating timer states, slide inspection, password-based participant accounts, organizer access control, leaderboard scoring, and Featherless AI evaluations.
3. **Persistent Database (Managed PostgreSQL)**: Relational database with versioned migrations (`migrations/001_initial_schema.sql`, `migrations/002_participant_passwords.sql`, `migrations/003_featherless_default_model.sql`) tracking event countdown states, audit logs, submissions, and evaluations.
4. **Featherless AI Judging Pipeline**: Real LLM evaluation using `meta-llama/Meta-Llama-3.1-8B-Instruct` (with `FEATHERLESS_MODEL` env override support) to assess submissions against the 5-criterion case rubric. Placeholder score-50 logic is completely removed.

---

## 🌐 Canonical Application Routes

The platform exposes the following clean production routes:

| Path | Access Level | Description |
| :--- | :--- | :--- |
| `/` | Public | Main sign-in and account registration portal for participants |
| `/submission` | Authenticated | Case brief, presentation upload, evaluation guidelines, submission modal |
| `/leaderboard` | Public | Real-time standings with public scores and team names |
| `/admin` | Protected (Organizer) | Passkey-protected organizer command center, timer controls, AI judge config, token ledger |
| `/docs` | Public / Informational | API and competition documentation overview |
| `/health` | Public | API health probe (`/health` and `/api/health`) reporting DB and AI judge status |
| `*` | Public | Clean 404 Not Found screen with return-to-home navigation |

---

## 🔑 Key Features & Security Architecture

### 1. Secure Password Authentication & Account Provisioning
- **Self-Service Registration**: Participants register with student roll number, full name, and password (minimum 8 characters).
- **Cryptographic Password Hashing**: Passwords are securely hashed with Node.js built-in `crypto.scryptSync` (salt + 64-byte key). No external binary native dependencies required.
- **Timing Attack Resistance**: Verification uses `crypto.timingSafeEqual`.
- **Session Tokens**: Sessions are persisted in the database and validated via `Bearer` tokens and `HttpOnly` cookies.

### 2. Dedicated Organizer Admin Access
- **Separated Role Authorization**: Organizer access requires a secure passkey (`ORGANIZER_SECRET_KEY`) submitted via `POST /api/auth/admin-login`.
- **Server-Side Role Guard**: Endpoints in `/api/admin/*` enforce `user.role === 'organizer'`.

### 3. Production Featherless AI Case Judge
- **Provider**: Featherless AI (`https://api.featherless.ai/v1`).
- **Model**: `meta-llama/Meta-Llama-3.1-8B-Instruct` (configurable via `FEATHERLESS_MODEL` env var).
- **Rubric Criteria**:
  1. *Problem Structuring & Understanding* (20% weight)
  2. *Analytical Rigor & Evidence* (25% weight)
  3. *Strategic Insight & Originality* (25% weight)
  4. *Feasibility & Business Impact* (20% weight)
  5. *Communication & Storytelling* (10% weight)
- **Zero Mock Scoring**: All placeholder score-50 code is removed. Submissions are judged by the real AI evaluator. If credentials are missing, evaluations fail safely with status `failed` and descriptive error notes, excluding them from the leaderboard.

### 4. Authoritative Event Countdown Timer
- **Server-Authoritative**: Computed against UTC timestamps (`end_timestamp - Date.now()`).
- **Crash-Resilient**: Timer state persists in PostgreSQL across restarts.
- **Submission Guard**: Submissions are strictly rejected if the timer is not in `running` state.
- **Audit History**: All timer events (start, pause, add time, reset) are logged with organizer attribution.

### 5. Document Validation (5–6 Slides)
- **Slide Enforcement**: Decks with more than 6 slides are rejected with actionable feedback.
- **Deep Document Inspection**:
  - **PDF**: Verified using `pdf-lib` to count actual rendered pages.
  - **PPTX**: Verified using `jszip` to inspect OpenXML presentation structure (`ppt/slides/slide*.xml`), excluding notes, masters, and media.

---

## 🚀 Local Development Setup

### 1. Prerequisites
- Node.js 20+ installed
- npm 10+ installed

### 2. Install Dependencies
```bash
npm install
```

### 3. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Provide your `FEATHERLESS_API_KEY` and set `ORGANIZER_SECRET_KEY`.

### 4. Start Development Servers
```bash
npm run dev
```
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3001`

### 5. Run Verification Suite
```bash
npm test
```
Runs the full verification suite covering authentication, timer, presentation parsing, Featherless integration, and API routing.
