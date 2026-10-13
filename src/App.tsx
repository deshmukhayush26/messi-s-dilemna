// src/App.tsx
import React, { useState, useEffect } from 'react';
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
} from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { LoginScreen } from './components/LoginScreen';
import { OtpScreen } from './components/OtpScreen';
import { ChallengeScreen } from './components/ChallengeScreen';
import { LeaderboardScreen } from './components/LeaderboardScreen';
import { AdminScreen } from './components/AdminScreen';
import { ApiContractDocs } from './components/ApiContractDocs';
import { NotFoundScreen } from './components/NotFoundScreen';
import { apiClient } from './api/client';

interface PendingOtpState {
  otpToken: string;
  name: string;
  rollNumber: string;
  email: string;
}

const AppContent: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const [pendingOtp, setPendingOtp] = useState<PendingOtpState>({
    otpToken: '',
    name: '',
    rollNumber: '',
    email: '',
  });

  const [authToken, setAuthToken] = useState<string | null>(() => {
    return localStorage.getItem('ccg_auth_token') || null;
  });
  const [currentUser, setCurrentUser] = useState<any | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(() => {
    return Boolean(localStorage.getItem('ccg_auth_token'));
  });

  // Restore authenticated session on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('ccg_auth_token');
    if (storedToken) {
      apiClient
        .get('/auth/me')
        .then((data) => {
          if (data?.user) {
            setCurrentUser(data.user);
            setAuthToken(storedToken);
            // If participant lands on root login page and already has session, advance to submission
            if (location.pathname === '/') {
              navigate('/submission', { replace: true });
            }
          } else {
            localStorage.removeItem('ccg_auth_token');
            setAuthToken(null);
            setCurrentUser(null);
          }
        })
        .catch(() => {
          // Token expired or invalid
          localStorage.removeItem('ccg_auth_token');
          setAuthToken(null);
          setCurrentUser(null);
        })
        .finally(() => {
          setIsCheckingSession(false);
        });
    }
  }, [location.pathname, navigate]);

  const handleLoginSuccess = (
    otpToken: string,
    name: string,
    rollNumber: string,
    email?: string
  ) => {
    const state: PendingOtpState = {
      otpToken,
      name,
      rollNumber,
      email: email || '',
    };
    setPendingOtp(state);
    navigate('/verify-otp', { state });
  };

  const handleDirectLogin = (token: string, user: any) => {
    localStorage.setItem('ccg_auth_token', token);
    setAuthToken(token);
    setCurrentUser(user);
    navigate('/submission');
  };

  const handleOtpVerified = (token: string, user: any) => {
    localStorage.setItem('ccg_auth_token', token);
    setAuthToken(token);
    setCurrentUser(user);
    navigate('/submission');
  };

  const handleAdminLoginSuccess = (token: string, user: any) => {
    localStorage.setItem('ccg_auth_token', token);
    setAuthToken(token);
    setCurrentUser(user);
    navigate('/admin');
  };

  const handleLogout = async () => {
    if (authToken) {
      try {
        await apiClient.post('/auth/logout');
      } catch {
        // Ignore logout network errors
      }
    }
    localStorage.removeItem('ccg_auth_token');
    setAuthToken(null);
    setCurrentUser(null);
    navigate('/');
  };

  // Read OTP verification params from router state if available
  const routerState = (location.state as PendingOtpState) || pendingOtp;

  return (
    <div className="app-viewport">
      {/* Decorative vertical striped bar on left margin */}
      <div className="striped-bg-bar" />

      <main className="content-container">
        {/* Top Navigation Bar with active route detection */}
        <Navigation currentUser={currentUser} onLogout={handleLogout} />

        {isCheckingSession ? (
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh', color: '#64748b' }}>
            <span>Verifying session...</span>
          </div>
        ) : (
          <Routes>
            {/* 1. Main Entry / Login */}
            <Route
              path="/"
              element={
                currentUser ? (
                  <Navigate to="/submission" replace />
                ) : (
                  <LoginScreen
                    onLoginSuccess={handleLoginSuccess}
                    onDirectLogin={handleDirectLogin}
                  />
                )
              }
            />

            {/* 2. OTP Verification */}
            <Route
              path="/verify-otp"
              element={
                <OtpScreen
                  otpToken={routerState.otpToken}
                  name={routerState.name}
                  rollNumber={routerState.rollNumber}
                  email={routerState.email}
                  onOtpVerified={handleOtpVerified}
                  onBack={() => navigate('/')}
                />
              }
            />

            {/* 3. Case Brief & Presentation Submission (Protected) */}
            <Route
              path="/submission"
              element={
                authToken ? (
                  <ChallengeScreen
                    currentUser={currentUser}
                    authToken={authToken}
                    onSubmissionComplete={() => {}}
                    onNavigateToLeaderboard={() => navigate('/leaderboard')}
                  />
                ) : (
                  <Navigate to="/" replace state={{ from: location }} />
                )
              }
            />

            {/* Handle legacy / typo route redirect */}
            <Route path="/submision" element={<Navigate to="/submission" replace />} />

            {/* 4. Public Leaderboard */}
            <Route path="/leaderboard" element={<LeaderboardScreen />} />

            {/* 5. Organizer Admin Portal */}
            <Route
              path="/admin"
              element={
                <AdminScreen
                  currentUser={currentUser}
                  authToken={authToken}
                  onAdminLoginSuccess={handleAdminLoginSuccess}
                />
              }
            />

            {/* 6. API Docs & Contract */}
            <Route path="/docs" element={<ApiContractDocs />} />

            {/* 7. Not Found Route (404) */}
            <Route path="*" element={<NotFoundScreen />} />
          </Routes>
        )}
      </main>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
};

export default App;
