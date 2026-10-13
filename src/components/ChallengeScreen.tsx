import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import {
  ExternalLink,
  Upload,
  CheckCircle2,
  AlertCircle,
  X,
  Clock,
  FileText,
  AlertTriangle,
  Award,
  ArrowRight
} from 'lucide-react';

interface ChallengeScreenProps {
  currentUser: { id: string; name: string; rollNumber: string } | null;
  authToken: string | null;
  onSubmissionComplete: (submission: any) => void;
  onNavigateToLeaderboard: () => void;
}

export const ChallengeScreen: React.FC<ChallengeScreenProps> = ({
  currentUser,
  authToken,
  onSubmissionComplete,
  onNavigateToLeaderboard,
}) => {
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [isCompendiumModalOpen, setIsCompendiumModalOpen] = useState(false);

  // Timer State
  const [timerStatus, setTimerStatus] = useState<string>('not_started');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [submissionsAllowed, setSubmissionsAllowed] = useState<boolean>(true);
  const [submissionBlockReason, setSubmissionBlockReason] = useState<string | null>(null);

  // Submission Form State
  const [teamName, setTeamName] = useState(currentUser ? `${currentUser.name}'s Strategy Team` : 'Miami Vanguard');
  const [submissionName, setSubmissionName] = useState('Sustainable Club Identity & Commercial Ecosystem');
  const [fileName, setFileName] = useState('Inter_Miami_Messi_Dilemma_Deck.pdf');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('5-pillar strategy covering digital membership, LATAM academy pipeline, and experiential stadium revenue.');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedDeck, setSubmittedDeck] = useState<any | null>(null);

  // Existing Participant Submission State
  const [mySubmission, setMySubmission] = useState<any | null>(null);
  const [loadingMySub, setLoadingMySub] = useState(false);

  // Feedback Modal State
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [feedbackData, setFeedbackData] = useState<any | null>(null);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Sync Timer from Backend
  const syncTimer = useCallback(async () => {
    try {
      const data = await apiClient.get('/api/timer');
      if (data) {
        setTimerStatus(data.status);
        setRemainingSeconds(data.remainingSeconds || 0);
        setSubmissionsAllowed(Boolean(data.submissionsAllowed));
        setSubmissionBlockReason(data.submissionStatusReason);
      }
    } catch {
      // Ignore network errors in polling
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    apiClient.get('/api/timer')
      .then((data) => {
        if (!ignore && data) {
          setTimerStatus(data.status);
          setRemainingSeconds(data.remainingSeconds || 0);
          setSubmissionsAllowed(Boolean(data.submissionsAllowed));
          setSubmissionBlockReason(data.submissionStatusReason);
        }
      })
      .catch(() => {});

    if (authToken) {
      apiClient.get('/api/submissions/my')
        .then((data) => {
          if (!ignore && data?.submission) {
            setMySubmission(data.submission);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!ignore) {
            setLoadingMySub(false);
          }
        });
    }

    const interval = setInterval(syncTimer, 5000);
    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [authToken, syncTimer]);

  const formatTimerDisplay = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  // Fetch Participant Feedback
  const handleOpenFeedback = async (subId: string) => {
    setIsFeedbackModalOpen(true);
    setFeedbackLoading(true);
    setFeedbackError(null);
    setFeedbackData(null);
    try {
      const data = await apiClient.get(`/api/submissions/${subId}/feedback`);
      setFeedbackData(data);
    } catch (err: any) {
      setFeedbackError(err.message || 'Error fetching evaluation feedback');
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleSubmitDeck = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!teamName.trim() || !submissionName.trim()) {
      setSubmitError('Team name and submission title are required.');
      return;
    }

    if (!submissionsAllowed) {
      setSubmitError(submissionBlockReason || 'Submissions are currently disabled by the event timer.');
      return;
    }

    setSubmitting(true);
    try {
      let data: any;

      if (selectedFile) {
        // Multipart FormData upload using centralized apiClient
        const formData = new FormData();
        formData.append('teamName', teamName.trim());
        formData.append('submissionName', submissionName.trim());
        formData.append('notes', notes.trim());
        formData.append('deckFile', selectedFile);

        data = await apiClient.upload('/api/submissions', formData);
      } else {
        // Fallback JSON payload
        data = await apiClient.post('/api/submissions', {
          teamName: teamName.trim(),
          submissionName: submissionName.trim(),
          deckFileName: fileName.trim(),
          notes: notes.trim(),
        });
      }

      setSubmittedDeck(data.submission);
      setMySubmission(data.submission);
      onSubmissionComplete(data.submission);
      syncTimer();
    } catch (err: any) {
      setSubmitError(err.message || 'Error processing submission');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="challenge-screen-wrapper">
      {/* Header with Stopwatch icon matching reference */}
      <Header showStopwatch={true} />

      {/* Timer Status Alert Banner if not running */}
      {timerStatus !== 'running' && (
        <div
          style={{
            margin: '0 0 16px 0',
            padding: '12px 20px',
            borderRadius: 16,
            background: timerStatus === 'paused' ? '#fef3c7' : timerStatus === 'expired' ? '#fee2e2' : '#f1f5f9',
            border: `1px solid ${timerStatus === 'paused' ? '#fde68a' : timerStatus === 'expired' ? '#fca5a5' : '#cbd5e1'}`,
            color: timerStatus === 'paused' ? '#92400e' : timerStatus === 'expired' ? '#991b1b' : '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {timerStatus === 'expired' ? <AlertTriangle size={18} /> : <Clock size={18} />}
            <span>
              <strong>Event Timer Notice:</strong>{' '}
              {timerStatus === 'not_started' && 'The organizer has not started the event timer yet. Submissions are temporarily pending.'}
              {timerStatus === 'paused' && 'The organizer has paused the countdown. Submissions are temporarily suspended.'}
              {timerStatus === 'expired' && 'The event countdown has expired. Submission window is closed.'}
            </span>
          </div>
          <span style={{ fontSize: 12, padding: '4px 10px', background: 'rgba(0,0,0,0.06)', borderRadius: 9999, textTransform: 'uppercase' }}>
            {timerStatus.replace('_', ' ')}
          </span>
        </div>
      )}

      {/* Participant Active Submission Status Card */}
      {loadingMySub && (
        <div style={{ marginBottom: 12, fontSize: 13, color: '#64748b' }}>
          Refreshing submission status...
        </div>
      )}
      {mySubmission && (
        <div
          style={{
            margin: '0 0 20px 0',
            padding: '16px 22px',
            borderRadius: 18,
            background: '#ffffff',
            border: '1.5px solid #fed7aa',
            boxShadow: '0 4px 12px rgba(242, 114, 43, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ background: '#ffedd5', padding: 10, borderRadius: 12, color: '#c2410c' }}>
              <FileText size={24} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>
                {mySubmission.submissionName}
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>
                Team: <strong>{mySubmission.teamName}</strong> | {mySubmission.slideCount || 5} slides | Status:{' '}
                <span style={{ textTransform: 'capitalize', fontWeight: 600, color: '#0f172a' }}>
                  {mySubmission.reviewStatus}
                </span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => handleOpenFeedback(mySubmission.id)}
              className="orange-pill-btn"
              style={{ fontSize: 14, padding: '9px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Award size={15} /> View Evaluation Feedback
            </button>
            <button
              onClick={onNavigateToLeaderboard}
              className="btn-sm"
              style={{ padding: '9px 16px', borderRadius: 9999, fontWeight: 700 }}
            >
              View Leaderboard <ArrowRight size={13} style={{ display: 'inline', marginLeft: 4 }} />
            </button>
          </div>
        </div>
      )}

      <div className="case-challenge-grid">
        {/* Left Column: The Problem Statement Brief Card */}
        <div className="case-brief-card">
          <h2 className="case-brief-title">
            The Messi Effect: The Fans Came for Messi, Not the Team
          </h2>

          <p className="case-brief-paragraph">
            Imagine Inter Miami discovers that a huge part of its commercial success depends on Messi. Fans buy tickets to see him, merchandise featuring his name flies off shelves, and sponsors want him in every campaign.
          </p>

          <p className="case-brief-paragraph">
            Now, following his farewell to Argentina, the club's board asks a difficult question: How do we build a club that remains commercially irresistible even after the Messi era eventually ends?
          </p>

          <p className="case-brief-paragraph">
            Your team must design a strategy to turn Messi's star power into a lasting fan community, sustainable revenue, and a club identity that can survive beyond one superstar.
          </p>

          <div className="case-brief-footer-callout">
            <h4 style={{ fontWeight: 800, color: '#0f172a', marginBottom: 4 }}>The Strategic Debate:</h4>
            Should the club build the next superstar, sell the Messi legacy, or make the team itself the product? All coherent, evidence-backed strategies will be evaluated fairly against the 5-criterion judging rubric.
          </div>
        </div>

        {/* Right Column: Case Guidance & Submission Trigger Card */}
        <div className="case-sidebar-card">
          <div className="questions-card">
            <button
              className="compendium-link-btn"
              onClick={() => setIsCompendiumModalOpen(true)}
            >
              Link to Case Compendium <ExternalLink size={15} />
            </button>

            <div className="questions-header">Before submitting, ask:</div>

            <ul className="questions-list">
              <li className="question-item">
                <strong>Problem:</strong> Have we identified the right problem and its root cause?
              </li>
              <li className="question-item">
                <strong>Insight:</strong> Have we uncovered something meaningful from the data?
              </li>
              <li className="question-item">
                <strong>Recommendation:</strong> Have we made a clear, evidence-backed choice?
              </li>
              <li className="question-item">
                <strong>Execution:</strong> Can the solution realistically be implemented?
              </li>
              <li className="question-item">
                <strong>Impact:</strong> Can we quantify how success will be measured?
              </li>
            </ul>

            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #e2e8f0', fontSize: 12, color: '#64748b' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong>Event Timer:</strong>
                <span style={{ fontWeight: 600, color: timerStatus === 'running' ? '#059669' : '#dc2626' }}>
                  {timerStatus === 'running'
                    ? `${formatTimerDisplay(remainingSeconds)} remaining`
                    : timerStatus === 'paused'
                    ? 'Timer Paused'
                    : timerStatus === 'expired'
                    ? 'Time Expired'
                    : 'Not Started'}
                </span>
              </div>
              <div><strong>Format:</strong> 5–6 slides (maximum 6 slides enforced). PDF or PPTX format.</div>
            </div>
          </div>

          <button
            className="submit-deck-large-btn"
            onClick={() => setIsSubmitModalOpen(true)}
            style={{
              opacity: submissionsAllowed ? 1 : 0.7,
            }}
          >
            {submissionsAllowed
              ? 'Submit your deck'
              : timerStatus === 'expired'
              ? 'Submission Window Closed'
              : 'Submissions Paused'}
          </button>
        </div>
      </div>

      {/* Submission Modal */}
      {isSubmitModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <div className="modal-header">
              <h3 className="modal-title">Submit Presentation Deck</h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsSubmitModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {submittedDeck ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#16a34a', fontWeight: 700, fontSize: 18 }}>
                  <CheckCircle2 size={24} /> Deck Successfully Submitted!
                </div>

                <div style={{ background: '#f8fafc', padding: 18, borderRadius: 16, border: '1px solid #e2e8f0', fontSize: 14 }}>
                  <p><strong>Submission ID:</strong> {submittedDeck.id}</p>
                  <p><strong>Deck Title:</strong> {submittedDeck.submissionName}</p>
                  <p><strong>Team:</strong> {submittedDeck.teamName}</p>
                  <p><strong>Submitted by:</strong> {submittedDeck.userName} ({submittedDeck.userRollNumber})</p>
                  <p><strong>Slide Count:</strong> {submittedDeck.slideCount} slides (meets 5–6 slide requirement)</p>
                  <div style={{ marginTop: 12, padding: '10px 14px', background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 10, color: '#c2410c' }}>
                    <strong>Evaluation Mode:</strong> {submittedDeck.evaluation?.isMock ? 'Mock scoring (AI judge inactive)' : 'AI Judge Evaluation Active'}<br />
                    <strong>Overall Score:</strong> {submittedDeck.evaluation?.overallScore ?? 50} / 100<br />
                    <strong>Category Breakdown:</strong> Problem Structuring (20%), Analytical Rigor (25%), Strategic Insight (25%), Feasibility & Impact (20%), Communication (10%)
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                  <button
                    className="orange-pill-btn"
                    style={{ flex: 1, fontSize: 15, padding: '12px 20px' }}
                    onClick={() => {
                      setIsSubmitModalOpen(false);
                      handleOpenFeedback(submittedDeck.id);
                    }}
                  >
                    View Evaluation Feedback
                  </button>
                  <button
                    className="btn-sm"
                    style={{ padding: '12px 20px', borderRadius: 9999, fontWeight: 700 }}
                    onClick={() => {
                      setIsSubmitModalOpen(false);
                      onNavigateToLeaderboard();
                    }}
                  >
                    Go to Leaderboard
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmitDeck} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {!submissionsAllowed && (
                  <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#991b1b', padding: 12, borderRadius: 12, fontSize: 13, fontWeight: 600 }}>
                    <AlertTriangle size={15} style={{ display: 'inline', marginRight: 6 }} />
                    {submissionBlockReason || 'Deck submission is currently disabled under the event timer.'}
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Team Name
                  </label>
                  <input
                    type="text"
                    className="pill-input"
                    style={{ width: '100%' }}
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Deck Title / Submission Name
                  </label>
                  <input
                    type="text"
                    className="pill-input"
                    style={{ width: '100%' }}
                    value={submissionName}
                    onChange={(e) => setSubmissionName(e.target.value)}
                    required
                  />
                </div>

                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 13, fontWeight: 700 }}>
                      Presentation Document (PDF / PPTX)
                    </label>
                    <span style={{ fontSize: 11, color: '#d97706', fontWeight: 600 }}>
                      Target: 5–6 slides (Max: 6)
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div
                      style={{
                        flex: 1,
                        padding: '10px 14px',
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: 9999,
                        fontSize: 13,
                        color: '#334155',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <FileText size={16} color="#64748b" />
                      <span>{selectedFile ? `${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(1)} MB)` : fileName}</span>
                    </div>

                    <label
                      className="btn-sm"
                      style={{
                        padding: '12px 18px',
                        borderRadius: 9999,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        whiteSpace: 'nowrap',
                        background: '#000000',
                        color: '#ffffff',
                        fontWeight: 700,
                      }}
                    >
                      <Upload size={14} /> Browse File
                      <input
                        type="file"
                        accept=".pdf,.pptx"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          if (e.target.files?.[0]) {
                            const file = e.target.files[0];
                            setSelectedFile(file);
                            setFileName(file.name);
                          }
                        }}
                      />
                    </label>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                    Decks are securely stored and validated server-side. Maximum 6 slides strictly enforced.
                  </div>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    Strategic Notes / Executive Summary
                  </label>
                  <textarea
                    rows={3}
                    style={{
                      width: '100%',
                      borderRadius: 16,
                      border: '1px solid rgba(0,0,0,0.1)',
                      padding: '12px 16px',
                      fontFamily: 'inherit',
                      fontSize: 14,
                      outline: 'none',
                    }}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                {submitError && (
                  <div style={{ color: '#dc2626', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, background: '#fee2e2', padding: 10, borderRadius: 10 }}>
                    <AlertCircle size={16} /> {submitError}
                  </div>
                )}

                <div
                  style={{
                    background: '#fef3c7',
                    border: '1px solid #fde68a',
                    padding: '14px 16px',
                    borderRadius: 14,
                    fontSize: 12,
                    color: '#92400e',
                    lineHeight: 1.5,
                    marginTop: 8,
                    marginBottom: 16,
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: 4 }}>Evaluation Notice & Guidelines:</strong>
                  Decks are scored against the official 5-criterion rubric (Problem Structuring 20%, Analytical Rigor 25%, Strategic Insight 25%, Feasibility 20%, Communication 10%).
                  Weighted score: <code>overall_score = sum((rating / 5) * weight)</code>. Maximum 6 slides strictly enforced.
                </div>

                <div
                  style={{
                    marginTop: 12,
                    paddingTop: 16,
                    borderTop: '1px solid #e2e8f0',
                    position: 'sticky',
                    bottom: 0,
                    background: '#ffffff',
                    zIndex: 10,
                  }}
                >
                  <button
                    type="submit"
                    className="orange-pill-btn"
                    disabled={submitting || !submissionsAllowed}
                    style={{
                      width: '100%',
                      padding: '14px 20px',
                      fontSize: 15,
                      fontWeight: 700,
                      boxShadow: '0 4px 14px rgba(249, 115, 22, 0.35)',
                    }}
                  >
                    {submitting ? 'Validating Slides & Uploading...' : 'Confirm Submission'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Case Compendium Modal */}
      {isCompendiumModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 700 }}>
            <div className="modal-header">
              <h3 className="modal-title">Case Compendium: Inter Miami CF</h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsCompendiumModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 14, lineHeight: 1.6, color: '#374151' }}>
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: 14, borderRadius: 14, color: '#166534' }}>
                <strong>Key Context:</strong> Inter Miami's franchise valuation rose by 72% following the signing of Lionel Messi, with secondary ticket prices surging over 500% and season ticket subscriptions multiplying.
              </div>

              <h4 style={{ fontWeight: 700, color: '#111827', marginTop: 6 }}>Strategic Dilemma Dimensions:</h4>
              <ul style={{ paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li><strong>1. Commercial Dependency:</strong> Sponsoring contracts and MLS Season Pass sign-ups heavily indexed to a single player's on-pitch appearances.</li>
                <li><strong>2. Brand Identity Transition:</strong> Transitioning from "Messi FC" to an enduring Miami sports and entertainment institution.</li>
                <li><strong>3. Academy & Talent Pipeline:</strong> Harnessing South Florida's unique gateway to South American grassroots football talent.</li>
                <li><strong>4. Infrastructure & Real Estate:</strong> Monetizing Miami Freedom Park stadium beyond game days through district entertainment.</li>
              </ul>

              <h4 style={{ fontWeight: 700, color: '#111827', marginTop: 6 }}>Evaluation Categories (Weighted 0–100 Scale):</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <strong>Problem Structuring (20%)</strong>: Root-cause clarity and framing
                </div>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <strong>Analytical Rigor (25%)</strong>: Commercial data grounding
                </div>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <strong>Strategic Insight (25%)</strong>: Novelty & long-term defensibility
                </div>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                  <strong>Feasibility & Impact (20%)</strong>: Operational and financial realism
                </div>
                <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', gridColumn: 'span 2' }}>
                  <strong>Communication (10%)</strong>: Storytelling, slide structure (5–6 slides)
                </div>
              </div>

              <button
                className="orange-pill-btn"
                style={{ alignSelf: 'flex-end', marginTop: 12, padding: '10px 28px', fontSize: 15 }}
                onClick={() => setIsCompendiumModalOpen(false)}
              >
                Close Compendium
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Participant Feedback Modal */}
      {isFeedbackModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 760, maxHeight: '90vh' }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Award size={22} color="#f97316" /> Evaluation Feedback & Score Report
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setIsFeedbackModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {feedbackLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                Fetching your submission feedback...
              </div>
            ) : feedbackError ? (
              <div style={{ padding: 20, background: '#fef3c7', borderRadius: 14, color: '#92400e', fontSize: 14, lineHeight: 1.5 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>Notice:</div>
                {feedbackError}
              </div>
            ) : feedbackData ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Score Banner */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 16,
                    padding: 18,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700 }}>OVERALL SCORE</div>
                    <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a' }}>
                      {feedbackData.overallScore} <span style={{ fontSize: 16, color: '#64748b' }}>/ 100</span>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>{feedbackData.teamName}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      Evaluation Mode: {feedbackData.isMock ? 'Mock scoring (baseline 50)' : 'AI Judge Evaluated'}
                    </div>
                  </div>
                </div>

                {/* Summary & Recommendation */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: 14, borderRadius: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 4 }}>Executive Assessment</div>
                    <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.5 }}>{feedbackData.executiveSummary}</p>
                  </div>
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: 14, borderRadius: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>Identified Recommendation</div>
                    <p style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.5 }}>{feedbackData.recommendation}</p>
                  </div>
                </div>

                {/* Criteria Breakdown */}
                {feedbackData.criterionFeedback && (
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
                      Category Score Breakdown
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {Object.entries(feedbackData.criterionFeedback).map(([key, val]: [string, any]) => (
                        <div
                          key={key}
                          style={{
                            background: '#ffffff',
                            border: '1px solid #e2e8f0',
                            borderRadius: 12,
                            padding: 12,
                            fontSize: 13,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontWeight: 700, color: '#0f172a' }}>{val.criterion}</span>
                            <span style={{ background: '#fed7aa', padding: '2px 8px', borderRadius: 6, fontWeight: 800 }}>
                              {val.rating} / 5 ({val.weightedContribution} pts)
                            </span>
                          </div>
                          <div style={{ color: '#475569', fontSize: 12, marginBottom: 4 }}>{val.rationale}</div>
                          {val.slideEvidence && (
                            <div style={{ color: '#2563eb', fontSize: 11, fontWeight: 600 }}>
                              Slide Evidence: {val.slideEvidence}
                            </div>
                          )}
                          {val.recommendations && (
                            <div style={{ color: '#059669', fontSize: 11, fontWeight: 600, marginTop: 2 }}>
                              Improvement Suggestion: {val.recommendations}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Strengths & Weaknesses */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: '#fdf4ff', border: '1px solid #f0abfc', padding: 12, borderRadius: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#86198f' }}>Key Strength</div>
                    <p style={{ fontSize: 12, color: '#701a75', marginTop: 4 }}>{feedbackData.strongestAspect}</p>
                  </div>
                  <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: 12, borderRadius: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#be123c' }}>Priority Improvement Area</div>
                    <p style={{ fontSize: 12, color: '#9f1239', marginTop: 4 }}>{feedbackData.primaryWeakness}</p>
                  </div>
                </div>

                <button
                  className="orange-pill-btn"
                  style={{ alignSelf: 'flex-end', padding: '10px 24px', fontSize: 14 }}
                  onClick={() => setIsFeedbackModalOpen(false)}
                >
                  Close Feedback
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
};
