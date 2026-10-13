import React, { useState } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import { MailCheck, CheckCircle2 } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (otpToken: string, name: string, rollNumber: string, email?: string) => void;
  onDirectLogin?: (token: string, user: any) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess, onDirectLogin }) => {
  const [name, setName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

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

  return (
    <div className="login-screen-wrapper">
      <Header />

      <div className="center-card-layout">
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
            />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 14, textAlign: 'center', fontWeight: 600 }}>
              {error}
            </div>
          )}

          <div className="auth-submit-container">
            <button type="submit" className="orange-pill-btn" disabled={loading}>
              {loading ? 'Sending Webmail OTP...' : 'Submit'}
            </button>
          </div>

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
        </form>
      </div>
    </div>
  );
};
