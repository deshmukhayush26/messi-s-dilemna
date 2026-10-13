import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import { MailCheck, CheckCircle2, AlertTriangle } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (otpToken: string, name: string, rollNumber: string, email?: string) => void;
  onDirectLogin?: (token: string, user: any) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onDirectLogin }) => {
  const [name, setName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpEnabled, setOtpEnabled] = useState<boolean | null>(null); // null = loading

  // Check OTP availability on mount for staging notice
  useEffect(() => {
    apiClient
      .get('/auth/status')
      .then((data) => setOtpEnabled(Boolean(data?.otpEnabled)))
      .catch(() => setOtpEnabled(false)); // fail-closed: keep login disabled if status is unreachable
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Block submission when OTP is disabled — belt-and-suspenders on top of the server 503
    if (otpEnabled === false) {
      setError('Institutional OTP login is currently unavailable. Please try again later.');
      return;
    }

    const cleanName = name.trim();
    const cleanRoll = rollNumber.trim().toLowerCase();

    if (!cleanName) {
      setError('Please enter your name');
      return;
    }
    if (!cleanRoll) {
      setError('Please enter your roll number');
      return;
    }

    setLoading(true);
    try {
      const data = await apiClient.post('/auth/send-otp', { name: cleanName, rollNumber: cleanRoll });

      if (data.bypassed && onDirectLogin && data.token && data.user) {
        // Dev bypass mode active
        onDirectLogin(data.token, data.user);
        return;
      }

      const challengeToken = data.otpToken || data.otp_token || data.sessionId;
      onLoginSuccess(challengeToken, cleanName, cleanRoll, data.email);
    } catch (err: any) {
      setError(err.message || 'Network error occurred');
    } finally {
      setLoading(false);
    }
  };

  const isStagingMode = otpEnabled === false;

  return (
    <div className="login-screen-wrapper">
      <Header />

      <div className="center-card-layout">
        {/* Staging notice banner — shown only when OTP_ENABLED=false */}
        {isStagingMode && (
          <div
            style={{
              background: '#fef3c7',
              border: '1.5px solid #d97706',
              borderRadius: 10,
              padding: '12px 16px',
              marginBottom: 16,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              fontSize: 13,
              color: '#92400e',
              fontWeight: 600,
              maxWidth: 420,
              width: '100%',
            }}
          >
            <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              <strong>Staging Mode:</strong> Institutional OTP login is temporarily unavailable.
              Participant submissions are disabled. Organizer access remains available.
            </span>
          </div>
        )}

        <form className="grey-auth-card" onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Name:</label>
            <input
              type="text"
              className="pill-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              autoFocus
              required
              disabled={isStagingMode}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Roll number:</label>
            <input
              type="text"
              className="pill-input"
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="e.g. 23b1234 or 22m0456"
              required
              disabled={isStagingMode}
            />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', fontWeight: 600 }}>
              {error}
            </div>
          )}

          <div className="auth-submit-container">
            <button type="submit" className="orange-pill-btn" disabled={loading || isStagingMode}>
              {loading ? 'Sending Webmail OTP...' : isStagingMode ? 'Login Unavailable' : 'Submit'}
            </button>
          </div>

          {!isStagingMode && (
            <div className="mock-dev-notice">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                <MailCheck size={16} color="#d97706" /> Institutional Webmail Verification
              </div>
              <div>
                Enter your official student roll number. A 6-digit verification code will be sent to your institutional email.
              </div>
              <div style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <CheckCircle2 size={13} /> Open Participation: All eligible institutional roll numbers accepted.
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
