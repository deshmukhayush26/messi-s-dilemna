import React, { useState, useEffect } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import type { LeaderboardEntry } from '../../server/types';
import { AlertCircle, RefreshCw } from 'lucide-react';

export const LeaderboardScreen: React.FC = () => {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Category toggle for the right breakdown tables
  const [selectedCategoryTop, setSelectedCategoryTop] = useState<'communication' | 'strategicInsight'>('communication');
  const [selectedCategoryBottom, setSelectedCategoryBottom] = useState<'problemStructuring' | 'analyticalRigor' | 'feasibilityImpact'>('problemStructuring');

  const [evaluationMode, setEvaluationMode] = useState<string>('Live Competition Scoring');

  const fetchLeaderboard = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get('/api/leaderboard');
      setEntries(data.entries || []);
      if (data.evaluationMode) {
        setEvaluationMode(data.evaluationMode);
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching leaderboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;
    apiClient.get('/api/leaderboard')
      .then((data) => {
        if (!ignore) {
          setEntries(data.entries || []);
          if (data.evaluationMode) {
            setEvaluationMode(data.evaluationMode);
          }
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!ignore) {
          setError(err.message || 'Error fetching leaderboard');
          setLoading(false);
        }
      });
    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div className="leaderboard-screen-wrapper">
      <Header />

      <div className="leaderboard-container">
        {/* Evaluation Mode Notice Banner */}
        <div className="mock-scoring-badge-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={18} />
            <span>
              <strong>Evaluation mode:</strong> {evaluationMode}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13, color: '#9a3412' }}>
              Deterministic scoring formula applied. Stable tie-breaker: earlier submissions rank higher.
            </span>
            <button
              onClick={fetchLeaderboard}
              className="btn-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {error && (
          <div style={{ color: '#dc2626', background: '#fee2e2', padding: 12, borderRadius: 12, fontSize: 14 }}>
            {error}
          </div>
        )}

        <div className="leaderboard-grid">
          {/* Left Table: Main Leaderboard matching Image 4 */}
          <div className="peach-table-card">
            <table className="peach-table">
              <thead>
                <tr>
                  <th style={{ width: '42%' }}>Submission Name</th>
                  <th style={{ width: '38%' }}>Submitted by</th>
                  <th style={{ width: '20%', textAlign: 'center' }}>Total Score</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                      Loading leaderboard...
                    </td>
                  </tr>
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                      No submissions found yet. Submit a deck to see it here!
                    </td>
                  </tr>
                ) : (
                  entries.map((entry) => (
                    <tr key={entry.submissionId}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{entry.submissionName}</div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>{entry.teamName}</div>
                      </td>
                      <td>
                        <div className="sub-by-cell">
                          <span className="sub-by-name">{entry.submittedBy}</span>
                          <span className="sub-by-roll">Roll: {entry.rollNumber}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className="total-score-badge">
                          {entry.totalScore}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Right Column: Breakdown Tables matching Image 4 */}
          <div className="right-breakdown-tables">
            {/* Top Right Table: Communication score (or toggle) */}
            <div className="peach-table-card">
              <div style={{ padding: '8px 12px', background: '#fedcb4', borderBottom: '1.5px solid #f9b878', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>Category Breakdown 1</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={`category-tab-btn ${selectedCategoryTop === 'communication' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryTop('communication')}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    Communication
                  </button>
                  <button
                    className={`category-tab-btn ${selectedCategoryTop === 'strategicInsight' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryTop('strategicInsight')}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    Strategic Insight
                  </button>
                </div>
              </div>

              <table className="peach-table">
                <thead>
                  <tr>
                    <th style={{ width: '60%' }}>Submission Name</th>
                    <th style={{ width: '40%', textAlign: 'center' }}>
                      {selectedCategoryTop === 'communication' ? 'Communication score' : 'Strategic insight score'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 5).map((entry) => (
                    <tr key={`top_${entry.submissionId}`}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.submissionName}</div>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>
                        {selectedCategoryTop === 'communication'
                          ? entry.scores.communication
                          : entry.scores.strategicInsight}
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'center', padding: 20, color: '#6b7280' }}>
                        No records
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Bottom Right Table: Problem structuring score (or toggle) */}
            <div className="peach-table-card">
              <div style={{ padding: '8px 12px', background: '#fedcb4', borderBottom: '1.5px solid #f9b878', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase' }}>Category Breakdown 2</span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className={`category-tab-btn ${selectedCategoryBottom === 'problemStructuring' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryBottom('problemStructuring')}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    Problem Structuring
                  </button>
                  <button
                    className={`category-tab-btn ${selectedCategoryBottom === 'analyticalRigor' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryBottom('analyticalRigor')}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    Analytical Rigor
                  </button>
                  <button
                    className={`category-tab-btn ${selectedCategoryBottom === 'feasibilityImpact' ? 'active' : ''}`}
                    onClick={() => setSelectedCategoryBottom('feasibilityImpact')}
                    style={{ fontSize: 11, padding: '3px 8px' }}
                  >
                    Feasibility
                  </button>
                </div>
              </div>

              <table className="peach-table">
                <thead>
                  <tr>
                    <th style={{ width: '60%' }}>Submission Name</th>
                    <th style={{ width: '40%', textAlign: 'center' }}>
                      {selectedCategoryBottom === 'problemStructuring'
                        ? 'Problem structuring score'
                        : selectedCategoryBottom === 'analyticalRigor'
                        ? 'Analytical rigor score'
                        : 'Feasibility & impact score'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {entries.slice(0, 5).map((entry) => (
                    <tr key={`bot_${entry.submissionId}`}>
                      <td>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.submissionName}</div>
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>
                        {selectedCategoryBottom === 'problemStructuring'
                          ? entry.scores.problemStructuring
                          : selectedCategoryBottom === 'analyticalRigor'
                          ? entry.scores.analyticalRigor
                          : entry.scores.feasibilityImpact}
                      </td>
                    </tr>
                  ))}
                  {entries.length === 0 && (
                    <tr>
                      <td colSpan={2} style={{ textAlign: 'center', padding: 20, color: '#6b7280' }}>
                        No records
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
