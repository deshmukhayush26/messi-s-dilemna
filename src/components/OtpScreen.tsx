import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import { ArrowLeft, RefreshCw, Mail, CheckCircle2 } from 'lucide-react';

interface OtpScreenProps {
  otpToken: string;
  name: string;
  rollNumber: string;
  email?: string;
  onOtpVerified: (token: string, user: any) => void;
  onBack: () => void;
}

export const OtpScreen: React.FC<OtpScreenProps> = ({
  otpToken,
  name,
  rollNumber,
  email,
  onOtpVerified,
  onBack,
}) => {
  const [otp, setOtp] = useState('');
  const [resendToken, setResendToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendSuccess, setResendSuccess] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(30);

  const activeChallengeToken = resendToken || otpToken;

  // Cooldown timer for resend button
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setError('Please enter the 6-digit OTP');
      return;
    }

    if (!/^\d{6}$/.test(cleanOtp)) {
      setError('OTP must be exactly 6 digits');
      return;
    }

    setLoading(true);
    try {
      const data = await apiClient.post('/auth/verify-otp', {
        otp: cleanOtp,
        otpToken: activeChallengeToken,
        name: name.trim(),
        rollNumber: rollNumber.trim().toLowerCase(),
      });

      onOtpVerified(data.token, data.user);
    } catch (err: any) {
      setError(err.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0 || resending) return;
    setResending(true);
    setError(null);
    setResendSuccess(null);

    try {
      const data = await apiClient.post('/auth/resend-otp', {
        rollNumber: rollNumber.trim().toLowerCase(),
      });

      if (data.otpToken) {
        setResendToken(data.otpToken);
      }
      setResendSuccess(`New verification code sent to ${data.email || 'your webmail'}`);
      setCooldown(45);
      setTimeout(() => setResendSuccess(null), 5000);
    } catch (err: any) {
      setError(err.message || 'Error resending verification code');
    } finally {
      setResending(false);
    }
  };

  const displayTarget = email || `${rollNumber.toLowerCase()}@iitb.ac.in`;

  return (
    <div className="otp-screen-wrapper">
      <Header />

      <div className="center-card-layout">
        <form className="grey-auth-card" onSubmit={handleSubmit}>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Mail size={15} color="#d97706" />
              <span>Code sent to <strong>{displayTarget}</strong></span>
            </div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              Valid for 10 minutes
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Enter OTP:</label>
            <input
              type="text"
              className="pill-input"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="6-digit verification code"
              maxLength={6}
              autoFocus
              required
            />
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, textAlign: 'center', fontWeight: 600 }}>
              {error}
            </div>
          )}

          {resendSuccess && (
            <div style={{ color: '#16a34a', fontSize: 13, textAlign: 'center', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
              <CheckCircle2 size={14} /> {resendSuccess}
            </div>
          )}

          <div className="auth-submit-container">
            <button type="submit" className="orange-pill-btn" disabled={loading}>
              {loading ? 'Verifying...' : 'Submit'}
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 13 }}>
            <button
              type="button"
              onClick={onBack}
              style={{
                background: 'none',
                border: 'none',
                color: '#4b5563',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 600,
              }}
            >
              <ArrowLeft size={14} /> Change Roll Number
            </button>

            <button
              type="button"
              onClick={handleResend}
              disabled={cooldown > 0 || resending}
              style={{
                background: 'none',
                border: 'none',
                color: cooldown > 0 ? '#9ca3af' : '#ea580c',
                cursor: cooldown > 0 ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: 700,
              }}
            >
              <RefreshCw size={13} className={resending ? 'spin' : ''} />
              {resending ? 'Sending...' : cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
