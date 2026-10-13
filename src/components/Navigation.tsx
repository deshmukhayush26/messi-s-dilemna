// src/components/Navigation.tsx
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ShieldAlert, UserCheck, LogOut, Award, FileText, LogIn } from 'lucide-react';

interface NavigationProps {
  currentUser: { name: string; rollNumber: string; role: string } | null;
  onLogout: () => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  currentUser,
  onLogout,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const path = location.pathname;

  return (
    <nav className="top-nav-bar">
      <div className="nav-links">
        <button
          className={`nav-pill-btn ${path === '/submission' ? 'active' : ''}`}
          onClick={() => navigate('/submission')}
        >
          <FileText size={14} /> Case Brief & Submission
        </button>

        <button
          className={`nav-pill-btn ${path === '/leaderboard' ? 'active' : ''}`}
          onClick={() => navigate('/leaderboard')}
        >
          <Award size={14} /> Leaderboard
        </button>

        <button
          className={`nav-pill-btn ${path === '/admin' ? 'active' : ''}`}
          onClick={() => navigate('/admin')}
        >
          <ShieldAlert size={14} /> Organizer Portal
        </button>
      </div>

      <div className="nav-user-badge">
        {currentUser ? (
          <>
            <span className="user-tag">
              <UserCheck size={14} style={{ display: 'inline', marginRight: 4 }} />
              {currentUser.name} ({currentUser.rollNumber})
              {currentUser.role === 'organizer' && (
                <span style={{ marginLeft: 6, color: '#f97316', fontWeight: 700 }}>[Admin]</span>
              )}
            </span>
            <button className="logout-btn" onClick={onLogout}>
              <LogOut size={13} style={{ display: 'inline', marginRight: 2 }} /> Logout
            </button>
          </>
        ) : (
          <button
            className="nav-pill-btn"
            style={{ fontSize: 12, padding: '6px 14px' }}
            onClick={() => navigate('/')}
          >
            <LogIn size={13} /> Participant Login
          </button>
        )}
      </div>
    </nav>
  );
};
