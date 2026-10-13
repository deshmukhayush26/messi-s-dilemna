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
              Temporary MVP Mode Architecture & Integration Contracts
            </h2>
          </div>

          <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6 }}>
            This application is structured to decouple frontend screens, data models, and database flows from the underlying authentication provider (OTP SDK) and AI evaluation model (OpenAI GPT-4o).
          </p>
        </div>

        {/* Section C: AI Evaluation Endpoint Contract */}
        <div style={{ background: '#ffffff', borderRadius: 24, padding: 32, boxShadow: 'var(--shadow-card)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Cpu size={22} color="#f97316" />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 800 }}>
              1. Future AI Evaluation Endpoint Contract (POST /api/evaluations)
            </h3>
          </div>

          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p>
              The evaluation endpoint adheres to a strict server-side contract. Clients cannot supply or manipulate authoritative evaluation scores.
            </p>

            <div style={{ background: '#0f172a', color: '#f8fafc', padding: 18, borderRadius: 14, fontFamily: 'monospace', fontSize: 13 }}>
              <div style={{ color: '#94a3b8', marginBottom: 6 }}>// Request: POST /api/evaluations</div>
              <div style={{ color: '#38bdf8' }}>Headers: Authorization: Bearer &lt;token&gt;</div>
              <pre>{`{
  "submissionId": "sub_12345"
}`}</pre>
            </div>

            <div style={{ background: '#0f172a', color: '#f8fafc', padding: 18, borderRadius: 14, fontFamily: 'monospace', fontSize: 13 }}>
              <div style={{ color: '#94a3b8', marginBottom: 6 }}>// Response: 200 OK (Idempotent)</div>
              <pre>{`{
  "success": true,
  "evaluationId": "eval_67890",
  "submissionId": "sub_12345",
  "status": "mock_evaluated",
  "evaluationVersion": "mock-v1",
  "overallScore": 50,
  "scores": {
    "problemStructuring": 50,
    "analyticalRigor": 50,
    "strategicInsight": 50,
    "feasibilityImpact": 50,
    "communication": 50
  },
  "isMock": true,
  "modeNotice": "Mock scoring — AI judge not enabled",
  "tokenUsage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "costUsd": 0.00
  },
  "createdAt": "2026-10-12T17:30:00.000Z"
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

        {/* Section F: Future OTP SDK Integration Guide */}
        <div style={{ background: '#ffffff', borderRadius: 24, padding: 32, boxShadow: 'var(--shadow-card)', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <Key size={22} color="#f97316" />
            <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 800 }}>
              2. Future OTP SDK Integration Protocol
            </h3>
          </div>

          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p>
              The authentication architecture is isolated behind <code>IAuthService</code> in <code>server/services/authService.ts</code>:
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> 1. Client Initialization
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Instantiate the provider SDK inside <code>OtpSdkAuthService</code> constructor with environment credentials (API key, App ID).
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> 2. Dispatch OTP Request
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  In <code>initiateAuth()</code>, trigger the provider's dispatch method and receive an opaque session requestId to pass to the OTP verification screen.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <CheckCircle2 size={16} color="#16a34a" /> 3. Verification & Session
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  In <code>verifyOtp()</code>, validate the 6-digit code with the SDK, map the verified student roll number to the <code>users</code> table, and issue the session token.
                </p>
              </div>

              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 14, border: '1px solid #e2e8f0' }}>
                <strong style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#0f172a' }}>
                  <ShieldCheck size={16} color="#f97316" /> 4. Independent Admin RBAC
                </strong>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Organizer permissions are never granted based on student roll numbers or regular OTP login. Admin authentication is independently validated.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
