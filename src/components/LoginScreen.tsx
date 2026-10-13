import React, { useState } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import { Lock, User, KeyRound, CheckCircle2, Shield, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface LoginScreenProps {
  onLoginSuccess?: (token: string, name: string, rollNumber: string, email?: string) => void;
  onDirectLogin?: (token: string, user: any) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onDirectLogin }) => {
  const [activeTab, setActiveTab] = useState<'signin' | 'register'>('signin');
  const [name, setName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanRoll = rollNumber.trim().toUpperCase();
    if (!cleanRoll) {
      setError('Please enter your student roll number.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      const data = await apiClient.post('/api/auth/login', {
        rollNumber: cleanRoll,
        password,
      });

      if (data.token && data.user && onDirectLogin) {
        onDirectLogin(data.token, data.user);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = name.trim();
    const cleanRoll = rollNumber.trim().toUpperCase();

    if (!cleanName || cleanName.length < 2) {
      setError('Please enter your full name (minimum 2 characters).');
      return;
    }
    if (!cleanRoll) {
      setError('Please enter your student roll number.');
      return;
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const data = await apiClient.post('/api/auth/register', {
        name: cleanName,
        rollNumber: cleanRoll,
        password,
        email: email.trim() || undefined,
      });

      if (data.token && data.user && onDirectLogin) {
        onDirectLogin(data.token, data.user);
      }
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen-wrapper">
      <Header />

      <div className="center-card-layout">
        <div className="grey-auth-card" style={{ maxWidth: 440, width: '100%' }}>
          {/* Tab Selection */}
          <div
            style={{
              display: 'flex',
              background: '#e2e8f0',
              borderRadius: 30,
              padding: 4,
              marginBottom: 20,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setActiveTab('signin');
                setError(null);
              }}
              style={{
                flex: 1,
                padding: '8px 16px',
                borderRadius: 24,
                border: 'none',
                background: activeTab === 'signin' ? '#ffffff' : 'transparent',
                fontWeight: 700,
                fontSize: 13,
                color: activeTab === 'signin' ? '#0f172a' : '#64748b',
                cursor: 'pointer',
                boxShadow: activeTab === 'signin' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setError(null);
              }}
              style={{
                flex: 1,
                padding: '8px 16px',
                borderRadius: 24,
                border: 'none',
                background: activeTab === 'register' ? '#ffffff' : 'transparent',
                fontWeight: 700,
                fontSize: 13,
                color: activeTab === 'register' ? '#0f172a' : '#64748b',
                cursor: 'pointer',
                boxShadow: activeTab === 'register' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              Create Account
            </button>
          </div>

          {activeTab === 'signin' ? (
            <form onSubmit={handleSignIn}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <User size={15} color="#475569" /> Student Roll Number:
                </label>
                <input
                  type="text"
                  className="pill-input"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  placeholder="e.g. 23B1234 or 22M0456"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={15} color="#475569" /> Password:
                </label>
                <input
                  type="password"
                  className="pill-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                />
              </div>

              {error && (
                <div style={{ color: '#dc2626', fontSize: 13, background: '#fee2e2', padding: 10, borderRadius: 10, marginBottom: 14 }}>
                  {error}
                </div>
              )}

              <div className="auth-submit-container">
                <button type="submit" className="orange-pill-btn" style={{ width: '100%' }} disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In to Challenge'}
                </button>
              </div>

              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: '#64748b' }}>
                Don't have an account yet?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('register');
                    setError(null);
                  }}
                  style={{ background: 'none', border: 'none', color: '#ff4d88', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Create one now
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <User size={15} color="#475569" /> Full Name:
                </label>
                <input
                  type="text"
                  className="pill-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Aarav Sharma"
                  autoFocus
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <KeyRound size={15} color="#475569" /> Student Roll Number:
                </label>
                <input
                  type="text"
                  className="pill-input"
                  value={rollNumber}
                  onChange={(e) => setRollNumber(e.target.value)}
                  placeholder="e.g. 23B1234 or 22M0456"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Lock size={15} color="#475569" /> Password (minimum 8 chars):
                </label>
                <input
                  type="password"
                  className="pill-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a secure password"
                  minLength={8}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  Institutional Email (Optional):
                </label>
                <input
                  type="email"
                  className="pill-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. student@college.edu"
                />
              </div>

              {error && (
                <div style={{ color: '#dc2626', fontSize: 13, background: '#fee2e2', padding: 10, borderRadius: 10, marginBottom: 14 }}>
                  {error}
                </div>
              )}

              <div className="auth-submit-container">
                <button type="submit" className="orange-pill-btn" style={{ width: '100%' }} disabled={loading}>
                  {loading ? 'Creating Account...' : 'Register & Enter Challenge'}
                </button>
              </div>

              <div style={{ textAlign: 'center', marginTop: 14, fontSize: 12, color: '#64748b' }}>
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('signin');
                    setError(null);
                  }}
                  style={{ background: 'none', border: 'none', color: '#ff4d88', fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Sign in with password
                </button>
              </div>
            </form>
          )}

          {/* Security Notice */}
          <div className="mock-dev-notice" style={{ marginTop: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
              <CheckCircle2 size={15} color="#16a34a" /> Secure Participant Authentication
            </div>
            <div>
              Passwords are encrypted using cryptographic scrypt hashes. Identity is verified per-account on submission.
            </div>
            <div style={{ marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>Case Coordinator / Judge?</span>
              <Link
                to="/admin"
                style={{
                  fontSize: 12,
                  color: '#0284c7',
                  fontWeight: 700,
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Shield size={13} /> Organizer Portal <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
