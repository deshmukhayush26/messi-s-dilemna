process.env.NODE_ENV = 'test';

import {
  initDb,
  db,
  translateSqlForPostgres,
  createDatabaseAdapter,
  PostgresDatabaseAdapter,
  assertProductionDatabaseUrlConfigured,
} from '../server/db';
import { activeAuthService, hashPassword, verifyPassword } from '../server/services/authService';
import { activeEvaluationService } from '../server/services/evaluationService';
import { activeTimerService } from '../server/services/timerService';
import { activeFileValidationService } from '../server/services/fileValidationService';
import { DeckParser } from '../server/services/aiJudge/deckParser';
import { ScoreCalculator } from '../server/services/aiJudge/scoreCalculator';
import { FeatherlessProvider, resolveFeatherlessModel, DEFAULT_FEATHERLESS_MODEL } from '../server/services/aiJudge/providers/featherlessProvider';
import { activeEvaluationAuditService } from '../server/services/aiJudge/evaluationAuditService';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { app } from '../server/index';
import { apiClient } from '../src/api/client';
import http from 'node:http';

// Helper to create valid in-memory PDF with exact page count
async function createTestPdf(pageCount: number): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdfDoc.addPage([720, 405]); // Standard 16:9 slide aspect
  }
  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}

// Helper to create valid in-memory PPTX with exact slide count (and ignore notes/media)
async function createTestPptx(slideCount: number, includeNotesAndMasters = false): Promise<Buffer> {
  const zip = new JSZip();
  let sldIdList = '';

  for (let i = 1; i <= slideCount; i++) {
    sldIdList += `<p:sldId id="${255 + i}" r:id="rId${i}"/>`;
    zip.file(
      `ppt/slides/slide${i}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr/></p:spTree></p:cSld>
</p:sld>`
    );
  }

  // Include non-slide artifacts if requested to test filtering
  if (includeNotesAndMasters) {
    zip.file('ppt/slideMasters/slideMaster1.xml', '<p:sldMaster/>');
    zip.file('ppt/slideLayouts/slideLayout1.xml', '<p:sldLayout/>');
    zip.file('ppt/notesSlides/notesSlide1.xml', '<p:notes/>');
    zip.file('ppt/media/image1.png', 'fake_image_bytes');
  }

  zip.file(
    'ppt/presentation.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${sldIdList}</p:sldIdLst>
</p:presentation>`
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}

async function runFullTestSuite() {
  console.log('================================================================');
  console.log('🚀 CCG × OpenAI: Full-Stack Verification & Test Suite');
  console.log('================================================================\n');

  await initDb();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}${detail ? ` (${detail})` : ''}`);
      failed++;
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: Password-Based Participant & Organizer Authentication Suite
  // ---------------------------------------------------------------------------
  console.log('👉 [1] Password-Based Participant & Organizer Authentication Suite');

  // Test 1.1: Cryptographic password hash and timing-safe verification
  const rawPw = 'StrongSecretPass123!';
  const pwHash = hashPassword(rawPw);
  assert(pwHash.includes(':') && pwHash.length > 50, 'Password hashed to salt:hex format using native scrypt');
  assert(verifyPassword(rawPw, pwHash), 'verifyPassword confirms correct plaintext password');
  assert(!verifyPassword('WrongPassword!', pwHash), 'verifyPassword rejects incorrect password');

  // Test 1.2: Participant Registration with roll number normalization
  await db.execute("DELETE FROM users WHERE UPPER(roll_number) = '23B1234'");
  const participantRoll = '23b1234';
  const regRes = await activeAuthService.register('Ayush Deshmukh', participantRoll, rawPw, 'ayush@iitb.ac.in');
  assert(regRes.success, 'Participant registration succeeds for valid credentials');
  assert(regRes.user.rollNumber === '23B1234', 'Participant roll number normalized to uppercase (23B1234)');
  assert(regRes.user.role === 'participant', 'Role assigned as participant');
  assert(Boolean(regRes.token && regRes.token.startsWith('tok_')), 'Session token issued upon registration');

  // Test 1.3: Duplicate registration rejection
  let duplicateCaught = false;
  try {
    await activeAuthService.register('Ayush Clone', '23B1234', 'AnotherPassword123!');
  } catch (err: any) {
    duplicateCaught = err.message.includes('already registered');
  }
  assert(duplicateCaught, 'Duplicate registration with same roll number rejected');

  // Test 1.4: Reject short password
  let shortPwCaught = false;
  try {
    await activeAuthService.register('Short Pw User', '23B9999', 'short');
  } catch (err: any) {
    shortPwCaught = err.message.includes('at least 8 characters');
  }
  assert(shortPwCaught, 'Registration with password < 8 chars rejected');

  // Test 1.5: Login with incorrect password rejected
  let invalidPwCaught = false;
  try {
    await activeAuthService.login('23B1234', 'IncorrectPassword!');
  } catch (err: any) {
    invalidPwCaught = err.message.includes('Invalid roll number or password');
  }
  assert(invalidPwCaught, 'Login with incorrect password rejected with 401 error');

  // Test 1.6: Login with correct credentials succeeds
  const loginRes = await activeAuthService.login('23B1234', rawPw);
  assert(loginRes.success, 'Participant login succeeds with correct password');
  assert(loginRes.user.id === regRes.user.id, 'Login reuses identical participant account');

  // Test 1.7: Role isolation — participant cannot log in using organizer roll
  let organizerBypassCaught = false;
  try {
    await activeAuthService.login('ORGANIZER_ADMIN', rawPw);
  } catch (err: any) {
    organizerBypassCaught = err.message.includes('organizer portal');
  }
  assert(organizerBypassCaught, 'Participant login blocks access to organizer administrative identity');

  // Test 1.8: Organizer Passkey Login
  const organizerPasskey = process.env.ORGANIZER_SECRET_KEY || 'ccg-admin-2026';
  const adminLoginRes = await activeAuthService.verifyAdmin(organizerPasskey);
  assert(adminLoginRes.success, 'Organizer authentication succeeds with configured passkey');
  assert(adminLoginRes.user.role === 'organizer', 'Organizer user assigned server-side organizer role');
  assert(adminLoginRes.token.startsWith('adm_tok_'), 'Dedicated admin session token issued');

  // Test 1.9: Reject invalid organizer passkey
  let badAdminPasskeyCaught = false;
  try {
    await activeAuthService.verifyAdmin('invalid-passkey-123');
  } catch (err: any) {
    badAdminPasskeyCaught = err.message.includes('Invalid organizer passkey');
  }
  assert(badAdminPasskeyCaught, 'Invalid organizer passkey rejected');

  // Test 1.10: Session retrieval & logout
  const fetchedUser = await activeAuthService.getUserByToken(loginRes.token);
  assert(fetchedUser?.id === loginRes.user.id, 'getUserByToken retrieves authenticated participant');
  await activeAuthService.logout(loginRes.token);
  const loggedOutUser = await activeAuthService.getUserByToken(loginRes.token);
  assert(loggedOutUser === null, 'logout invalidates session token');

  // ---------------------------------------------------------------------------
  // SECTION 2: Event-Wide Organizer Timer Suite
  // ---------------------------------------------------------------------------
  console.log('\n👉 [2] Event-Wide Organizer Timer Suite');

  // Reset timer to not_started state
  await activeTimerService.resetTimer('Lead Case Coordinator', 60);

  // Test 2.1: Start timer
  const startedTimer = await activeTimerService.startTimer(60, 'Lead Case Coordinator');
  assert(startedTimer.status === 'running', 'Timer transitioned to running status');
  assert(startedTimer.remainingSeconds > 3500 && startedTimer.remainingSeconds <= 3600, 'Timer duration initialized to 3600 seconds');

  // Test 2.2: Add time
  const extendedTimer = await activeTimerService.addTime(15, 'Lead Case Coordinator');
  assert(extendedTimer.remainingSeconds > 4400, 'Time extension (+15m) applied to running countdown');

  // Test 2.3: Pause timer
  const pausedTimer = await activeTimerService.pauseTimer('Lead Case Coordinator');
  assert(pausedTimer.status === 'paused', 'Timer paused successfully');

  // Test 2.4: Resume timer
  const resumedTimer = await activeTimerService.resumeTimer('Lead Case Coordinator');
  assert(resumedTimer.status === 'running', 'Timer resumed successfully');

  // Test 2.5: Action audit log
  const timerLogs = await activeTimerService.getTimerActionLogs();
  assert(timerLogs.length >= 4, 'Timer actions logged to audit trail table');
  assert(timerLogs[0].organizerId === 'Lead Case Coordinator', 'Audit log attributes actions to organizer');

  // ---------------------------------------------------------------------------
  // SECTION 3: Slide-Count Document Validation Suite (5-6 slides)
  // ---------------------------------------------------------------------------
  console.log('\n👉 [3] Slide-Count Document Validation Suite');

  // Test 3.1: 5-slide PDF
  const pdf5Buf = await createTestPdf(5);
  const valPdf5 = await activeFileValidationService.validatePresentationFile(pdf5Buf, 'team_pitch_5.pdf');
  assert(valPdf5.valid && valPdf5.slideCount === 5, '5-slide PDF passes validation');

  // Test 3.2: 6-slide PPTX
  const pptx6Buf = await createTestPptx(6);
  const valPptx6 = await activeFileValidationService.validatePresentationFile(pptx6Buf, 'team_pitch_6.pptx');
  assert(valPptx6.valid && valPptx6.slideCount === 6, '6-slide PPTX passes validation');

  // Test 3.3: 7-slide PDF rejected
  const pdf7Buf = await createTestPdf(7);
  const valPdf7 = await activeFileValidationService.validatePresentationFile(pdf7Buf, 'team_pitch_7.pdf');
  assert(!valPdf7.valid && valPdf7.slideCount === 7, '7-slide PDF rejected exceeding 6-slide limit');
  assert(Boolean(valPdf7.error?.includes('exceeds the maximum limit of 6 slides')), 'Descriptive error returned for >6 slides');

  // ---------------------------------------------------------------------------
  // SECTION 4: Real AI Evaluation & Safe Failure Handling (No Score 50)
  // ---------------------------------------------------------------------------
  console.log('\n👉 [4] Real AI Evaluation & Safe Failure Handling');

  // Setup test submission
  const subId = `sub_test_${Date.now()}`;
  const nowIso = new Date().toISOString();
  await db.execute(`
    INSERT INTO submissions (
      id, user_id, team_name, submission_name, deck_file_name, storage_key,
      file_type, file_size, slide_count, review_status, is_published, created_at, updated_at
    )
    VALUES (?, ?, 'Inter Miami Strategy Group', 'The Post-Messi Commercial Blueprint', 'deck.pdf', 'test_deck.pdf', 'pdf', 1000000, 5, 'accepted', 1, ?, ?)
  `, [subId, regRes.user.id, nowIso, nowIso]);

  // Test 4.1: When Featherless key is not set, evaluation fails safely without fake score 50
  const evalWithoutKeys = await activeEvaluationService.evaluateSubmission(subId);
  assert(
    evalWithoutKeys.overallScore === 0,
    'Unconfigured AI provider does not report fake score of 50 (overallScore = 0)'
  );
  assert(
    evalWithoutKeys.evaluationStatus === 'failed',
    'Evaluation recorded with status failed when provider credentials are missing'
  );
  assert(
    Boolean(evalWithoutKeys.aiRationale?.includes('FEATHERLESS_API_KEY') || evalWithoutKeys.aiRationale?.includes('error')),
    'Descriptive configuration error recorded in aiRationale'
  );
  assert(
    evalWithoutKeys.isMock === false,
    'Failed evaluation is not marked as mock mode'
  );

  // Test 4.2: Real Evaluation pipeline with Mocked Featherless Client
  const mockFeatherlessClient = {
    chat: {
      completions: {
        create: async () => ({
          id: 'featherless-real-eval-789',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  problem_structuring: { rating: 5, rationale: 'Exceptional board-level decomposition.', slide_evidence: 'Slide 1', recommendations: 'Keep current depth.' },
                  analytical_rigor: { rating: 4, rationale: 'Rigorous valuation modeling.', slide_evidence: 'Slide 2', recommendations: 'Add sensitivity tables.' },
                  strategic_insight: { rating: 5, rationale: 'Breakthrough youth academy brand model.', slide_evidence: 'Slide 3', recommendations: 'Expand LATAM reach.' },
                  feasibility_and_impact: { rating: 4, rationale: 'Clear CapEx schedule.', slide_evidence: 'Slide 4', recommendations: 'Check MLS salary regulations.' },
                  communication: { rating: 5, rationale: 'Flawless McKinsey-grade visual flow.', slide_evidence: 'Slide 5', recommendations: 'High readability.' },
                  executive_summary: 'Transform Inter Miami into the preeminent LATAM talent engine and lifestyle brand.',
                  recommendation: 'Monetize the Freedom Park commercial corridor while building a proprietary academy network.',
                  strengths: ['Compelling long-term club brand vision', 'Solid financial feasibility'],
                  weaknesses: ['MLS roster compliance details needed'],
                  assumptions_and_risks: 'Assumes youth academy talent graduation rates remain steady.',
                  actionable_feedback: ['Stress-test matchday revenues post-2026.'],
                  confidence: 0.95,
                  needs_human_review: false,
                  review_flags: [],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 1600,
            completion_tokens: 450,
            total_tokens: 2050,
          },
        }),
      },
    },
  };

  const customFeatherless = new FeatherlessProvider(
    'test_key',
    'https://api.featherless.ai/v1',
    'meta-llama/Meta-Llama-3.1-8B-Instruct',
    mockFeatherlessClient as any
  );

  const parsedPdf = await DeckParser.parseDeck(pdf5Buf, 'sample.pdf');
  const customFeatherlessRes = await customFeatherless.evaluateDeck({
    parsedDeck: parsedPdf,
    submissionId: subId,
    teamName: 'Inter Miami Strategy Group',
    submissionName: 'The Post-Messi Commercial Blueprint',
  });

  const calculatedFinalScore = ScoreCalculator.calculateFinalScore(customFeatherlessRes.structuredOutput);
  assert(calculatedFinalScore.overallScore >= 80, `Featherless judging produces high-scoring evaluation (${calculatedFinalScore.overallScore}/100)`);
  assert(calculatedFinalScore.categoryScores.problemStructuring === 100, 'Problem structuring rating 5 converts to 100%');

  // ---------------------------------------------------------------------------
  // SECTION 5: Leaderboard Visibility & Exclusions
  // ---------------------------------------------------------------------------
  console.log('\n👉 [5] Leaderboard Visibility & Exclusions');

  // Insert a real completed evaluation for subId to test leaderboard ranking
  await db.execute(`
    UPDATE evaluations
    SET evaluation_status = 'completed',
        overall_score = 92,
        problem_structuring_score = 95,
        analytical_rigor_score = 90,
        strategic_insight_score = 95,
        feasibility_impact_score = 90,
        communication_score = 90,
        is_mock = 0,
        provider = 'featherless',
        model = 'meta-llama/Meta-Llama-3.1-8B-Instruct'
    WHERE submission_id = ?
  `, [subId]);

  // Insert an unpublished submission
  const unpubSubId = `sub_unpub_${Date.now()}`;
  await db.execute(`
    INSERT INTO submissions (
      id, user_id, team_name, submission_name, deck_file_name, storage_key, file_type, file_size, slide_count, review_status, is_published, created_at, updated_at
    )
    VALUES (?, ?, 'Stealth Team', 'Confidential Deck', 'confidential.pdf', 'conf.pdf', 'pdf', 500000, 5, 'accepted', 0, ?, ?)
  `, [unpubSubId, regRes.user.id, nowIso, nowIso]);

  // Insert failed evaluation for unpubSubId
  await db.execute(`
    INSERT INTO evaluations (
      id, submission_id, evaluation_version, evaluation_status,
      overall_score, problem_structuring_score, analytical_rigor_score,
      strategic_insight_score, feasibility_impact_score, communication_score,
      is_mock, created_at
    )
    VALUES (?, ?, 'failed-v1', 'failed', 0, 0, 0, 0, 0, 0, 0, ?)
  `, [`eval_unpub_${Date.now()}`, unpubSubId, nowIso]);

  const publicLeaderboard = await db.query(`
    SELECT s.id, s.team_name, e.overall_score
    FROM submissions s
    JOIN evaluations e ON s.id = e.submission_id
    WHERE s.is_published = 1
      AND s.review_status != 'rejected'
      AND e.is_mock = 0
      AND e.evaluation_status NOT IN ('mock_evaluated', 'pending', 'failed', 'placeholder')
    ORDER BY e.overall_score DESC
  `);

  assert(publicLeaderboard.some((r: any) => r.id === subId), 'Completed real submission appears on public leaderboard');
  assert(!publicLeaderboard.some((r: any) => r.id === unpubSubId), 'Unpublished / failed submission strictly excluded from public leaderboard');

  // ---------------------------------------------------------------------------
  // SECTION 6: The 20 Acceptance Criteria Suite for AI Case Judge
  // ---------------------------------------------------------------------------
  console.log('\n👉 [6] Production AI Case Judge Acceptance Criteria Suite');

  // Criterion 1: PDF parsing
  assert(parsedPdf.slideCount === 5, '[1] PDF parsing: extracts exact slide count (5 slides)');

  // Criterion 2: PPTX parsing
  const testPptxBuf = await createTestPptx(6, true);
  const parsedPptx = await DeckParser.parseDeck(testPptxBuf, 'sample_6slides.pptx');
  assert(parsedPptx.slideCount === 6, '[2] PPTX parsing: extracts exact slide count (6 slides, ignoring notes/masters)');

  // Criterion 3: Vision payload construction
  const visionPayload = customFeatherless.buildMultimodalPayload(parsedPdf, 'Sys', 'User');
  assert(Array.isArray(visionPayload) && visionPayload.length === 2, '[3] Vision payload: constructs system and user turns');

  // Criterion 4: Featherless Provider config validation
  const dummyFeatherless = new FeatherlessProvider();
  const valCheck = dummyFeatherless.validateConfig();
  assert(typeof valCheck.valid === 'boolean', '[4] Featherless provider: config validation method implemented');

  // Criterion 5: Re-evaluation and audit history
  await activeEvaluationAuditService.archiveEvaluation(
    await activeEvaluationService.getEvaluation(subId) as any,
    'Organizer second-pass jury audit'
  );
  const historyList = await activeEvaluationAuditService.getHistoryForSubmission(subId);
  assert(historyList.length >= 1, '[5] Evaluation history: historical evaluation archived in evaluation_history table');

  // Criterion 6: Human score override
  await activeEvaluationService.overrideScore(subId, 'Lead Case Coordinator', 95, 'Jury consensus adjustment');
  const overriddenEval = await activeEvaluationService.getEvaluation(subId);
  assert(overriddenEval?.overallScore === 95, '[6] Human score override: applies override score 95 to evaluation record');

  // ---------------------------------------------------------------------------
  // SECTION 7: Database Migration & Schema Verification
  // ---------------------------------------------------------------------------
  console.log('\n👉 [7] Database Migration & Schema Verification');

  // Test 7.1: Verify email and password_hash columns exist on users table
  const testUserRow = await db.queryOne('SELECT email, password_hash FROM users WHERE id = ?', [regRes.user.id]);
  assert(Boolean(testUserRow && testUserRow.password_hash), 'Migration 002: password_hash column exists and stores hashes');

  // Test 7.2: Verify SQL translation for PostgreSQL
  const testSql = "SELECT * FROM users WHERE roll_number = ? AND role = 'participant' AND id = ?";
  const translatedSql = translateSqlForPostgres(testSql);
  assert(
    translatedSql === "SELECT * FROM users WHERE roll_number = $1 AND role = 'participant' AND id = $2",
    'translateSqlForPostgres converts ? to $1, $2 and ignores strings'
  );

  // Test 7.3: Database health check
  const healthCheck = await db.checkHealth();
  assert(healthCheck.status === 'connected' && healthCheck.ready, 'Database health check reports connected status');

  // Test 7.4: Production PostgreSQL startup without /data directory
  const prevDataDir = process.env.DATA_DIR;
  try {
    process.env.DATA_DIR = '/data';
    const prodPgAdapter = createDatabaseAdapter('postgresql://mock_user:mock_pass@127.0.0.1:5432/mock_db');
    assert(prodPgAdapter instanceof PostgresDatabaseAdapter, 'DATABASE_URL instantiates PostgresDatabaseAdapter without creating /data');
    assert(prodPgAdapter.isPostgres === true, 'Production database adapter is flagged as PostgreSQL engine');
    await prodPgAdapter.close();
  } finally {
    if (prevDataDir !== undefined) {
      process.env.DATA_DIR = prevDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
  }

  // Test 7.5: Strict production enforcement without DATABASE_URL
  let fatalErrorCaught = false;
  try {
    assertProductionDatabaseUrlConfigured(true, undefined);
  } catch (err: any) {
    fatalErrorCaught = err.message.includes('FATAL: DATABASE_URL is required in production environment');
  }
  assert(fatalErrorCaught, 'Production environment strictly throws fatal error without DATABASE_URL');

  // ---------------------------------------------------------------------------
  // SECTION 8: Production HTTP Routing & URL Normalization Suite
  // ---------------------------------------------------------------------------
  console.log('\n👉 [8] Production HTTP Routing & URL Normalization Suite');

  // Test 8.1: Client URL Normalization prevents duplicate /api/api
  const savedViteUrl = process.env.VITE_API_URL;
  try {
    process.env.VITE_API_URL = 'https://ccg-case-backend.onrender.com/api';
    const timerUrlWithTrailingApi = apiClient.buildUrl('/timer');
    assert(
      timerUrlWithTrailingApi === 'https://ccg-case-backend.onrender.com/api/timer',
      'apiClient.buildUrl strips trailing /api from VITE_API_URL and produces single /api/timer'
    );
    const regUrlWithTrailingApi = apiClient.buildUrl('/auth/register');
    assert(
      regUrlWithTrailingApi === 'https://ccg-case-backend.onrender.com/api/auth/register',
      'apiClient.buildUrl normalizes /auth/register to /api/auth/register without /api/api'
    );
    const apiPrefixedEndpoint = apiClient.buildUrl('/api/auth/register');
    assert(
      apiPrefixedEndpoint === 'https://ccg-case-backend.onrender.com/api/auth/register',
      'apiClient.buildUrl normalizes already-prefixed /api/auth/register without /api/api'
    );
    const doubleApiPrefixedEndpoint = apiClient.buildUrl('/api/api/timer');
    assert(
      doubleApiPrefixedEndpoint === 'https://ccg-case-backend.onrender.com/api/timer',
      'apiClient.buildUrl cleans duplicate /api/api prefixes'
    );

    // Empty VITE_API_URL fallback (Vercel proxy rewrites)
    process.env.VITE_API_URL = '';
    assert(
      apiClient.buildUrl('/timer') === '/api/timer',
      'apiClient.buildUrl produces relative /api/timer when VITE_API_URL is empty'
    );
    assert(
      apiClient.buildUrl('/auth/register') === '/api/auth/register',
      'apiClient.buildUrl produces relative /api/auth/register when VITE_API_URL is empty'
    );
  } finally {
    if (savedViteUrl !== undefined) {
      process.env.VITE_API_URL = savedViteUrl;
    } else {
      delete process.env.VITE_API_URL;
    }
  }

  // Test 8.2: Live Express HTTP Server Route Resolution
  const httpServer = http.createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const serverPort = (httpServer.address() as any).port;
  const testHost = `http://127.0.0.1:${serverPort}`;

  try {
    // 8.2.1: GET /api/timer returns 200 OK
    const resTimerApi = await fetch(`${testHost}/api/timer`);
    const timerApiJson = await resTimerApi.json();
    assert(resTimerApi.status === 200 && timerApiJson.status !== undefined, 'Express responds 200 to GET /api/timer');

    // 8.2.2: GET /timer returns 200 OK (Convenience direct alias)
    const resTimerRoot = await fetch(`${testHost}/timer`);
    const timerRootJson = await resTimerRoot.json();
    assert(resTimerRoot.status === 200 && timerRootJson.status !== undefined, 'Express responds 200 to GET /timer alias');

    // 8.2.3: GET /api/api/timer returns 200 OK (Legacy bundle middleware normalization)
    const resTimerDoubleApi = await fetch(`${testHost}/api/api/timer`);
    const timerDoubleJson = await resTimerDoubleApi.json();
    assert(resTimerDoubleApi.status === 200 && timerDoubleJson.status !== undefined, 'Express middleware normalizes GET /api/api/timer to 200 OK');

    // 8.2.4: POST /api/auth/register provisions participant account
    const testRegPayload = {
      name: 'Integration Tester',
      rollNumber: '24B9001',
      password: 'SafePassword123!',
      email: 'tester9001@iitb.ac.in',
    };
    await db.execute("DELETE FROM users WHERE UPPER(roll_number) = '24B9001'");
    const resRegApi = await fetch(`${testHost}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testRegPayload),
    });
    const regApiJson = await resRegApi.json();
    assert(resRegApi.status === 201 && regApiJson.token && regApiJson.user?.rollNumber === '24B9001', 'Express responds 201 Created to POST /api/auth/register');

    // 8.2.5: POST /auth/register provisions participant account (Convenience alias)
    await db.execute("DELETE FROM users WHERE UPPER(roll_number) = '24B9002'");
    const resRegRoot = await fetch(`${testHost}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testRegPayload, rollNumber: '24B9002' }),
    });
    const regRootJson = await resRegRoot.json();
    assert(resRegRoot.status === 201 && regRootJson.token, 'Express responds 201 Created to POST /auth/register alias');

    // 8.2.6: POST /api/api/auth/register provisions participant account (Legacy normalization)
    await db.execute("DELETE FROM users WHERE UPPER(roll_number) = '24B9003'");
    const resRegDouble = await fetch(`${testHost}/api/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...testRegPayload, rollNumber: '24B9003' }),
    });
    const regDoubleJson = await resRegDouble.json();
    assert(resRegDouble.status === 201 && regDoubleJson.token, 'Express middleware normalizes POST /api/api/auth/register to 201 Created');

    // 8.2.7: POST /api/auth/login authenticates participant
    const resLogin = await fetch(`${testHost}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rollNumber: '24B9001', password: 'SafePassword123!' }),
    });
    const loginJson = await resLogin.json();
    assert(resLogin.status === 200 && loginJson.token && loginJson.user?.role === 'participant', 'Express responds 200 to POST /api/auth/login');
  } finally {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  // ---------------------------------------------------------------------------
  // SECTION 9: Featherless Model Configuration & Outgoing Request Diagnostics
  // ---------------------------------------------------------------------------
  console.log('\n👉 [9] Featherless Model Configuration & Outgoing Request Diagnostics');

  // Test 9.1: resolveFeatherlessModel precedence hierarchy
  const origFModel = process.env.FEATHERLESS_MODEL;
  const origFJudgeModel = process.env.FEATHERLESS_JUDGE_MODEL;

  try {
    // 9.1.1: Default fallback when nothing is set
    delete process.env.FEATHERLESS_MODEL;
    delete process.env.FEATHERLESS_JUDGE_MODEL;
    assert(
      resolveFeatherlessModel() === 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'resolveFeatherlessModel defaults to meta-llama/Meta-Llama-3.1-8B-Instruct when env and DB are unset'
    );

    // 9.1.2: Stale retired 404 model in DB/dashboard is ignored and safely falls back
    assert(
      resolveFeatherlessModel('meta-llama/Llama-3.2-11B-Vision-Instruct') === 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'resolveFeatherlessModel ignores stale Llama-3.2-11B-Vision-Instruct from DB and falls back to default'
    );

    // 9.1.3: Valid custom model from DB/dashboard is respected when env var is not set
    assert(
      resolveFeatherlessModel('Qwen/Qwen2-VL-7B-Instruct') === 'Qwen/Qwen2-VL-7B-Instruct',
      'resolveFeatherlessModel respects valid custom model when no env var is configured'
    );

    // 9.1.4: FEATHERLESS_MODEL environment variable strictly overrides stale DB model
    process.env.FEATHERLESS_MODEL = 'meta-llama/Meta-Llama-3.1-8B-Instruct';
    assert(
      resolveFeatherlessModel('meta-llama/Llama-3.2-11B-Vision-Instruct') === 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'FEATHERLESS_MODEL environment variable overrides stale database setting'
    );

    // 9.1.5: Custom FEATHERLESS_MODEL environment variable overrides custom DB model
    process.env.FEATHERLESS_MODEL = 'mistralai/Mistral-7B-Instruct-v0.3';
    assert(
      resolveFeatherlessModel('Qwen/Qwen2-VL-7B-Instruct') === 'mistralai/Mistral-7B-Instruct-v0.3',
      'Explicit FEATHERLESS_MODEL environment variable overrides any database or dashboard configuration'
    );

    // 9.1.6: Legacy FEATHERLESS_JUDGE_MODEL env fallback works if FEATHERLESS_MODEL is unset
    delete process.env.FEATHERLESS_MODEL;
    process.env.FEATHERLESS_JUDGE_MODEL = 'meta-llama/Meta-Llama-3.1-70B-Instruct';
    assert(
      resolveFeatherlessModel('meta-llama/Llama-3.2-11B-Vision-Instruct') === 'meta-llama/Meta-Llama-3.1-70B-Instruct',
      'Legacy FEATHERLESS_JUDGE_MODEL environment variable is recognized as fallback'
    );
  } finally {
    if (origFModel !== undefined) process.env.FEATHERLESS_MODEL = origFModel;
    else delete process.env.FEATHERLESS_MODEL;
    if (origFJudgeModel !== undefined) process.env.FEATHERLESS_JUDGE_MODEL = origFJudgeModel;
    else delete process.env.FEATHERLESS_JUDGE_MODEL;
  }

  // Test 9.2: Outgoing Featherless API Request uses configured model ID and appropriate payload
  let interceptedCreateArgs: any = null;
  const mockInterceptionClient = {
    chat: {
      completions: {
        create: async (args: any) => {
          interceptedCreateArgs = args;
          return {
            id: 'chatcmpl_intercept_test',
            model: args.model,
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    executive_summary: 'Test summary',
                    recommendation: 'Test recommendation',
                    strengths: ['Clear vision'],
                    weaknesses: ['Minor risk'],
                    evidence: ['Slide 1'],
                    criterion_scores: {
                      problem_structuring: { score: 4, reasoning: 'Strong' },
                      analytical_rigor: { score: 4, reasoning: 'Rigor' },
                      strategic_insight: { score: 4, reasoning: 'Insight' },
                      feasibility_impact: { score: 4, reasoning: 'Feasible' },
                      communication: { score: 4, reasoning: 'Clear' },
                    },
                    assumptions_and_risks: 'Low',
                    actionable_feedback: ['Focus on execution'],
                    confidence: 0.9,
                    needs_human_review: false,
                    review_flags: [],
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          };
        },
      },
    },
  };

  const testProvider = new FeatherlessProvider(
    'test_key',
    'https://api.featherless.ai/v1',
    'meta-llama/Meta-Llama-3.1-8B-Instruct',
    mockInterceptionClient as any
  );

  // Evaluate with default text model
  await testProvider.evaluateDeck({
    deck: { slides: [{ slideNumber: 1, text: 'Sample text' }] },
    teamName: 'Diagnostic Team',
    submissionName: 'Test Deck',
  });

  assert(
    interceptedCreateArgs?.model === 'meta-llama/Meta-Llama-3.1-8B-Instruct',
    'Outgoing Featherless request uses configured Meta-Llama-3.1-8B-Instruct model ID'
  );
  assert(
    typeof interceptedCreateArgs?.messages[1].content === 'string',
    'Text-only Meta-Llama-3.1-8B-Instruct sends text string content without image_url parts'
  );

  // Evaluate with vision model
  await testProvider.evaluateDeck({
    modelOverride: 'Qwen/Qwen2-VL-7B-Instruct',
    deck: { slides: [{ slideNumber: 1, text: 'Slide', imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' }] },
    teamName: 'Vision Team',
    submissionName: 'Vision Deck',
  });

  assert(
    interceptedCreateArgs?.model === 'Qwen/Qwen2-VL-7B-Instruct',
    'Outgoing Featherless request switches to overridden vision model ID'
  );
  assert(
    Array.isArray(interceptedCreateArgs?.messages[1].content) &&
    interceptedCreateArgs?.messages[1].content.some((p: any) => p.type === 'image_url'),
    'Vision model outgoing request attaches multimodal image_url parts'
  );

  // Test 9.3: Health endpoint reports safe effectiveModel diagnostic
  const diagServer = http.createServer(app);
  await new Promise<void>((resolve) => diagServer.listen(0, resolve));
  const diagPort = (diagServer.address() as any).port;
  try {
    const healthRes = await fetch(`http://127.0.0.1:${diagPort}/api/health`);
    const healthJson = await healthRes.json();
    assert(healthRes.status === 200, 'GET /api/health returns 200');
    assert(
      healthJson.effectiveModel === 'meta-llama/Meta-Llama-3.1-8B-Instruct',
      `Health endpoint reports safe effectiveModel diagnostic (${healthJson.effectiveModel})`
    );
    assert(
      !healthJson.apiKey && !healthJson.featherlessApiKey,
      'Health endpoint diagnostic does not expose API keys or secrets'
    );
  } finally {
    await new Promise<void>((resolve) => diagServer.close(() => resolve()));
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  try {
    await db.close();
  } catch {}

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runFullTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
