// src/components/NotFoundScreen.tsx
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Header } from './Header';
import { AlertCircle, Home, ArrowLeft } from 'lucide-react';

export const NotFoundScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="login-screen-wrapper">
      <Header />
      <div className="center-card-layout">
        <div className="grey-auth-card" style={{ textAlign: 'center', padding: '40px 32px' }}>
          <div style={{ display: 'inline-flex', padding: 16, background: '#fee2e2', borderRadius: '50%', marginBottom: 16, color: '#dc2626' }}>
            <AlertCircle size={36} />
          </div>
          <h2 style={{ fontSize: 24, fontWeight: 800, marginBottom: 8, color: '#111827' }}>Page Not Found (404)</h2>
          <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.5 }}>
            The requested page does not exist or has been moved. Use the navigation buttons below to return to the case competition.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '12px 20px', borderRadius: 9999, fontWeight: 700 }}
              onClick={() => navigate(-1)}
            >
              <ArrowLeft size={16} /> Go Back
            </button>
            <button
              className="orange-pill-btn"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '12px 24px', fontWeight: 700 }}
              onClick={() => navigate('/submission')}
            >
              <Home size={16} /> Case & Submission
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
