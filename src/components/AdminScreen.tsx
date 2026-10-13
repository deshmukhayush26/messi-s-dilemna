import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './Header';
import { apiClient } from '../api/client';
import type { TokenUsageStats, EventTimer, TimerActionLog } from '../../server/types';
import {
  Shield, Check, X, Clock, Globe, Play,
  Coins, Zap, Layers, Plus, RotateCcw,
  Download, Search, Filter, History,
  Bot, Eye, Edit3, AlertTriangle,
  BarChart2, Cpu
} from 'lucide-react';

interface AdminScreenProps {
  currentUser: { name: string; rollNumber: string; role: string } | null;
  authToken: string | null;
  onAdminLoginSuccess: (token: string, user: any) => void;
}

export const AdminScreen: React.FC<AdminScreenProps> = ({
  currentUser,
  authToken,
  onAdminLoginSuccess,
}) => {
  const [passkey, setPasskey] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);

  // Admin Dashboard State
  const [submissions, setSubmissions] = useState<any[]>([]);
  const [tokenStats, setTokenStats] = useState<TokenUsageStats | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Search & Filter State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Event Timer State
  const [timerState, setTimerState] = useState<EventTimer | null>(null);
  const [timerLogs, setTimerLogs] = useState<TimerActionLog[]>([]);
  const [showTimerLogs, setShowTimerLogs] = useState(false);
  const [timerActionLoading, setTimerActionLoading] = useState(false);
  const [addTimeInput, setAddTimeInput] = useState<number>(5);
  const [startDurationInput, setStartDurationInput] = useState<number>(60);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // AI Judge Config State
  const [aiConfig, setAiConfig] = useState<{
    isAiJudgeEnabled: boolean;
    provider: 'openai' | 'featherless';
    model: string;
    rubricVersion: string;
    maxConcurrency: number;
    maxRetries: number;
    budgetUsd: number;
    spentUsd: number;
    feedbackReleaseMode: 'immediate' | 'after_event' | 'manual_only';
  }>({
    isAiJudgeEnabled: false,
    provider: 'openai',
    model: 'gpt-4o',
    rubricVersion: 'v1',
    maxConcurrency: 2,
    maxRetries: 3,
    budgetUsd: 50.0,
    spentUsd: 0,
    feedbackReleaseMode: 'immediate',
  });
  const [savingAiConfig, setSavingAiConfig] = useState(false);
  const [testConnectionLoading, setTestConnectionLoading] = useState(false);
  const [testConnectionResult, setTestConnectionResult] = useState<{
    ok: boolean;
    message: string;
    details?: any;
  } | null>(null);

  // Queue State
  const [queueStatus, setQueueStatus] = useState<{
    summary: Record<string, number>;
    activeJobs: any[];
  }>({ summary: {}, activeJobs: [] });

  // Evaluation Inspect Modal
  const [inspectSubmission, setInspectSubmission] = useState<any | null>(null);
  const [inspectEvaluation, setInspectEvaluation] = useState<any | null>(null);
  const [inspectHistory, setInspectHistory] = useState<any[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);

  // Score Override Modal
  const [overrideSub, setOverrideSub] = useState<any | null>(null);
  const [overrideScore, setOverrideScore] = useState<number>(75);
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideLoading, setOverrideLoading] = useState(false);

  // Evaluation Trigger & Re-evaluate State
  const [evaluatingSubId, setEvaluatingSubId] = useState<string | null>(null);

  // Benchmark & Dataset Export
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<any | null>(null);

  // Future Endpoint Tester State
  const [testSubId, setTestSubId] = useState('');
  const [testRunning, setTestRunning] = useState(false);
  const [testResponse, setTestResponse] = useState<any | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const isOrganizer = currentUser?.role === 'organizer';

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setLoggingIn(true);
    try {
      const data = await apiClient.post('/api/auth/admin-login', { passkey: passkey.trim() }, { skipAuth: true });
      onAdminLoginSuccess(data.token, data.user);
    } catch (err: any) {
      setLoginError(err.message || 'Authentication error');
    } finally {
      setLoggingIn(false);
    }
  };

  const fetchAdminData = useCallback(async () => {
    if (!authToken && !isOrganizer) return;
    try {
      const [subsData, statsData, timerData, logsData, cfgData, queueData] = await Promise.all([
        apiClient.get('/api/admin/submissions').catch(() => ({ submissions: [] })),
        apiClient.get('/api/admin/token-stats').catch(() => null),
        apiClient.get('/api/admin/timer/state').catch(() => null),
        apiClient.get('/api/admin/timer/logs').catch(() => ({ logs: [] })),
        apiClient.get('/api/admin/ai-judge/config').catch(() => null),
        apiClient.get('/api/admin/ai-judge/queue').catch(() => ({ summary: {}, activeJobs: [] })),
      ]);

      if (subsData?.submissions) {
        setSubmissions(subsData.submissions || []);
        if (subsData.submissions?.length > 0) {
          setTestSubId((prev) => prev || subsData.submissions[0].id);
        }
      }

      if (statsData) {
        setTokenStats(statsData);
      }

      if (timerData) {
        setTimerState(timerData);
      }

      if (logsData?.logs) {
        setTimerLogs(logsData.logs || []);
      }

      if (cfgData) {
        setAiConfig({
          isAiJudgeEnabled: Boolean(cfgData.isAiJudgeEnabled),
          provider: cfgData.provider || 'openai',
          model: cfgData.model || (cfgData.provider === 'featherless' ? 'meta-llama/Meta-Llama-3.1-8B-Instruct' : 'gpt-4o'),
          rubricVersion: cfgData.rubricVersion || 'v1',
          maxConcurrency: cfgData.maxConcurrency || 2,
          maxRetries: cfgData.maxRetries || 3,
          budgetUsd: cfgData.budgetUsd ?? 50.0,
          spentUsd: cfgData.spentUsd ?? 0.0,
          feedbackReleaseMode: cfgData.feedbackReleaseMode || 'immediate',
        });
      }

      if (queueData) {
        setQueueStatus(queueData);
      }
    } catch (err) {
      console.error('Error fetching admin data:', err);
    } finally {
      setLoadingData(false);
    }
  }, [authToken, isOrganizer]);

  useEffect(() => {
    if (!isOrganizer) return;
    let cancelled = false;

    const syncAdmin = () => {
      Promise.all([
        apiClient.get('/api/admin/submissions').catch(() => ({ submissions: [] })),
        apiClient.get('/api/admin/token-stats').catch(() => null),
        apiClient.get('/api/admin/timer/state').catch(() => null),
        apiClient.get('/api/admin/timer/logs').catch(() => ({ logs: [] })),
        apiClient.get('/api/admin/ai-judge/config').catch(() => null),
        apiClient.get('/api/admin/ai-judge/queue').catch(() => ({ summary: {}, activeJobs: [] })),
      ])
        .then(([subsData, statsData, timerData, logsData, cfgData, queueData]) => {
          if (cancelled) return;
          if (subsData?.submissions) {
            setSubmissions(subsData.submissions || []);
            if (subsData.submissions?.length > 0) {
              setTestSubId((prev) => prev || subsData.submissions[0].id);
            }
          }
          if (statsData) setTokenStats(statsData);
          if (timerData) setTimerState(timerData);
          if (logsData?.logs) setTimerLogs(logsData.logs || []);
          if (cfgData) {
            setAiConfig({
              isAiJudgeEnabled: Boolean(cfgData.isAiJudgeEnabled),
              provider: cfgData.provider || 'openai',
              model:
                cfgData.model ||
                (cfgData.provider === 'featherless'
                  ? 'meta-llama/Meta-Llama-3.1-8B-Instruct'
                  : 'gpt-4o'),
              rubricVersion: cfgData.rubricVersion || 'v1',
              maxConcurrency: cfgData.maxConcurrency || 2,
              maxRetries: cfgData.maxRetries || 3,
              budgetUsd: cfgData.budgetUsd ?? 50.0,
              spentUsd: cfgData.spentUsd ?? 0.0,
              feedbackReleaseMode: cfgData.feedbackReleaseMode || 'immediate',
            });
          }
          if (queueData) setQueueStatus(queueData);
        })
        .catch((err) => {
          console.error('Error fetching admin data:', err);
        })
        .finally(() => {
          if (!cancelled) setLoadingData(false);
        });
    };

    syncAdmin();
    const interval = setInterval(syncAdmin, 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOrganizer]);

  // Local tick for admin timer countdown display
  const isTimerRunning = timerState?.status === 'running';
  useEffect(() => {
    if (isTimerRunning) {
      const timer = setInterval(() => {
        setTimerState((prev) => {
          if (!prev) return null;
          const nextSec = Math.max(0, prev.remainingSeconds - 1);
          return {
            ...prev,
            remainingSeconds: nextSec,
            status: nextSec === 0 ? 'expired' : prev.status,
          };
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [isTimerRunning]);

  const handleReviewAction = async (subId: string, status: string) => {
    try {
      await apiClient.patch(`/api/admin/submissions/${subId}/review`, { status });
      setActionMessage(`Submission ${subId} marked as ${status}`);
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error updating review: ${err.message}`);
    }
  };

  const handlePublishToggle = async (subId: string, currentStatus: boolean) => {
    const willPublish = !currentStatus;
    if (
      !window.confirm(
        `Are you sure you want to ${
          willPublish ? 'PUBLISH' : 'UNPUBLISH'
        } this submission on the public leaderboard?`
      )
    ) {
      return;
    }

    try {
      await apiClient.patch(`/api/admin/submissions/${subId}/publish`, { isPublished: willPublish });
      setActionMessage(
        `Submission ${subId} publish state updated to ${
          willPublish ? 'Published' : 'Hidden'
        }`
      );
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error updating publish state: ${err.message}`);
    }
  };

  // Timer Control Actions
  const handleStartTimer = async () => {
    setTimerActionLoading(true);
    try {
      const data = await apiClient.post('/api/admin/timer/start', { durationMinutes: startDurationInput });
      setTimerState(data.timer);
      setActionMessage(data.message);
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error starting timer: ${err.message}`);
    } finally {
      setTimerActionLoading(false);
    }
  };

  const handleStopTimer = async () => {
    setTimerActionLoading(true);
    try {
      const data = await apiClient.post('/api/admin/timer/stop');
      setTimerState(data.timer);
      setActionMessage('Event timer paused (remaining duration frozen).');
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error stopping timer: ${err.message}`);
    } finally {
      setTimerActionLoading(false);
    }
  };

  const handleAddTime = async (minutes: number) => {
    setTimerActionLoading(true);
    try {
      const data = await apiClient.post('/api/admin/timer/add-time', { minutes });
      setTimerState(data.timer);
      setActionMessage(data.message);
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error adding time: ${err.message}`);
    } finally {
      setTimerActionLoading(false);
    }
  };

  const handleResetTimer = async () => {
    setTimerActionLoading(true);
    setShowResetConfirm(false);
    try {
      const data = await apiClient.post('/api/admin/timer/reset', { durationMinutes: startDurationInput || 60 });
      setTimerState(data.timer);
      setActionMessage('Event timer reset.');
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error resetting timer: ${err.message}`);
    } finally {
      setTimerActionLoading(false);
    }
  };

  // AI Judge Config Actions
  const handleSaveAiConfig = async () => {
    setSavingAiConfig(true);
    try {
      await apiClient.patch('/api/admin/ai-judge/config', aiConfig);
      setActionMessage('AI Judge configuration successfully updated.');
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error saving configuration: ${err.message}`);
    } finally {
      setSavingAiConfig(false);
    }
  };

  const handleTestProviderConnection = async () => {
    setTestConnectionLoading(true);
    setTestConnectionResult(null);
    try {
      const data = await apiClient.post('/api/admin/ai-judge/test-connection', {
        provider: aiConfig.provider,
        model: aiConfig.model,
      });
      setTestConnectionResult({
        ok: true,
        message: data.message,
        details: data.providerDetails,
      });
    } catch (err: any) {
      setTestConnectionResult({
        ok: false,
        message: err.message || 'Connection test failed',
      });
    } finally {
      setTestConnectionLoading(false);
    }
  };

  // Trigger Evaluation or Re-evaluation
  const handleTriggerEvaluation = async (subId: string, isReEval = false) => {
    let reEvalReason = '';
    if (isReEval) {
      const reason = window.prompt(
        'Please enter the organizer rationale for re-evaluating this deck:',
        'Organizer-requested second pass verification'
      );
      if (reason === null) return;
      reEvalReason = reason.trim() || 'Organizer-requested re-evaluation';
    }

    setEvaluatingSubId(subId);
    try {
      const endpoint = isReEval
        ? `/api/admin/submissions/${subId}/re-evaluate`
        : `/api/admin/submissions/${subId}/evaluate`;

      await apiClient.post(endpoint, isReEval ? { reason: reEvalReason } : undefined);

      setActionMessage(
        isReEval
          ? `Re-evaluation initiated for ${subId}`
          : `AI evaluation job enqueued for ${subId}`
      );
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Evaluation error: ${err.message}`);
    } finally {
      setEvaluatingSubId(null);
    }
  };

  // Open Evaluation Inspection Modal
  const handleInspectEvaluation = async (sub: any) => {
    setInspectSubmission(sub);
    setInspectLoading(true);
    setInspectEvaluation(null);
    setInspectHistory([]);
    try {
      const [fbData, histData] = await Promise.all([
        apiClient.get(`/api/submissions/${sub.id}/feedback`).catch(() => null),
        apiClient.get(`/api/admin/submissions/${sub.id}/history`).catch(() => ({ history: [] })),
      ]);

      if (fbData) {
        setInspectEvaluation(fbData);
      }
      if (histData?.history) {
        setInspectHistory(histData.history || []);
      }
    } catch (err) {
      console.error('Error inspecting evaluation:', err);
    } finally {
      setInspectLoading(false);
    }
  };

  // Human Score Override
  const handleSaveOverride = async () => {
    if (!overrideSub) return;
    if (overrideScore < 0 || overrideScore > 100) {
      alert('Score must be an integer between 0 and 100.');
      return;
    }
    if (!overrideReason.trim()) {
      alert('A justification reason is required for human score override.');
      return;
    }

    setOverrideLoading(true);
    try {
      await apiClient.patch(`/api/admin/submissions/${overrideSub.id}/override`, {
        humanScore: overrideScore,
        reason: overrideReason.trim(),
      });
      setActionMessage(`Human override of ${overrideScore}/100 saved for ${overrideSub.id}`);
      setOverrideSub(null);
      fetchAdminData();
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      alert(`Error applying override: ${err.message}`);
    } finally {
      setOverrideLoading(false);
    }
  };

  // Run Benchmark Comparison Suite
  const handleRunBenchmark = async () => {
    setBenchmarkRunning(true);
    setBenchmarkResult(null);
    try {
      const data = await apiClient.post('/api/admin/benchmark', {
        provider: aiConfig.provider,
        model: aiConfig.model,
        rubricVersion: aiConfig.rubricVersion,
      });
      setBenchmarkResult(data.benchmark);
    } catch (err: any) {
      alert(`Benchmark error: ${err.message}`);
    } finally {
      setBenchmarkRunning(false);
    }
  };

  // Test POST /api/evaluations directly
  const runEvaluationTest = async () => {
    setTestRunning(true);
    setTestError(null);
    setTestResponse(null);
    try {
      const data = await apiClient.post('/api/evaluations', { submissionId: testSubId.trim() });
      setTestResponse(data);
      fetchAdminData();
    } catch (err: any) {
      setTestError(err.message || 'Evaluation error');
    } finally {
      setTestRunning(false);
    }
  };

  const formatTimerDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  // Filtered submissions
  const filteredSubmissions = submissions.filter((sub) => {
    const matchesSearch =
      !searchTerm ||
      sub.submissionName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.teamName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.userName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.userRollNumber?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus = statusFilter === 'all' || sub.reviewStatus === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="admin-screen-wrapper">
      <Header />

      {!isOrganizer ? (
        <div className="center-card-layout">
          <form className="grey-auth-card" onSubmit={handleAdminLogin}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Shield size={24} style={{ color: '#000000' }} />
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: 22, fontWeight: 800 }}>
                Organizer Admin Access
              </h2>
            </div>
            <p style={{ fontSize: 13, color: '#4b5563', marginBottom: 20 }}>
              Authorized CCG × OpenAI organizers only. Enter the secure event passkey to manage the event timer, AI judge settings, and leaderboard scores.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  Organizer Passkey
                </label>
                <input
                  type="password"
                  className="pill-input"
                  style={{ width: '100%' }}
                  value={passkey}
                  onChange={(e) => setPasskey(e.target.value)}
                  placeholder="Enter organizer secret passkey"
                  required
                />
              </div>

              {loginError && (
                <div style={{ color: '#dc2626', fontSize: 13, background: '#fee2e2', padding: 10, borderRadius: 10 }}>
                  {loginError}
                </div>
              )}

              <button
                type="submit"
                className="orange-pill-btn"
                style={{ width: '100%', marginTop: 8 }}
                disabled={loggingIn}
              >
                {loggingIn ? 'Authenticating...' : 'Access Organizer Panel'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {/* Action Notification Toast */}
          {actionMessage && (
            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #6ee7b7',
                color: '#065f46',
                padding: '12px 20px',
                borderRadius: 14,
                fontSize: 14,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Check size={18} /> {actionMessage}
            </div>
          )}

          {/* ──────────────────────────────────────────────────────────── */}
          {/* Section 1: Event-Wide Countdown Timer Controls               */}
          {/* ──────────────────────────────────────────────────────────── */}
          <div
            style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: 20,
              padding: 24,
              boxShadow: '0 4px 15px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16,
                marginBottom: 16,
              }}
            >
              <div>
                <h3
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: 20,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Clock size={22} color="#f97316" /> Authoritative Event Timer Controller
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Controls the submission window for all participants in real time.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 900,
                    fontFamily: 'monospace',
                    background:
                      timerState?.status === 'running'
                        ? '#dcfce7'
                        : timerState?.status === 'paused'
                        ? '#fef3c7'
                        : '#fee2e2',
                    color:
                      timerState?.status === 'running'
                        ? '#166534'
                        : timerState?.status === 'paused'
                        ? '#92400e'
                        : '#991b1b',
                    padding: '6px 16px',
                    borderRadius: 12,
                    border: '1px solid rgba(0,0,0,0.08)',
                  }}
                >
                  {formatTimerDuration(timerState?.remainingSeconds || 0)}
                </span>
                <span
                  style={{
                    padding: '4px 12px',
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    background:
                      timerState?.status === 'running'
                        ? '#22c55e'
                        : timerState?.status === 'paused'
                        ? '#f59e0b'
                        : '#ef4444',
                    color: '#ffffff',
                  }}
                >
                  {timerState?.status?.replace('_', ' ') || 'IDLE'}
                </span>
                <button
                  onClick={() => setShowTimerLogs(!showTimerLogs)}
                  className="btn-sm"
                  style={{ padding: '6px 12px', borderRadius: 9999 }}
                  title="View timer action logs"
                >
                  <History size={13} style={{ display: 'inline', marginRight: 4 }} />
                  {showTimerLogs ? 'Hide Logs' : 'View Logs'}
                </button>
              </div>
            </div>

            {/* Timer Button Actions */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
                background: '#f8fafc',
                padding: '12px 16px',
                borderRadius: 14,
                border: '1px solid #e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  onClick={handleStartTimer}
                  disabled={timerActionLoading || timerState?.status === 'running'}
                  className="orange-pill-btn"
                  style={{
                    padding: '8px 18px',
                    fontSize: 13,
                    opacity: timerState?.status === 'running' ? 0.6 : 1,
                  }}
                >
                  <Play size={14} style={{ display: 'inline', marginRight: 4 }} />
                  {timerState?.status === 'paused' ? 'Resume Timer' : 'Start Timer'}
                </button>

                {timerState?.status !== 'running' && (
                  <input
                    type="number"
                    min={1}
                    max={360}
                    value={startDurationInput}
                    onChange={(e) => setStartDurationInput(Number(e.target.value))}
                    style={{
                      width: 64,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                    }}
                    title="Initial / restart duration in minutes"
                  />
                )}
                {timerState?.status !== 'running' && (
                  <span style={{ fontSize: 12, color: '#64748b' }}>min</span>
                )}
              </div>

              {/* Pause / Freeze */}
              <button
                onClick={handleStopTimer}
                disabled={timerActionLoading || timerState?.status !== 'running'}
                className="btn-sm"
                style={{
                  padding: '8px 16px',
                  borderRadius: 9999,
                  fontWeight: 700,
                  opacity: timerState?.status !== 'running' ? 0.5 : 1,
                }}
              >
                <Clock size={14} style={{ display: 'inline', marginRight: 4 }} />
                Pause Timer (Freeze Remaining)
              </button>

              {/* Add Time Quick Buttons */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginLeft: 'auto',
                  flexWrap: 'wrap',
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700, color: '#4b5563' }}>Add Time:</span>
                {[1, 5, 10, 15].map((mins) => (
                  <button
                    key={mins}
                    onClick={() => handleAddTime(mins)}
                    disabled={timerActionLoading}
                    className="btn-sm"
                    style={{
                      padding: '6px 12px',
                      borderRadius: 9999,
                      fontWeight: 700,
                      background: '#f8fafc',
                    }}
                  >
                    +{mins}m
                  </button>
                ))}

                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={addTimeInput}
                    onChange={(e) => setAddTimeInput(Number(e.target.value))}
                    style={{
                      width: 50,
                      padding: '6px 8px',
                      borderRadius: 8,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                    }}
                  />
                  <button
                    onClick={() => handleAddTime(addTimeInput)}
                    disabled={timerActionLoading || addTimeInput <= 0}
                    className="btn-sm"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 9999,
                      fontWeight: 700,
                      background: '#ffedd5',
                      color: '#c2410c',
                    }}
                  >
                    <Plus size={12} style={{ display: 'inline' }} /> Apply
                  </button>
                </div>
              </div>

              {/* Reset Timer */}
              <div style={{ marginLeft: 8 }}>
                {showResetConfirm ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: '#fee2e2',
                      padding: '4px 10px',
                      borderRadius: 10,
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#991b1b', fontWeight: 700 }}>
                      Reset to 60m?
                    </span>
                    <button
                      onClick={handleResetTimer}
                      className="btn-sm"
                      style={{
                        background: '#dc2626',
                        color: '#fff',
                        padding: '4px 8px',
                        fontSize: 11,
                      }}
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setShowResetConfirm(false)}
                      className="btn-sm"
                      style={{ padding: '4px 8px', fontSize: 11 }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="btn-sm"
                    style={{ padding: '8px 14px', borderRadius: 9999, color: '#dc2626' }}
                    title="Reset countdown with confirmation"
                  >
                    <RotateCcw size={13} style={{ display: 'inline', marginRight: 4 }} /> Reset Timer
                  </button>
                )}
              </div>
            </div>

            {/* Audit Log Drawer */}
            {showTimerLogs && (
              <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
                <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                  Timer Audit History (Authoritative)
                </h4>
                {timerLogs.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#64748b' }}>No actions logged yet.</div>
                ) : (
                  <div
                    style={{
                      maxHeight: 180,
                      overflowY: 'auto',
                      fontSize: 12,
                      background: '#f8fafc',
                      borderRadius: 10,
                      padding: 8,
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr
                          style={{
                            textAlign: 'left',
                            color: '#64748b',
                            borderBottom: '1px solid #cbd5e1',
                          }}
                        >
                          <th style={{ padding: 4 }}>Timestamp</th>
                          <th style={{ padding: 4 }}>Action</th>
                          <th style={{ padding: 4 }}>Change</th>
                          <th style={{ padding: 4 }}>Actor</th>
                          <th style={{ padding: 4 }}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {timerLogs.map((log) => (
                          <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: 4 }}>
                              {new Date(log.timestamp).toLocaleTimeString()}
                            </td>
                            <td style={{ padding: 4, fontWeight: 700, textTransform: 'uppercase' }}>
                              {log.action}
                            </td>
                            <td style={{ padding: 4 }}>
                              {log.previousState} → {log.newState}
                            </td>
                            <td style={{ padding: 4 }}>{log.organizerId}</td>
                            <td style={{ padding: 4, color: '#4b5563' }}>{log.notes || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ──────────────────────────────────────────────────────────── */}
          {/* Section 2: AI Judge Control Panel (OpenAI & Featherless)     */}
          {/* ──────────────────────────────────────────────────────────── */}
          <div
            style={{
              background: '#ffffff',
              border: '1.5px solid #e2e8f0',
              borderRadius: 20,
              padding: 24,
              boxShadow: '0 4px 15px rgba(0,0,0,0.04)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h3
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: 20,
                    fontWeight: 800,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Bot size={22} color="#f97316" /> AI Case Judge Control Panel
                </h3>
                <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                  Configurable multimodal judging pipeline supporting official OpenAI and OpenAI-compatible Featherless AI models.
                </p>
              </div>

              {/* Status Badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    padding: '6px 14px',
                    borderRadius: 9999,
                    fontSize: 12,
                    fontWeight: 800,
                    background: aiConfig.isAiJudgeEnabled ? '#dcfce7' : '#fee2e2',
                    color: aiConfig.isAiJudgeEnabled ? '#166534' : '#991b1b',
                    border: `1px solid ${aiConfig.isAiJudgeEnabled ? '#86efac' : '#fca5a5'}`,
                  }}
                >
                  {aiConfig.isAiJudgeEnabled ? '● AI JUDGE ACTIVE' : '○ MOCK MODE (OPT-IN)'}
                </span>

                <button
                  onClick={() =>
                    setAiConfig((prev) => ({
                      ...prev,
                      isAiJudgeEnabled: !prev.isAiJudgeEnabled,
                    }))
                  }
                  className="btn-sm"
                  style={{
                    padding: '8px 16px',
                    borderRadius: 9999,
                    fontWeight: 700,
                    background: aiConfig.isAiJudgeEnabled ? '#fee2e2' : '#dcfce7',
                    color: aiConfig.isAiJudgeEnabled ? '#991b1b' : '#166534',
                  }}
                >
                  {aiConfig.isAiJudgeEnabled ? 'Disable Real Judge' : 'Enable Real Judge'}
                </button>
              </div>
            </div>

            {/* AI Config Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 16,
                background: '#f8fafc',
                padding: 18,
                borderRadius: 16,
                border: '1px solid #e2e8f0',
              }}
            >
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  AI Provider
                </label>
                <select
                  value={aiConfig.provider}
                  onChange={(e) => {
                    const newProvider = e.target.value as 'openai' | 'featherless';
                    setAiConfig((prev) => ({
                      ...prev,
                      provider: newProvider,
                      model:
                        newProvider === 'featherless'
                          ? 'meta-llama/Meta-Llama-3.1-8B-Instruct'
                          : 'gpt-4o',
                    }));
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                    background: '#fff',
                  }}
                >
                  <option value="openai">OpenAI (Official SDK)</option>
                  <option value="featherless">Featherless AI (OpenAI-compatible)</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Judge Model Identifier
                </label>
                <input
                  type="text"
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                  }}
                  placeholder="e.g. gpt-4o or model ID"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Rubric Version
                </label>
                <input
                  type="text"
                  value={aiConfig.rubricVersion}
                  onChange={(e) => setAiConfig({ ...aiConfig, rubricVersion: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                  }}
                  placeholder="v1"
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Max Concurrency / Retries
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number"
                    min={1}
                    max={8}
                    value={aiConfig.maxConcurrency}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, maxConcurrency: Number(e.target.value) })
                    }
                    style={{
                      width: '50%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                    }}
                    title="Concurrency (parallel jobs)"
                  />
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={aiConfig.maxRetries}
                    onChange={(e) =>
                      setAiConfig({ ...aiConfig, maxRetries: Number(e.target.value) })
                    }
                    style={{
                      width: '50%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid #cbd5e1',
                      fontSize: 13,
                    }}
                    title="Max Retries"
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Hard-Stop Budget ($ USD)
                </label>
                <input
                  type="number"
                  step="1"
                  min="5"
                  max="1000"
                  value={aiConfig.budgetUsd}
                  onChange={(e) =>
                    setAiConfig({ ...aiConfig, budgetUsd: Number(e.target.value) })
                  }
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                  Participant Feedback Release
                </label>
                <select
                  value={aiConfig.feedbackReleaseMode}
                  onChange={(e) =>
                    setAiConfig({
                      ...aiConfig,
                      feedbackReleaseMode: e.target.value as any,
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #cbd5e1',
                    fontSize: 13,
                    background: '#fff',
                  }}
                >
                  <option value="immediate">Immediate (live upon evaluation)</option>
                  <option value="after_event">After Event (when timer expires)</option>
                  <option value="manual_only">Manual Publication Only</option>
                </select>
              </div>
            </div>

            {/* Provider Test & Save Buttons */}
            <div
              style={{
                display: 'flex',
                gap: 12,
                marginTop: 16,
                alignItems: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button
                onClick={handleSaveAiConfig}
                disabled={savingAiConfig}
                className="orange-pill-btn"
                style={{ padding: '9px 22px', fontSize: 14 }}
              >
                {savingAiConfig ? 'Saving...' : 'Save Judge Configuration'}
              </button>

              <button
                onClick={handleTestProviderConnection}
                disabled={testConnectionLoading}
                className="btn-sm"
                style={{
                  padding: '9px 18px',
                  borderRadius: 9999,
                  fontWeight: 700,
                  background: '#f1f5f9',
                }}
              >
                <Cpu size={14} style={{ display: 'inline', marginRight: 4 }} />
                {testConnectionLoading ? 'Validating Connection...' : 'Test Provider Connection'}
              </button>

              <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                {/* Dataset Export Button */}
                <a
                  href={apiClient.getUrl('/api/admin/export-dataset')}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-sm"
                  style={{
                    padding: '9px 16px',
                    borderRadius: 9999,
                    fontWeight: 700,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    background: '#e0f2fe',
                    color: '#0369a1',
                  }}
                >
                  <Download size={14} /> Export Dataset (JSONL)
                </a>

                {/* Benchmark Runner Button */}
                <button
                  onClick={handleRunBenchmark}
                  disabled={benchmarkRunning}
                  className="btn-sm"
                  style={{
                    padding: '9px 16px',
                    borderRadius: 9999,
                    fontWeight: 700,
                    background: '#fef3c7',
                    color: '#92400e',
                  }}
                >
                  <BarChart2 size={14} style={{ display: 'inline', marginRight: 4 }} />
                  {benchmarkRunning ? 'Running Benchmark...' : 'Run Benchmark'}
                </button>
              </div>
            </div>

            {/* Connection Test Diagnostics */}
            {testConnectionResult && (
              <div
                style={{
                  marginTop: 14,
                  padding: 12,
                  borderRadius: 12,
                  fontSize: 13,
                  background: testConnectionResult.ok ? '#f0fdf4' : '#fee2e2',
                  border: `1px solid ${
                    testConnectionResult.ok ? '#86efac' : '#fca5a5'
                  }`,
                  color: testConnectionResult.ok ? '#166534' : '#991b1b',
                }}
              >
                <strong>{testConnectionResult.ok ? '✓ Connection Verified:' : '✗ Connection Diagnostic:'}</strong>{' '}
                {testConnectionResult.message}
                {testConnectionResult.details && (
                  <div style={{ fontSize: 12, marginTop: 4, fontFamily: 'monospace' }}>
                    Model: {testConnectionResult.details.model} | Latency: {testConnectionResult.details.latencyMs}ms | BaseURL: {testConnectionResult.details.baseUrl}
                  </div>
                )}
              </div>
            )}

            {/* Benchmark Results Display */}
            {benchmarkResult && (
              <div
                style={{
                  marginTop: 14,
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 14,
                  padding: 16,
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 15,
                    marginBottom: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <BarChart2 size={16} color="#d97706" /> Evaluation Benchmark Report (Held-Out Test Set)
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 10,
                  }}
                >
                  <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Evaluated Decks</div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{benchmarkResult.totalDecks}</div>
                  </div>
                  <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Mean Absolute Error</div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{benchmarkResult.meanAbsoluteErrorScore?.toFixed(2)} pts</div>
                  </div>
                  <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Rank Correlation</div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{benchmarkResult.rankCorrelation?.toFixed(2)} (Spearman)</div>
                  </div>
                  <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Top-3 Overlap</div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>{((benchmarkResult.topKOverlap || 0) * 100).toFixed(0)}%</div>
                  </div>
                  <div style={{ background: '#fff', padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <div style={{ color: '#64748b', fontSize: 11 }}>Avg Cost / Deck</div>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>${benchmarkResult.averageCostPerDeck?.toFixed(4)}</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ──────────────────────────────────────────────────────────── */}
          {/* Section 3: Token Usage & Cost Accounting Ledger              */}
          {/* ──────────────────────────────────────────────────────────── */}
          <div>
            <h3
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 19,
                fontWeight: 800,
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Coins size={20} color="#f97316" /> Application Token Budget & Usage Ledger
            </h3>

            <div className="admin-stats-grid">
              <div className="admin-stat-card">
                <span className="stat-label">AI Evaluations</span>
                <span className="stat-value">{tokenStats?.actualApiEvaluationsCompleted ?? 0}</span>
                <span className="stat-sub">
                  Mock fallback: {tokenStats?.mockEvaluationsCompleted ?? 0} | Failed: {tokenStats?.failedEvaluationsCount ?? 0}
                </span>
              </div>

              <div className="admin-stat-card">
                <span className="stat-label">Total Tokens</span>
                <span className="stat-value">
                  {tokenStats?.actualTotalTokens?.toLocaleString() ?? '0'}
                </span>
                <span className="stat-sub">
                  In: {tokenStats?.actualInputTokens?.toLocaleString() ?? '0'} | Out: {tokenStats?.actualOutputTokens?.toLocaleString() ?? '0'}
                </span>
              </div>

              <div className="admin-stat-card">
                <span className="stat-label">Estimated API Cost</span>
                <span className="stat-value">
                  ${tokenStats?.estimatedActualApiCostUsd?.toFixed(4) ?? '0.0000'}
                </span>
                <span className="stat-sub">
                  Avg / deck: ${tokenStats?.averageCostPerDeckUsd?.toFixed(4) ?? '0.0000'}
                </span>
              </div>

              <div className="admin-stat-card">
                <span className="stat-label">App Hard Budget</span>
                <span className="stat-value">
                  ${aiConfig.budgetUsd?.toFixed(2) ?? '50.00'}
                </span>
                <span className="stat-sub">
                  Remaining: ${Math.max(0, (aiConfig.budgetUsd ?? 50) - (tokenStats?.estimatedActualApiCostUsd ?? 0)).toFixed(2)}
                </span>
              </div>

              <div className="admin-stat-card">
                <span className="stat-label">Queue Processing</span>
                <span className="stat-value">
                  {queueStatus?.summary?.processing ?? 0} active
                </span>
                <span className="stat-sub">
                  Pending: {queueStatus?.summary?.pending ?? 0} | Done: {queueStatus?.summary?.evaluated ?? 0}
                </span>
              </div>
            </div>

            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                padding: 14,
                borderRadius: 14,
                fontSize: 13,
                color: '#64748b',
                lineHeight: 1.5,
                marginTop: 10,
              }}
            >
              <strong>Notice on Token & Cost Accounting:</strong> Actual token metadata is normalized directly from provider responses (including cached input and reasoning tokens where available). Estimated cost is deterministically computed from the versioned catalog and represents the application-level competition budget, not an external OpenAI or Featherless billing account balance.
            </div>
          </div>

          {/* ──────────────────────────────────────────────────────────── */}
          {/* Section 4: Submissions Management & Review Table             */}
          {/* ──────────────────────────────────────────────────────────── */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 14,
              }}
            >
              <h3
                style={{
                  fontFamily: 'var(--font-heading)',
                  fontSize: 19,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Layers size={20} color="#f97316" /> Submissions Management & Review ({filteredSubmissions.length} of {submissions.length})
                {loadingData && <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8' }}>(Refreshing...)</span>}
              </h3>

              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#fff',
                    border: '1px solid #cbd5e1',
                    borderRadius: 9999,
                    padding: '4px 12px',
                  }}
                >
                  <Search size={14} color="#64748b" style={{ marginRight: 6 }} />
                  <input
                    type="text"
                    placeholder="Search participant / title..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ border: 'none', outline: 'none', fontSize: 13, width: 170 }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                  <Filter size={14} color="#64748b" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 9999,
                      border: '1px solid #cbd5e1',
                      background: '#fff',
                      fontSize: 13,
                    }}
                  >
                    <option value="all">All Statuses</option>
                    <option value="accepted">Accepted</option>
                    <option value="pending">Pending</option>
                    <option value="on_hold">On Hold</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="admin-table-container">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Submission / Team</th>
                    <th>Participant</th>
                    <th>Deck Document</th>
                    <th>Slides</th>
                    <th>Score (0–100)</th>
                    <th>AI Status</th>
                    <th>Review</th>
                    <th>Leaderboard</th>
                    <th>Organizer Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: 32, color: '#6b7280' }}>
                        No matching submissions recorded.
                      </td>
                    </tr>
                  ) : (
                    filteredSubmissions.map((sub) => {
                      const evalRecord = sub.evaluation;
                      const hasOverride = evalRecord?.humanOverrideScore !== undefined && evalRecord?.humanOverrideScore !== null;
                      const isMock = evalRecord?.isMock;
                      const needsReview = evalRecord?.needsHumanReview;

                      return (
                        <tr key={sub.id}>
                          <td>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{sub.submissionName}</div>
                            <div style={{ fontSize: 12, color: '#64748b' }}>Team: {sub.teamName}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>ID: {sub.id}</div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{sub.userName}</div>
                            <div style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace' }}>
                              {sub.userRollNumber}
                            </div>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <a
                                href={apiClient.getUrl(`/api/submissions/${sub.id}/download`)}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  color: '#2563eb',
                                  fontWeight: 600,
                                  fontSize: 13,
                                  textDecoration: 'underline',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                }}
                                title="Download presentation deck securely"
                              >
                                <Download size={13} /> {sub.deckFileName || 'presentation.pdf'}
                              </a>
                            </div>
                            {sub.fileSize ? (
                              <div style={{ fontSize: 11, color: '#94a3b8' }}>
                                {(sub.fileSize / 1024 / 1024).toFixed(1)} MB
                              </div>
                            ) : null}
                          </td>
                          <td>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: 12,
                                fontWeight: 700,
                                background: sub.slideCount > 6 ? '#fee2e2' : '#f1f5f9',
                                color: sub.slideCount > 6 ? '#991b1b' : '#334155',
                              }}
                            >
                              {sub.slideCount || 5} slides
                            </span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <div
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background:
                                    evalRecord?.evaluationStatus === 'failed'
                                      ? '#fee2e2'
                                      : hasOverride
                                      ? '#fef08a'
                                      : isMock
                                      ? '#fed7aa'
                                      : '#bbf7d0',
                                  padding: '3px 10px',
                                  borderRadius: 9999,
                                  fontWeight: 800,
                                  fontSize: 13,
                                  width: 'fit-content',
                                }}
                              >
                                {evalRecord?.evaluationStatus === 'failed' ? 'Failed' : (evalRecord?.overallScore ?? 50)}
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color:
                                      evalRecord?.evaluationStatus === 'failed'
                                        ? '#991b1b'
                                        : hasOverride
                                        ? '#854d0e'
                                        : isMock
                                        ? '#9a3412'
                                        : '#166534',
                                  }}
                                >
                                  {evalRecord?.evaluationStatus === 'failed'
                                    ? '[Failed]'
                                    : hasOverride
                                    ? '[Override]'
                                    : isMock
                                    ? '[Mock]'
                                    : '[AI]'}
                                </span>
                              </div>
                              {needsReview && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    color: '#b91c1c',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 2,
                                  }}
                                >
                                  <AlertTriangle size={11} /> Needs Review
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <span
                              style={{
                                padding: '3px 8px',
                                borderRadius: 6,
                                fontSize: 11,
                                fontWeight: 700,
                                background:
                                  evalRecord?.evaluationStatus === 'evaluated'
                                    ? '#dcfce7'
                                    : evalRecord?.evaluationStatus === 'processing'
                                    ? '#fef3c7'
                                    : evalRecord?.evaluationStatus === 'failed'
                                    ? '#fee2e2'
                                    : '#f1f5f9',
                                color:
                                  evalRecord?.evaluationStatus === 'evaluated'
                                    ? '#166534'
                                    : evalRecord?.evaluationStatus === 'processing'
                                    ? '#92400e'
                                    : evalRecord?.evaluationStatus === 'failed'
                                    ? '#991b1b'
                                    : '#475569',
                              }}
                            >
                              {evalRecord?.evaluationStatus || 'mock'}
                            </span>
                          </td>
                          <td>
                            <span className={`badge badge-${sub.reviewStatus}`}>
                              {sub.reviewStatus}
                            </span>
                          </td>
                          <td>
                            <button
                              onClick={() => handlePublishToggle(sub.id, sub.isPublished)}
                              className="btn-sm"
                              style={{
                                background: sub.isPublished ? '#dcfce7' : '#f1f5f9',
                                color: sub.isPublished ? '#166534' : '#64748b',
                                borderColor: sub.isPublished ? '#86efac' : '#cbd5e1',
                                fontWeight: 700,
                              }}
                            >
                              <Globe size={12} style={{ display: 'inline', marginRight: 4 }} />
                              {sub.isPublished ? 'Published' : 'Hidden'}
                            </button>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              {/* Inspect Evaluation Modal */}
                              <button
                                onClick={() => handleInspectEvaluation(sub)}
                                className="btn-sm"
                                style={{
                                  background: '#e0f2fe',
                                  color: '#0369a1',
                                  fontWeight: 700,
                                  padding: '5px 9px',
                                }}
                                title="Inspect AI Evaluation & Citations"
                              >
                                <Eye size={12} /> Inspect
                              </button>

                              {/* Trigger AI Evaluation / Re-eval */}
                              <button
                                onClick={() => handleTriggerEvaluation(sub.id, !isMock)}
                                disabled={evaluatingSubId === sub.id}
                                className="btn-sm"
                                style={{
                                  background: '#fed7aa',
                                  color: '#9a3412',
                                  fontWeight: 700,
                                  padding: '5px 9px',
                                }}
                                title={isMock ? 'Run AI Judge' : 'Request Second-Pass Re-evaluation'}
                              >
                                <Bot size={12} /> {isMock ? 'Judge' : 'Re-eval'}
                              </button>

                              {/* Human Override */}
                              <button
                                onClick={() => {
                                  setOverrideSub(sub);
                                  setOverrideScore(evalRecord?.overallScore ?? 75);
                                  setOverrideReason('');
                                }}
                                className="btn-sm"
                                style={{
                                  background: '#fef9c3',
                                  color: '#854d0e',
                                  fontWeight: 700,
                                  padding: '5px 9px',
                                }}
                                title="Adjudicate / Override Final Score"
                              >
                                <Edit3 size={12} /> Override
                              </button>

                              {/* Accept / Hold / Reject buttons */}
                              <button
                                onClick={() => handleReviewAction(sub.id, 'accepted')}
                                className="btn-sm btn-sm-accept"
                                title="Accept submission"
                              >
                                <Check size={12} />
                              </button>
                              <button
                                onClick={() => handleReviewAction(sub.id, 'on_hold')}
                                className="btn-sm btn-sm-hold"
                                title="Hold submission"
                              >
                                <Clock size={12} />
                              </button>
                              <button
                                onClick={() => handleReviewAction(sub.id, 'rejected')}
                                className="btn-sm btn-sm-reject"
                                title="Reject submission"
                              >
                                <X size={12} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* ──────────────────────────────────────────────────────────── */}
          {/* Section 5: Future AI Evaluation Endpoint Tester              */}
          {/* ──────────────────────────────────────────────────────────── */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 20,
              padding: 24,
              boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
            }}
          >
            <h3
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 19,
                fontWeight: 800,
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <Zap size={20} color="#f97316" /> Evaluation Endpoint Contract Tester (<code>POST /api/evaluations</code>)
            </h3>
            <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Verifies the server-side evaluation pipeline, eligibility checking, idempotency, and deterministic score calculation.
            </p>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14 }}>
              <input
                type="text"
                className="pill-input"
                style={{ maxWidth: 320 }}
                placeholder="Submission ID (e.g. sub_seed_1)"
                value={testSubId}
                onChange={(e) => setTestSubId(e.target.value)}
              />
              <button
                className="orange-pill-btn"
                style={{ fontSize: 15, padding: '10px 24px' }}
                onClick={runEvaluationTest}
                disabled={testRunning || !testSubId.trim()}
              >
                <Play size={14} style={{ display: 'inline', marginRight: 4 }} />
                {testRunning ? 'Invoking Endpoint...' : 'Test POST /api/evaluations'}
              </button>
            </div>

            {testError && (
              <div
                style={{
                  background: '#fee2e2',
                  color: '#991b1b',
                  padding: 12,
                  borderRadius: 12,
                  fontSize: 13,
                  marginBottom: 12,
                }}
              >
                {testError}
              </div>
            )}

            {testResponse && (
              <div
                style={{
                  background: '#0f172a',
                  color: '#38bdf8',
                  padding: 16,
                  borderRadius: 14,
                  fontFamily: 'monospace',
                  fontSize: 12,
                  overflowX: 'auto',
                }}
              >
                <div style={{ color: '#94a3b8', marginBottom: 6 }}>
                  // 200 OK — Idempotent Evaluation Response
                </div>
                <pre>{JSON.stringify(testResponse, null, 2)}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Modal: Evaluation Inspection & Citations                     */}
      {/* ──────────────────────────────────────────────────────────── */}
      {inspectSubmission && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 840, maxHeight: '90vh' }}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Bot size={20} color="#f97316" /> Evaluation Assessment: {inspectSubmission.submissionName}
                </h3>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
                  Team: <strong>{inspectSubmission.teamName}</strong> | Participant: {inspectSubmission.userName} ({inspectSubmission.userRollNumber})
                </div>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setInspectSubmission(null)}
              >
                <X size={18} />
              </button>
            </div>

            {inspectLoading ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                Loading evaluation audit records...
              </div>
            ) : inspectEvaluation ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Top Summary Banner */}
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
                    <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>OVERALL SCORE</div>
                    <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a' }}>
                      {inspectEvaluation.overallScore} <span style={{ fontSize: 16, color: '#64748b' }}>/ 100</span>
                    </div>
                    {inspectEvaluation.isMock && (
                      <span style={{ fontSize: 11, color: '#9a3412', fontWeight: 700 }}>
                        (Legacy Mock Evaluation)
                      </span>
                    )}
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>
                      Evaluated: {inspectEvaluation.evaluatedAt ? new Date(inspectEvaluation.evaluatedAt).toLocaleString() : 'Recent'}
                    </div>
                  </div>
                </div>

                {/* Executive Summary & Recommendation */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: 14, borderRadius: 12 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: '#166534', marginBottom: 4 }}>Executive Summary</h4>
                    <p style={{ fontSize: 13, color: '#166534', lineHeight: 1.5 }}>
                      {inspectEvaluation.executiveSummary}
                    </p>
                  </div>
                  <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: 14, borderRadius: 12 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, color: '#1e40af', marginBottom: 4 }}>Core Recommendation</h4>
                    <p style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.5 }}>
                      {inspectEvaluation.recommendation}
                    </p>
                  </div>
                </div>

                {/* 5-Criterion Breakdown Table */}
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>
                    Rubric Breakdown (5-Criterion Weighted Anchors)
                  </h4>
                  <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ background: '#f1f5f9', textAlign: 'left', color: '#475569' }}>
                          <th style={{ padding: '8px 12px' }}>Criterion</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center' }}>Rating</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center' }}>Weight</th>
                          <th style={{ padding: '8px 12px', textAlign: 'center' }}>Points</th>
                          <th style={{ padding: '8px 12px' }}>Evidence & Rationale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inspectEvaluation.criterionFeedback &&
                          Object.entries(inspectEvaluation.criterionFeedback).map(([key, val]: [string, any]) => (
                            <tr key={key} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '10px 12px', fontWeight: 600 }}>{val.criterion}</td>
                              <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                                <span style={{ background: '#fed7aa', padding: '3px 8px', borderRadius: 6, fontWeight: 800 }}>
                                  {val.rating} / 5
                                </span>
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b' }}>
                                {val.weight}%
                              </td>
                              <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700 }}>
                                {val.weightedContribution}
                              </td>
                              <td style={{ padding: '10px 12px', fontSize: 12 }}>
                                <div style={{ color: '#0f172a' }}>{val.rationale}</div>
                                <div style={{ color: '#2563eb', fontWeight: 600, marginTop: 2 }}>
                                  Cited Evidence: {val.slideEvidence || 'Deck content'}
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Strengths & Weaknesses */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div style={{ background: '#fdf4ff', border: '1px solid #f0abfc', padding: 12, borderRadius: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#86198f' }}>Key Strengths</div>
                    <p style={{ fontSize: 12, color: '#701a75', marginTop: 4 }}>{inspectEvaluation.strongestAspect}</p>
                  </div>
                  <div style={{ background: '#fff1f2', border: '1px solid #fecdd3', padding: 12, borderRadius: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#be123c' }}>Primary Weakness</div>
                    <p style={{ fontSize: 12, color: '#9f1239', marginTop: 4 }}>{inspectEvaluation.primaryWeakness}</p>
                  </div>
                </div>

                {/* Audit Version History */}
                {inspectHistory.length > 0 && (
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                    <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Evaluation Audit History</h4>
                    <div style={{ maxHeight: 120, overflowY: 'auto', fontSize: 12, background: '#f8fafc', padding: 8, borderRadius: 8 }}>
                      {inspectHistory.map((h: any) => (
                        <div key={h.id} style={{ padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                          <strong>v{h.version}</strong> — Score: {h.overall_score}/100 | Model: {h.model || 'mock'} | Reason: {h.reason || 'Evaluation'} | {new Date(h.created_at).toLocaleString()}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ padding: 20, textAlign: 'center', color: '#64748b' }}>
                No detailed evaluation record available for this submission.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ──────────────────────────────────────────────────────────── */}
      {/* Modal: Human Score Override Dialog                           */}
      {/* ──────────────────────────────────────────────────────────── */}
      {overrideSub && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: 500 }}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Edit3 size={18} color="#f97316" /> Human Score Override & Adjudication
              </h3>
              <button className="modal-close-btn" onClick={() => setOverrideSub(null)}>
                <X size={18} />
              </button>
            </div>

            <div style={{ fontSize: 13, color: '#64748b' }}>
              Override the final score for <strong>{overrideSub.submissionName}</strong> (Team: {overrideSub.teamName}). The original AI rating and evidence will be preserved in the audit log.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  Adjudicated Overall Score (0–100)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  className="pill-input"
                  style={{ width: '100%' }}
                  value={overrideScore}
                  onChange={(e) => setOverrideScore(Number(e.target.value))}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  Override Justification / Reason (Required)
                </label>
                <textarea
                  rows={3}
                  style={{
                    width: '100%',
                    borderRadius: 14,
                    border: '1px solid #cbd5e1',
                    padding: 10,
                    fontSize: 13,
                    fontFamily: 'inherit',
                  }}
                  placeholder="e.g. Organizer panel review rewarded novel LATAM academy strategy overlooked by vision OCR."
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 10 }}>
                <button
                  className="btn-sm"
                  style={{ padding: '8px 18px', borderRadius: 9999 }}
                  onClick={() => setOverrideSub(null)}
                >
                  Cancel
                </button>
                <button
                  className="orange-pill-btn"
                  style={{ padding: '8px 22px', fontSize: 14 }}
                  onClick={handleSaveOverride}
                  disabled={overrideLoading || !overrideReason.trim()}
                >
                  {overrideLoading ? 'Applying...' : 'Save Adjudicated Score'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
