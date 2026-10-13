import React, { useState, useEffect } from 'react';
import { apiClient } from '../api/client';

interface HeaderProps {
  showStopwatch?: boolean;
}

export const Header: React.FC<HeaderProps> = ({ showStopwatch = false }) => {
  const [timerStatus, setTimerStatus] = useState<string>('not_started');
  const [remainingSec, setRemainingSec] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    const fetchTimer = async () => {
      try {
        const data = await apiClient.get('/timer');
        if (mounted && data) {
          setTimerStatus(data.status);
          setRemainingSec(data.remainingSeconds || 0);
        }
      } catch {
        // Ignore network errors in header sync
      }
    };

    fetchTimer();
    const interval = setInterval(fetchTimer, 5000);

    // Local 1-second countdown tick when running
    const tickInterval = setInterval(() => {
      setRemainingSec((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => {
      mounted = false;
      clearInterval(interval);
      clearInterval(tickInterval);
    };
  }, []);

  const formatTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  return (
    <header className="reference-header">
      <div className="header-left-group">
        {(showStopwatch || timerStatus === 'running' || timerStatus === 'paused') && (
          <div
            className="header-stopwatch-icon"
            title={`Event Timer: ${timerStatus.replace('_', ' ')} (${formatTime(remainingSec)})`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, width: 'auto', padding: '0 8px' }}
          >
            {/* Stopwatch icon matching reference image */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ width: 28, height: 28 }}
            >
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 2.5" />
              <path d="M10 2h4" />
              <path d="M12 2v3" />
              <path d="M18.5 5.5l1.5 1.5" />
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontSize: 13, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '0.5px' }}>
                {timerStatus === 'not_started'
                  ? 'Not Started'
                  : timerStatus === 'expired'
                  ? 'Closed'
                  : formatTime(remainingSec)}
              </span>
              <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: timerStatus === 'running' ? '#16a34a' : timerStatus === 'paused' ? '#d97706' : '#6b7280' }}>
                {timerStatus.replace('_', ' ')}
              </span>
            </div>
          </div>
        )}

        <div className="header-title-block">
          <div className="header-title-line-1">
            INTER <span className="pink-text">MIAMI'S</span>
          </div>
          <div className="header-title-line-2">
            <span className="blue-text">MESSI</span> <span className="black-text">DILEMNA</span>
          </div>
        </div>
      </div>

      <div className="header-logos">
        <div className="logo-item" title="Case Consulting Group">
          <img src="/ccg_transparent.png" alt="CCG Logo" />
        </div>
        <div className="logo-item" title="OpenAI">
          <img src="/chatgpt_logo.svg" alt="OpenAI Logo" />
        </div>
      </div>
    </header>
  );
};
