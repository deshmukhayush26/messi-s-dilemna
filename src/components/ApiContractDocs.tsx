// src/components/ApiContractDocs.tsx
import React from 'react';
import { Header } from './Header';
import { BookOpen, Key, Cpu, ShieldCheck, CheckCircle2 } from 'lucide-react';

export const ApiContractDocs: React.FC = () => {
  return (
    <div className="docs-screen-wrapper">
      <Header />

      <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
        <div style={{ background: '#ffffff', borderRadius: 24, padding: 36, boxShadow: 'var(--shadow-card)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <BookOpen size={28} color="#f97316" />
            <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 26, fontWeight: 800 }}>
              Production Platform Architecture & API Contracts
            </h2>
          </div>

          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6 }}>
            This platform runs a decoupled architecture with a React single-page frontend hosted on Vercel, an Express API backend with PostgreSQL persistence on Render, and Featherless AI vision judging powered by <code>meta-llama/Llama-3.2-11B-Vision-Instruct</code>.
          </p>
        </div>

        {/* Section 1: AI Evaluation Endpoint Contract */}
        <div style={{ background: '#ffffff', borderRadius: 24, padding: 32, boxShadow: 'var(--shadow-card)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Cpu size={22} color="#f97316" />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 800 }}>
              1. Production AI Evaluation Endpoint Contract (POST /api/evaluations)
            </h3>
          </div>

          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p>
              The evaluation endpoint invokes the real AI judge pipeline. Submissions are parsed, slide visual images are extracted, and rubric criteria are evaluated with full reasoning citations. Placeholder score-50 logic is disabled.
            </p>

            <div style={{ background: '#0f172a', color: '#f8fafc', padding: 18, borderRadius: 14, fontFamily: 'monospace', fontSize: 13 }}>
              <div style={{ color: '#94a3b8', marginBottom: 6 }}>// Request: POST /api/evaluations</div>
              <div style={{ color: '#38bdf8' }}>Headers: Authorization: Bearer &lt;token&gt;</div>
              <pre>{`{
  "submissionId": "sub_12345"
}`}</pre>
            </div>

            <div style={{ background: '#0f172a', color: '#f8fafc', padding: 18, borderRadius: 14, fontFamily: 'monospace', fontSize: 13 }}>
              <div style={{ color: '#94a3b8', marginBottom: 6 }}>// Response: 200 OK (Deterministic Rubric Evaluation)</div>
              <pre>{`{
  "success": true,
  "evaluation": {
    "id": "eval_67890",
    "submissionId": "sub_12345",
    "evaluationStatus": "completed",
    "evaluationVersion": "featherless-meta-llama/Llama-3.2-11B-Vision-Instruct-v1",
    "overallScore": 86,
    "scores": {
      "problemStructuring": 85,
      "analyticalRigor": 88,
      "strategicInsight": 84,
      "feasibilityImpact": 86,
      "communication": 87
    },
    "provider": "featherless",
    "model": "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "aiRationale": "Comprehensive strategic solution addressing the post-Messi commercial transition...",
    "isMock": false
  }
}`}</pre>
            </div>

            <h4 style={{ fontWeight: 700, marginTop: 10 }}>HTTP Error Codes Handled:</h4>
            <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><code>400 Bad Request</code>: Missing or malformed submission ID.</li>
              <li><code>401 Unauthorized</code>: Missing or invalid authentication token.</li>
              <li><code>403 Forbidden</code>: Participant attempting to trigger evaluation for another user's submission.</li>
              <li><code>404 Not Found</code>: Submission ID does not exist in the database.</li>
              <li><code>409 Conflict</code>: Submission is rejected or ineligible for evaluation.</li>
            </ul>
          </div>
        </div>

        {/* Section 2: Password Authentication Protocol */}
        <div style={{ background: '#ffffff', borderRadius: 24, padding: 32, boxShadow: 'var(--shadow-card)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Key size={22} color="#f97316" />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 800 }}>
              2. Participant & Organizer Authentication Protocol
            </h3>
          </div>

          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p>
              Participant accounts are provisioned securely without email OTP dependencies, using cryptographic scrypt password hashing:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> 1. Registration (POST /api/auth/register)
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Participants register with student roll number, name, and password (minimum 8 characters). Passwords are hashed using <code>crypto.scryptSync</code>.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> 2. Login (POST /api/auth/login)
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Participants authenticate with roll number and password. Verification uses <code>crypto.timingSafeEqual</code> to prevent side-channel timing attacks.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> 3. Session Management
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Sessions are tracked via persistent tokens in PostgreSQL and Bearer authorization headers, supported by secure HttpOnly cookies.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <ShieldCheck size={16} color="#f97316" /> 4. Dedicated Organizer Passkey
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Organizer permissions are strictly separated via <code>POST /api/auth/admin-login</code> using <code>ORGANIZER_SECRET_KEY</code>, assigning server-side <code>organizer</code> role.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
