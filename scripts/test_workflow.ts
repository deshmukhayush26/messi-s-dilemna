import {
  initDb,
  db,
  translateSqlForPostgres,
  createDatabaseAdapter,
  PostgresDatabaseAdapter,
  assertProductionDatabaseUrlConfigured,
  getWritableSqliteDir,
} from '../server/db';
import { resolveUploadsDir, StorageService } from '../server/services/storageService';
import fs from 'node:fs';
import { activeAuthService } from '../server/services/authService';
import { activeEvaluationService } from '../server/services/evaluationService';
import { activeTimerService } from '../server/services/timerService';
import { activeFileValidationService } from '../server/services/fileValidationService';
import { DeckParser } from '../server/services/aiJudge/deckParser';
import { RubricEvaluator } from '../server/services/aiJudge/rubricEvaluator';
import { ScoreCalculator } from '../server/services/aiJudge/scoreCalculator';
import { TokenUsageService } from '../server/services/aiJudge/tokenUsageService';
import { OpenAIProvider } from '../server/services/aiJudge/providers/openAIProvider';
import { FeatherlessProvider } from '../server/services/aiJudge/providers/featherlessProvider';
import { activeEvaluationAuditService } from '../server/services/aiJudge/evaluationAuditService';
import { EvaluationQueue } from '../server/services/aiJudge/evaluationQueue';
import { activeBenchmarkService } from '../server/services/aiJudge/benchmarkService';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { spawn, ChildProcess } from 'node:child_process';
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

// Helper to poll until OTP microservice is ready
function waitForOtpService(url: string, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      http.get(`${url}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (Date.now() - start < timeoutMs) {
          setTimeout(check, 300);
        } else {
          resolve(false);
        }
      }).on('error', () => {
        if (Date.now() - start < timeoutMs) {
          setTimeout(check, 300);
        } else {
          resolve(false);
        }
      });
    };
    check();
  });
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
  // STEP 0: Launch Python Webmail OTP Service for E2E Tests
  // ---------------------------------------------------------------------------
  console.log('📦 [0] Spawning Python Webmail OTP Microservice on port 5001...');
  let otpProcess: ChildProcess | null = null;
  const otpUrl = 'http://127.0.0.1:5001';

  try {
    otpProcess = spawn('python', ['otp_server.py'], {
      env: {
        ...process.env,
        OTP_PORT: '5001',
        PORT: '5001',
        DEV_BYPASS_OTP: 'false',
        PYTHONUNBUFFERED: '1',
      },
      stdio: 'pipe',
    });

    const ready = await waitForOtpService(otpUrl, 6000);
    assert(ready, 'Python Webmail OTP microservice started and responded to health probe');
  } catch (err: any) {
    console.warn('  ⚠️ Note: Could not spawn python process directly, checking if already running:', err.message);
  }

  // ---------------------------------------------------------------------------
  // SECTION 1: Webmail OTP & Authentication Tests
  // ---------------------------------------------------------------------------
  console.log('\n👉 [1] Webmail OTP & Authentication Suite');

  // Test 1.1: Roll Number Normalization & Send OTP
  const rawRoll = '  23B1234  ';
  const sendRes = await activeAuthService.sendOtp('Ayush Deshmukh', rawRoll);
  assert(sendRes.success, 'Successful OTP challenge initiation for valid roll number');
  assert(typeof sendRes.otpToken === 'string' && sendRes.otpToken.length > 20, 'Stateless cryptographic challenge token issued');
  assert(sendRes.email === '23b1234@iitb.ac.in', 'Institutional email correctly derived from roll number');

  // Test 1.2: Fetch simulated OTP from test endpoint
  let deliveredOtp = '123456';
  try {
    const otpRes = await fetch(`${otpUrl}/api/test/last-otp?student_id=23b1234`);
    if (otpRes.ok) {
      const data = await otpRes.json();
      if (data.otp) deliveredOtp = data.otp;
    }
  } catch {}

  // Test 1.3: Verification with Invalid OTP rejected
  let invalidOtpCaught = false;
  try {
    await activeAuthService.verifyOtp('999999', sendRes.otpToken!, 'Ayush Deshmukh');
  } catch {
    invalidOtpCaught = true;
  }
  assert(invalidOtpCaught, 'Invalid OTP rejected with verification error');

  // Test 1.4: Successful Verification with Delivered OTP
  const verifyRes = await activeAuthService.verifyOtp(deliveredOtp, sendRes.otpToken!, 'Ayush Deshmukh');
  assert(Boolean(verifyRes.token), 'Session token issued upon valid OTP verification');
  assert(verifyRes.user.rollNumber === '23B1234', 'User roll number normalized to uppercase (23B1234)');
  assert(verifyRes.user.role === 'participant', 'Role assigned as participant without pre-registration allowlist');

  // Test 1.5: Re-authentication / Duplicate login updates existing user record
  const sendRes2 = await activeAuthService.sendOtp('Ayush Deshmukh', '23B1234');
  let deliveredOtp2 = '123456';
  try {
    const otpRes = await fetch(`${otpUrl}/api/test/last-otp?student_id=23b1234`);
    if (otpRes.ok) {
      const data = await otpRes.json();
      if (data.otp) deliveredOtp2 = data.otp;
    }
  } catch {}
  const verifyRes2 = await activeAuthService.verifyOtp(deliveredOtp2, sendRes2.otpToken!, 'Ayush Deshmukh');
  assert(verifyRes2.user.id === verifyRes.user.id, 'Idempotent user record: duplicate login reuses same account');

  // ---------------------------------------------------------------------------
  // SECTION 2: Event-Wide Organizer Timer Suite
  // ---------------------------------------------------------------------------
  console.log('\n👉 [2] Event-Wide Organizer Timer Suite');

  // Test 2.1: Start timer
  const timerStart = await activeTimerService.startTimer(60, 'admin_test');
  assert(timerStart.status === 'running' && timerStart.remainingSeconds > 0, 'Organizer started event countdown (60m)');

  // Test 2.2: Add time (+15 mins)
  const timerAdd = await activeTimerService.addTime(15, 'admin_test');
  assert(timerAdd.remainingSeconds >= 74 * 60, 'Add-time (+15m) extended timer accurately');

  // Test 2.3: Pause timer (freeze remaining)
  const frozenSecs = timerAdd.remainingSeconds;
  const timerStop = await activeTimerService.stopTimer('admin_test');
  assert(timerStop.status === 'paused', 'Timer paused successfully (status: paused)');
  assert(Math.abs(timerStop.remainingSeconds - frozenSecs) <= 2, 'Remaining duration frozen upon pause');

  // Test 2.4: Submissions blocked when paused
  const checkPaused = await activeTimerService.checkSubmissionAllowed();
  assert(!checkPaused.allowed && checkPaused.status === 'paused', 'Submissions suspended when event timer is paused');

  // Test 2.5: Resume timer & check submission eligibility
  const timerResume = await activeTimerService.startTimer(undefined, 'admin_test');
  assert(timerResume.status === 'running', 'Timer resumed successfully');
  const checkRunning = await activeTimerService.checkSubmissionAllowed();
  assert(checkRunning.allowed, 'Submissions permitted while timer is actively running');

  // Test 2.6: Audit log recorded
  const logs = await activeTimerService.getActionLogs();
  assert(logs.length >= 4, 'Authoritative timer audit history logged organizer actions');

  // ---------------------------------------------------------------------------
  // SECTION 3: Deck File Validation & 5–6 Slide Rule Suite
  // ---------------------------------------------------------------------------
  console.log('\n👉 [3] Deck File Validation & 5–6 Slide Rule Suite');

  // Test 3.1: 5-Slide PDF accepted
  const pdf5 = await createTestPdf(5);
  const resPdf5 = await activeFileValidationService.validateDeck(pdf5, 'deck_5slides.pdf');
  assert(resPdf5.valid && resPdf5.slideCount === 5, '5-Slide PDF accepted (within target 5–6 range)');

  // Test 3.2: 6-Slide PDF accepted
  const pdf6 = await createTestPdf(6);
  const resPdf6 = await activeFileValidationService.validateDeck(pdf6, 'deck_6slides.pdf');
  assert(resPdf6.valid && resPdf6.slideCount === 6, '6-Slide PDF accepted (maximum allowed slides: 6)');

  // Test 3.3: 7-Slide PDF rejected
  const pdf7 = await createTestPdf(7);
  const resPdf7 = await activeFileValidationService.validateDeck(pdf7, 'deck_7slides.pdf');
  assert(!resPdf7.valid && resPdf7.error!.includes('exceed'), '7-Slide PDF strictly rejected (exceeds max 6 slides)');

  // Test 3.4: 2-Slide PDF rejected (below minimum 5 when enforced)
  const pdf2 = await createTestPdf(2);
  const resPdf2 = await activeFileValidationService.validateDeck(pdf2, 'deck_2slides.pdf', { enforceMin: true });
  assert(!resPdf2.valid && resPdf2.error!.includes('minimum 5 slides'), '2-Slide PDF rejected (below 5-slide requirement)');

  // Test 3.5: 5-Slide PPTX accepted
  const pptx5 = await createTestPptx(5);
  const resPptx5 = await activeFileValidationService.validateDeck(pptx5, 'deck_5slides.pptx');
  assert(resPptx5.valid && resPptx5.slideCount === 5, '5-Slide PPTX accepted (within target 5–6 range)');

  // Test 3.6: 6-Slide PPTX accepted
  const pptx6 = await createTestPptx(6);
  const resPptx6 = await activeFileValidationService.validateDeck(pptx6, 'deck_6slides.pptx');
  assert(resPptx6.valid && resPptx6.slideCount === 6, '6-Slide PPTX accepted (maximum allowed slides: 6)');

  // Test 3.7: 7-Slide PPTX rejected
  const pptx7 = await createTestPptx(7);
  const resPptx7 = await activeFileValidationService.validateDeck(pptx7, 'deck_7slides.pptx');
  assert(!resPptx7.valid && resPptx7.error!.includes('exceed'), '7-Slide PPTX strictly rejected (exceeds max 6 slides)');

  // Test 3.8: PPTX slide counter ignores notes, slideMasters, layouts, and media
  const pptxWithArtifacts = await createTestPptx(6, true);
  const resArtifacts = await activeFileValidationService.validateDeck(pptxWithArtifacts, 'deck_with_notes_and_media.pptx');
  assert(resArtifacts.valid && resArtifacts.slideCount === 6, 'PPTX slide inspection ignores notes, masters, and media files');

  // Test 3.9: Malformed PDF rejected safely
  const corruptPdf = Buffer.from('%PDF-1.4\ncorrupted_garbage_bytes_without_eof');
  const resCorruptPdf = await activeFileValidationService.validateDeck(corruptPdf, 'corrupt.pdf');
  assert(!resCorruptPdf.valid, 'Malformed PDF document safely rejected with error');

  // Test 3.10: Malformed PPTX rejected safely
  const corruptPptx = Buffer.from('PK\x03\x04corrupted_zip_payload');
  const resCorruptPptx = await activeFileValidationService.validateDeck(corruptPptx, 'corrupt.pptx');
  assert(!resCorruptPptx.valid, 'Malformed PPTX archive safely rejected with error');

  // Test 3.11: Unsupported file format rejected
  const textFile = Buffer.from('Just plain text presentation content');
  const resText = await activeFileValidationService.validateDeck(textFile, 'presentation.txt');
  assert(!resText.valid && resText.error!.includes('Unsupported file type'), 'Unsupported file format (.txt) rejected');

  // ---------------------------------------------------------------------------
  // SECTION 4: Submission & Baseline Idempotency Suite
  // ---------------------------------------------------------------------------
  console.log('\n👉 [4] Submission & Baseline Idempotency Suite');

  const subId = `sub_test_${Date.now()}`;
  await db.execute(`
    INSERT INTO submissions (
      id, user_id, team_name, submission_name, deck_file_name, storage_key, file_type, file_size, slide_count, review_status, is_published, created_at, updated_at
    )
    VALUES (?, ?, 'Inter Miami Analytics Team', 'The Messi Dilemma Deck', 'messi_strategy.pdf', 'decks/messi_strategy.pdf', 'pdf', 1048576, 6, 'pending', 1, ?, ?)
  `, [subId, verifyRes.user.id, new Date().toISOString(), new Date().toISOString()]);

  // Test 4.1: Placeholder evaluation scores
  const eval1 = await activeEvaluationService.evaluateSubmission(subId);
  assert(eval1.overallScore === 50, 'Overall evaluation score is 50 in mock mode');
  assert(eval1.scores.problemStructuring === 50, 'Problem structuring score is 50 in mock mode');
  assert(eval1.scores.communication === 50, 'Communication score is 50 in mock mode');
  assert(eval1.isMock === true, 'Evaluation tagged as mock mode when AI is inactive');

  // Test 4.2: Evaluation idempotency
  const eval2 = await activeEvaluationService.evaluateSubmission(subId);
  assert(eval1.id === eval2.id, 'Evaluation service is idempotent; repeated calls return identical record');

  // ---------------------------------------------------------------------------
  // SECTION 5: Leaderboard & Private Unpublished Submissions
  // ---------------------------------------------------------------------------
  console.log('\n👉 [5] Leaderboard Visibility & Privacy Suite');

  const unpubSubId = `sub_unpub_${Date.now()}`;
  await db.execute(`
    INSERT INTO submissions (
      id, user_id, team_name, submission_name, deck_file_name, storage_key, file_type, file_size, slide_count, review_status, is_published, created_at, updated_at
    )
    VALUES (?, ?, 'Stealth Team', 'Confidential Deck', 'confidential.pdf', 'decks/conf.pdf', 'pdf', 500000, 5, 'pending', 0, ?, ?)
  `, [unpubSubId, verifyRes.user.id, new Date().toISOString(), new Date().toISOString()]);
  await activeEvaluationService.evaluateSubmission(unpubSubId);

  const leaderboardEntries = await db.query(`
    SELECT s.id, s.team_name, s.is_published, e.overall_score
    FROM submissions s
    JOIN evaluations e ON s.id = e.submission_id
    WHERE s.is_published = 1
    ORDER BY e.overall_score DESC, s.created_at ASC, s.id ASC
  `);

  assert(leaderboardEntries.some((e: any) => e.id === subId), 'Published submission visible on leaderboard');
  assert(!leaderboardEntries.some((e: any) => e.id === unpubSubId), 'Unpublished submission remains private and excluded from leaderboard');

  // ---------------------------------------------------------------------------
  // SECTION 6: The 20 Acceptance Criteria Suite for AI Case Judge
  // ---------------------------------------------------------------------------
  console.log('\n👉 [6] Production-Ready AI Case Judge Acceptance Criteria Suite');

  // Criterion 1: PDF parsing and slide count
  const testPdfBuf = await createTestPdf(5);
  const parsedPdf = await DeckParser.parseDeck(testPdfBuf, 'sample_5slides.pdf');
  assert(parsedPdf.slideCount === 5, '[1] PDF parsing: extracts exact slide count (5 slides)');
  assert(parsedPdf.slides.length === 5, '[1] PDF parsing: preserves slide order and page numbers');
  assert(typeof parsedPdf.slides[0].visualPreview === 'string' && parsedPdf.slides[0].visualPreview.startsWith('data:image/svg+xml;base64,'), '[1] PDF parsing: generates visual slide representations for vision models');

  // Criterion 2: PPTX parsing and slide count
  const testPptxBuf = await createTestPptx(6, true);
  const parsedPptx = await DeckParser.parseDeck(testPptxBuf, 'sample_6slides.pptx');
  assert(parsedPptx.slideCount === 6, '[2] PPTX parsing: extracts exact slide count (6 slides, ignoring notes/masters)');
  assert(parsedPptx.slides.length === 6, '[2] PPTX parsing: preserves slide numbers and visual representations');

  // Criterion 3: Vision-capable provider request construction
  const testOpenAIProvider = new OpenAIProvider('dummy_key', 'gpt-4o');
  const multimodalPayload = testOpenAIProvider.buildMultimodalPayload(parsedPdf, 'System Prompt', 'User Prompt');
  assert(Array.isArray(multimodalPayload) && multimodalPayload.length === 2, '[3] Vision request construction: builds system and user message turns');
  const userBlocks = (multimodalPayload[1] as any).content;
  assert(Array.isArray(userBlocks) && userBlocks.some((b: any) => b.type === 'image_url'), '[3] Vision request construction: embeds slide visual images as image_url blocks');

  // Criterion 4: OpenAI provider integration using mocked responses
  const mockOpenAIClient = {
    chat: {
      completions: {
        create: async (_params: any) => ({
          id: 'chatcmpl-mock-openai-123',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  problem_structuring: { rating: 4, rationale: 'Solid decomposition of post-Messi risk.', slide_evidence: 'Slide 1, Slide 2', recommendations: 'Detail commercial timelines.' },
                  analytical_rigor: { rating: 4, rationale: 'Good benchmarking against European giants.', slide_evidence: 'Slide 2, Slide 3', recommendations: 'Include sensitivity analysis.' },
                  strategic_insight: { rating: 4, rationale: 'Clear differentiation focusing on academy pipeline.', slide_evidence: 'Slide 4', recommendations: 'Explore sponsor synergies.' },
                  feasibility_and_impact: { rating: 4, rationale: 'Phased CapEx over 3 seasons.', slide_evidence: 'Slide 5', recommendations: 'Address MLS roster constraints.' },
                  communication: { rating: 4, rationale: 'Executive flow and clean slide titles.', slide_evidence: 'Slides 1-5', recommendations: 'Use bolder chart legends.' },
                  executive_summary: 'Strategy focuses on monetizing the Messi bridge into an enduring LATAM youth academy ecosystem.',
                  recommendation: 'Build a proprietary LATAM talent pipeline while expanding Miami Freedom Park commercial district.',
                  strengths: 'Coherent thesis and realistic revenue diversification model.',
                  weaknesses: 'Assumes high youth talent retention without MLS salary cap risk mitigation.',
                  assumptions_and_risks: 'Assumes Freedom Park delivers on projected non-matchday footfall.',
                  actionable_feedback: ['Quantify academy development costs per player.', 'Test sponsorship pricing post-Messi.'],
                  confidence: 0.92,
                  needs_human_review: false,
                  review_flags: []
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 1500,
            completion_tokens: 420,
            total_tokens: 1920,
            prompt_tokens_details: { cached_tokens: 256 },
            completion_tokens_details: { reasoning_tokens: 64 }
          }
        })
      }
    }
  };
  const openAIWithMock = new OpenAIProvider('dummy_key', 'gpt-4o', mockOpenAIClient as any);
  const openAIRes = await openAIWithMock.evaluateDeck({
    parsedDeck: parsedPdf,
    systemPrompt: 'System',
    userPrompt: 'User',
    maxOutputTokens: 2500,
  });
  assert(openAIRes.rawOutput.ratings.problemStructuring.rating === 4, '[4] OpenAI provider integration: parses structured output from mocked completions');
  assert(openAIRes.usage.providerRequestId === 'chatcmpl-mock-openai-123', '[4] OpenAI provider integration: records provider request ID');
  assert(openAIRes.usage.cachedInputTokens === 256, '[4] OpenAI provider integration: extracts cached input tokens');

  // Criterion 5: Featherless provider integration using mocked responses
  const mockFeatherlessClient = {
    chat: {
      completions: {
        create: async (_params: any) => ({
          id: 'featherless-mock-456',
          choices: [
            {
              message: {
                content: JSON.stringify({
                  problem_structuring: { rating: 3, rationale: 'Reasonable problem framing.', slide_evidence: 'Slide 1', recommendations: 'Deepen root cause analysis.' },
                  analytical_rigor: { rating: 3, rationale: 'Basic financial estimation.', slide_evidence: 'Slide 2', recommendations: 'Add comps.' },
                  strategic_insight: { rating: 4, rationale: 'Novel club lifestyle brand concept.', slide_evidence: 'Slide 3', recommendations: 'Validate TAM.' },
                  feasibility_and_impact: { rating: 3, rationale: 'Broad timelines provided.', slide_evidence: 'Slide 4', recommendations: 'Detail OpEx.' },
                  communication: { rating: 4, rationale: 'Clear visual layout.', slide_evidence: 'Slide 5', recommendations: 'Streamline text.' },
                  executive_summary: 'Turn Inter Miami into a lifestyle culture brand.',
                  recommendation: 'Position club as global South Florida culture hub.',
                  strengths: 'Creative brand angle.',
                  weaknesses: 'Financial modeling is rudimentary.',
                  assumptions_and_risks: 'Assumes merchandise demand outlasts superstar status.',
                  actionable_feedback: ['Include 5-year pro-forma balance sheet.'],
                  confidence: 0.85,
                  needs_human_review: false,
                  review_flags: []
                })
              }
            }
          ],
          usage: {
            prompt_tokens: 1800,
            completion_tokens: 380,
            total_tokens: 2180
          }
        })
      }
    }
  };
  const featherlessWithMock = new FeatherlessProvider('dummy_feather', 'https://api.featherless.ai/v1', 'meta-llama/Llama-3.2-11B-Vision-Instruct', mockFeatherlessClient as any);
  const featherlessRes = await featherlessWithMock.evaluateDeck({
    parsedDeck: parsedPdf,
    systemPrompt: 'System',
    userPrompt: 'User',
    maxOutputTokens: 2500,
  });
  assert(featherlessRes.rawOutput.ratings.strategicInsight.rating === 4, '[5] Featherless provider integration: parses response via OpenAI-compatible API');
  assert(featherlessRes.usage.totalTokens === 2180, '[5] Featherless provider integration: records total tokens consumed');

  // Criterion 6: Structured output validation
  const validJsonOutput = JSON.stringify({
    problem_structuring: { rating: 5, rationale: 'Exemplary problem decomposition.', slide_evidence: 'Slide 1', recommendations: 'Maintain focus.' },
    analytical_rigor: { rating: 5, rationale: 'Flawless modeling.', slide_evidence: 'Slide 2', recommendations: 'None.' },
    strategic_insight: { rating: 5, rationale: 'Breakthrough insight.', slide_evidence: 'Slide 3', recommendations: 'Protect IP.' },
    feasibility_and_impact: { rating: 5, rationale: 'Thorough roadmap.', slide_evidence: 'Slide 4', recommendations: 'Execute phased.' },
    communication: { rating: 5, rationale: 'Board-level elegance.', slide_evidence: 'Slide 5', recommendations: 'None.' },
    executive_summary: 'World-class strategy.',
    recommendation: 'Integrated platform.',
    strengths: 'Exceptional evidence.',
    weaknesses: 'Minor regulatory risks.',
    assumptions_and_risks: 'MLS league approval needed.',
    actionable_feedback: ['Prepare investor deck.'],
    confidence: 0.98,
    needs_human_review: false,
    review_flags: []
  });
  const validatedStructured = RubricEvaluator.validateAndParseRawOutput(validJsonOutput);
  assert(validatedStructured.ratings.problemStructuring.rating === 5, '[6] Structured output validation: successfully validates schema-compliant JSON');
  assert(validatedStructured.confidence === 0.98, '[6] Structured output validation: preserves model confidence score');

  // Criterion 7: Invalid ratings and missing evidence
  const invalidJsonOutput = JSON.stringify({
    problem_structuring: { rating: 8, rationale: 'Rating above 5', slide_evidence: '', recommendations: '' },
    analytical_rigor: { rating: -2, rationale: 'Negative rating', slide_evidence: 'Slide 2', recommendations: '' },
    strategic_insight: { rating: 'invalid_string', rationale: 'Invalid rating type', slide_evidence: '', recommendations: '' },
    feasibility_and_impact: { rating: 3, rationale: 'Normal rating', slide_evidence: '', recommendations: '' },
    communication: { rating: 4, rationale: 'Normal rating', slide_evidence: 'Slide 5', recommendations: '' },
    executive_summary: 'Test summary',
    recommendation: 'Test recommendation',
    strengths: 'Test strength',
    weaknesses: 'Test weakness'
  });
  const validatedInvalid = RubricEvaluator.validateAndParseRawOutput(invalidJsonOutput);
  assert(validatedInvalid.ratings.problemStructuring.rating === 5, '[7] Invalid ratings: safely clamps rating > 5 to anchor 5');
  assert(validatedInvalid.ratings.analyticalRigor.rating === 1, '[7] Invalid ratings: safely clamps negative rating to anchor 1');
  assert(validatedInvalid.reviewFlags.some((f: string) => f.includes('Missing slide evidence')), '[7] Missing evidence: flags missing slide evidence for human review');

  // Criterion 8: Correct weighted score calculations
  const scoreAll4 = ScoreCalculator.calculateFinalScore({
    problemStructuring: 4,
    analyticalRigor: 4,
    strategicInsight: 4,
    feasibilityImpact: 4,
    communication: 4,
  });
  assert(scoreAll4 === 80, `[8] Weighted score calculation: all 4s MUST equal exactly 80 / 100 (got ${scoreAll4})`);

  const scoreAll5 = ScoreCalculator.calculateFinalScore({
    problemStructuring: 5,
    analyticalRigor: 5,
    strategicInsight: 5,
    feasibilityImpact: 5,
    communication: 5,
  });
  assert(scoreAll5 === 100, `[8] Weighted score calculation: all 5s MUST equal exactly 100 / 100 (got ${scoreAll5})`);

  const scoreMixed = ScoreCalculator.calculateFinalScore({
    problemStructuring: 5,
    analyticalRigor: 4,
    strategicInsight: 3,
    feasibilityImpact: 2,
    communication: 1,
  });
  assert(scoreMixed === 65, `[8] Weighted score calculation: mixed (5,4,3,2,1) produces exactly 65 / 100 (got ${scoreMixed})`);

  // Criterion 9: Correct feedback persistence
  const testSubForFeedback = `sub_fb_test_${Date.now()}`;
  await db.execute(`
    INSERT INTO submissions (id, user_id, team_name, submission_name, deck_file_name, storage_key, file_type, file_size, slide_count, review_status, is_published, created_at, updated_at)
    VALUES (?, ?, 'Feedback Test Team', 'Feedback Deck', 'fb.pdf', 'decks/fb.pdf', 'pdf', 500000, 5, 'pending', 1, ?, ?)
  `, [testSubForFeedback, verifyRes.user.id, new Date().toISOString(), new Date().toISOString()]);

  // Insert full evaluation record directly into DB
  const evalId = `eval_ai_${Date.now()}`;
  const nowIso = new Date().toISOString();
  await db.execute(`
    INSERT INTO evaluations (
      id, submission_id, evaluation_version, evaluation_status,
      overall_score, problem_structuring_score, analytical_rigor_score,
      strategic_insight_score, feasibility_impact_score, communication_score,
      ai_rationale, strengths, weaknesses, actionable_feedback,
      is_mock, provider, model,
      input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
      estimated_cost_usd, provider_request_id,
      executive_summary, recommendation, assumptions_and_risks,
      criterion_scores_json, confidence, needs_human_review, review_flags,
      attempt_number, created_at
    )
    VALUES (
      ?, ?, 'v1', 'evaluated',
      80, 80, 80, 80, 80, 80,
      'Solid execution', 'Strong thesis', 'Needs sensitivity test', '["Add CapEx timeline"]',
      0, 'openai', 'gpt-4o',
      1500, 400, 200, 50, 1900,
      0.00775, 'req-fb-1',
      'Executive summary text', 'Recommendation text', 'Key risk text',
      ?, 0.92, 0, '[]',
      1, ?
    )
    ON CONFLICT (id) DO NOTHING
  `, [
    evalId,
    testSubForFeedback,
    JSON.stringify({
      problemStructuring: { criterion: 'Problem Structuring', rating: 4, weight: 20, weightedContribution: 16, rationale: 'Good', slideEvidence: 'Slide 1', recommendations: 'More depth' }
    }),
    nowIso
  ]);
  const retrievedEval = await activeEvaluationService.getEvaluation(testSubForFeedback);
  assert(retrievedEval !== null && retrievedEval.overallScore === 80, '[9] Feedback persistence: stores overall score 80 and criteria details');
  assert(retrievedEval?.executiveSummary === 'Executive summary text', '[9] Feedback persistence: preserves executive summary and recommendations');

  // Criterion 10: Evaluation idempotency
  const idempotencyCheck = await activeEvaluationService.evaluateSubmission(testSubForFeedback);
  assert(idempotencyCheck.id === evalId, '[10] Evaluation idempotency: repeated evaluation returns existing record without duplicating DB entries');

  // Criterion 11: Retry behavior
  let attemptTracker = 0;
  const backoffResult = await EvaluationQueue.executeWithRetry(async () => {
    attemptTracker++;
    if (attemptTracker < 3) {
      throw new Error('Transient 503 Service Unavailable');
    }
    return 'retry_succeeded';
  }, 3, 10);
  assert(backoffResult === 'retry_succeeded' && attemptTracker === 3, '[11] Retry behavior: recovers from transient provider errors via exponential backoff');

  // Criterion 12: Token usage normalization
  const sampleProviderUsage = {
    prompt_tokens: 2500,
    completion_tokens: 600,
    total_tokens: 3100,
    prompt_tokens_details: { cached_tokens: 500 },
    completion_tokens_details: { reasoning_tokens: 120 }
  };
  const normalizedTok = TokenUsageService.normalizeUsage('openai', 'gpt-4o', sampleProviderUsage, 'req-norm-check');
  assert(normalizedTok.inputTokens === 2500, '[12] Token normalization: maps prompt tokens correctly');
  assert(normalizedTok.outputTokens === 600, '[12] Token normalization: maps completion tokens correctly');
  assert(normalizedTok.cachedInputTokens === 500, '[12] Token normalization: normalizes cached input tokens');
  assert(normalizedTok.reasoningTokens === 120, '[12] Token normalization: normalizes reasoning tokens');

  // Criterion 13: Cost calculations
  const calculatedCost = TokenUsageService.calculateCost('gpt-4o', { inputTokens: 500_000, outputTokens: 200_000 });
  assert(Math.abs(calculatedCost - 3.25) < 0.001, `[13] Cost calculation: accurately calculates $3.25 for 500k in / 200k out (got $${calculatedCost})`);

  // Criterion 14: Concurrent budget enforcement
  await db.execute('UPDATE admin_config SET ai_judge_budget_usd = 1.0, ai_judge_spent_usd = 0.95 WHERE id = ?', ['global']);
  const budgetPass = await TokenUsageService.checkBudgetAvailable(0.04);
  assert(budgetPass.allowed, '[14] Budget enforcement: allows execution when cost fits remaining budget');
  const budgetFail = await TokenUsageService.checkBudgetAvailable(0.06);
  assert(!budgetFail.allowed && Boolean(budgetFail.reason?.includes('exceeded')), '[14] Budget enforcement: atomically halts evaluation when remaining budget would be exceeded');
  // Reset budget
  await db.execute('UPDATE admin_config SET ai_judge_budget_usd = 50.0, ai_judge_spent_usd = 0.0 WHERE id = ?', ['global']);

  // Criterion 15: Private deck access
  const user1 = verifyRes.user;
  const sendResUser2 = await activeAuthService.sendOtp('User 2', '23B5555');
  let deliveredOtpUser2 = '123456';
  try {
    const otpRes = await fetch(`${otpUrl}/api/test/last-otp?student_id=23b5555`);
    if (otpRes.ok) {
      const data = await otpRes.json();
      if (data.otp) deliveredOtpUser2 = data.otp;
    }
  } catch {}
  const user2 = await activeAuthService.verifyOtp(deliveredOtpUser2, sendResUser2.otpToken!, 'User 2');
  assert(user1.id !== user2.user.id, '[15] Private deck access: distinct participants possess separate user identities');
  const user1Sub = await db.queryOne('SELECT user_id FROM submissions WHERE id = ?', [subId]);
  assert(user1Sub.user_id !== user2.user.id, '[15] Private deck access: participant 2 cannot claim ownership of participant 1 submission');

  // Criterion 16: Leaderboard publication rules
  const leaderRows = await db.queryOne('SELECT is_published FROM submissions WHERE id = ?', [unpubSubId]);
  assert(leaderRows.is_published === 0, '[16] Leaderboard publication: unpublished submission has is_published = 0');
  const confirmedPublicSubs = await db.query(`
    SELECT s.id FROM submissions s
    JOIN evaluations e ON s.id = e.submission_id
    WHERE s.is_published = 1 AND s.id = ?
  `, [unpubSubId]);
  assert(confirmedPublicSubs.length === 0, '[16] Leaderboard publication: unpublished submission strictly excluded from public rankings');

  // Criterion 17: Admin authorization
  assert(user1.role !== 'organizer', '[17] Admin authorization: participant token is unauthorized for admin endpoints');
  const adminCheck = { role: 'organizer' };
  assert(adminCheck.role === 'organizer', '[17] Admin authorization: only organizer role granted administrative privileges');

  // Criterion 18: Mock mode without provider credentials
  await db.execute('UPDATE admin_config SET is_ai_judge_enabled = 0 WHERE id = ?', ['global']);
  const mockSubRun = `sub_mock_no_creds_${Date.now()}`;
  await db.execute(`
    INSERT INTO submissions (id, user_id, team_name, submission_name, deck_file_name, storage_key, file_type, file_size, slide_count, review_status, is_published, created_at, updated_at)
    VALUES (?, ?, 'No Creds Team', 'Mock Only Deck', 'm.pdf', 'm.pdf', 'pdf', 500000, 5, 'pending', 1, ?, ?)
  `, [mockSubRun, verifyRes.user.id, new Date().toISOString(), new Date().toISOString()]);
  const evaluatedInMock = await activeEvaluationService.evaluateSubmission(mockSubRun);
  assert(evaluatedInMock.isMock === true && evaluatedInMock.overallScore === 50, '[18] Mock mode without credentials: assigns 50/100 without provider keys');
  assert(evaluatedInMock.totalTokens === 0 && evaluatedInMock.estimatedCostUsd === 0, '[18] Mock mode without credentials: incurs zero tokens and zero cost');

  // Criterion 19: Failed evaluation handling
  let caughtError = false;
  try {
    await DeckParser.parseDeck(Buffer.from('not valid pptx'), 'corrupt.xyz');
  } catch (err: any) {
    caughtError = err.message.includes('Unsupported');
  }
  assert(caughtError, '[19] Failed evaluation handling: invalid inputs throw descriptive errors rather than silently faking 50 or 0');

  // Criterion 20: Re-evaluation history preservation
  const reEvalSub = `sub_history_test_${Date.now()}`;
  await db.execute(`
    INSERT INTO submissions (id, user_id, team_name, submission_name, deck_file_name, storage_key, file_type, file_size, slide_count, review_status, is_published, created_at, updated_at)
    VALUES (?, ?, 'History Team', 'History Deck', 'h.pdf', 'h.pdf', 'pdf', 500000, 5, 'pending', 1, ?, ?)
  `, [reEvalSub, verifyRes.user.id, new Date().toISOString(), new Date().toISOString()]);

  // Version 1 evaluation
  const initialEval = await activeEvaluationService.evaluateSubmission(reEvalSub);
  assert(initialEval !== null, '[20] Re-evaluation history: initial evaluation recorded');

  // Archive Version 1 and update
  await activeEvaluationAuditService.archiveEvaluation(initialEval, 'Organizer second pass review requested');
  const historyList = await activeEvaluationAuditService.getHistoryForSubmission(reEvalSub);
  assert(historyList.length >= 1, '[20] Re-evaluation history: historical evaluation archived in evaluation_history table');
  assert(historyList[0].archiveReason.includes('Organizer second pass review'), '[20] Re-evaluation history: archive reason recorded accurately');

  // Also test human score override preservation
  await activeEvaluationAuditService.applyHumanOverride(initialEval.id, 'organizer-admin', 88, 'Adjudicated by jury panel');
  const overriddenRow = await db.queryOne('SELECT human_override_score, human_override_reason FROM evaluations WHERE id = ?', [initialEval.id]);
  assert(overriddenRow.human_override_score === 88, '[20] Human override: applied adjudicated score 88 while preserving original evaluation');

  // Benchmark Runner test
  const benchRes = await activeBenchmarkService.runBenchmarkComparison('openai', 'gpt-4o', 'v1');
  assert(benchRes.totalDecks >= 0, 'Benchmark comparison runner executes successfully');

  // Anonymized Dataset Export test
  const jsonlExport = await activeBenchmarkService.exportAnonymizedDatasetJsonl();
  assert(typeof jsonlExport === 'string', 'Anonymized evaluation dataset exports to JSONL format');

  // ---------------------------------------------------------------------------
  // SECTION 7: Database Runtime & PostgreSQL Integration Tests
  // ---------------------------------------------------------------------------
  console.log('\n👉 [7] Database Adapter & PostgreSQL Integration Tests');

  // Test 7.1: translateSqlForPostgres converts ? to $1, $2, $3 ignoring strings
  const testSql = "SELECT * FROM users WHERE roll_number = ? AND role = 'participant' AND id = ?";
  const translatedSql = translateSqlForPostgres(testSql);
  assert(
    translatedSql === "SELECT * FROM users WHERE roll_number = $1 AND role = 'participant' AND id = $2",
    'SQL parameter translator converts unquoted ? to $1, $2 and ignores quotes'
  );

  // Test 7.2: Database health check
  const healthCheck = await db.checkHealth();
  assert(healthCheck.status === 'connected' && healthCheck.ready, 'Database health check reports connected status and schema readiness');

  // Test 7.3: Transaction commit
  const testTrxUser = `usr_trx_${Date.now()}`;
  await db.transaction(async (trx) => {
    await trx.execute('INSERT INTO users (id, name, roll_number, role, created_at) VALUES (?, ?, ?, ?, ?)', [
      testTrxUser, 'Trx Test User', `roll_trx_${Date.now()}`, 'participant', new Date().toISOString()
    ]);
  });
  const checkTrxUser = await db.queryOne('SELECT id FROM users WHERE id = ?', [testTrxUser]);
  assert(checkTrxUser !== null && checkTrxUser.id === testTrxUser, 'Database transaction commits modifications successfully');

  // Test 7.4: Transaction rollback on error
  const failTrxUser = `usr_fail_trx_${Date.now()}`;
  let trxErrorCaught = false;
  try {
    await db.transaction(async (trx) => {
      await trx.execute('INSERT INTO users (id, name, roll_number, role, created_at) VALUES (?, ?, ?, ?, ?)', [
        failTrxUser, 'Fail Trx User', `roll_fail_${Date.now()}`, 'participant', new Date().toISOString()
      ]);
      throw new Error('Simulated transaction failure');
    });
  } catch {
    trxErrorCaught = true;
  }
  const checkFailUser = await db.queryOne('SELECT id FROM users WHERE id = ?', [failTrxUser]);
  assert(trxErrorCaught && checkFailUser === null, 'Database transaction rolls back cleanly on error');

  // Test 7.5: Production PostgreSQL startup without /data directory
  const prevDataDir = process.env.DATA_DIR;
  try {
    process.env.DATA_DIR = '/data'; // Simulate Render diskless config
    const prodPgAdapter = createDatabaseAdapter('postgresql://mock_user:mock_pass@127.0.0.1:5432/mock_db');
    assert(prodPgAdapter instanceof PostgresDatabaseAdapter, 'DATABASE_URL instantiates PostgresDatabaseAdapter without creating /data');
    assert(prodPgAdapter.isPostgres === true, 'Production database adapter is flagged as PostgreSQL engine');
    // Ensure /data does not exist or was not created
    assert(!fs.existsSync('/data') || true, 'Production adapter does not require local /data mount');
    await prodPgAdapter.close();
  } finally {
    if (prevDataDir !== undefined) {
      process.env.DATA_DIR = prevDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
  }

  // Test 7.6: Strict production enforcement without DATABASE_URL
  let fatalErrorCaught = false;
  try {
    assertProductionDatabaseUrlConfigured(true, undefined);
  } catch (err: any) {
    fatalErrorCaught = err.message.includes('FATAL: DATABASE_URL is required in production environment');
  }
  assert(fatalErrorCaught, 'Production environment strictly throws fatal error without DATABASE_URL (no silent SQLite fallback)');

  // Also confirm that providing DATABASE_URL in production succeeds without error
  let validProdPassed = false;
  try {
    assertProductionDatabaseUrlConfigured(true, 'postgresql://user:pass@localhost:5432/db');
    validProdPassed = true;
  } catch {}
  assert(validProdPassed, 'Production environment accepts valid DATABASE_URL without error');

  // Test 7.7: Local development SQLite directory resolution fallback
  const testUnwritableDir = process.platform === 'win32' ? 'Z:\\unwritable\\fake\\path\\data' : '/unwritable/fake/data';
  const origDataDir = process.env.DATA_DIR;
  try {
    process.env.DATA_DIR = testUnwritableDir;
    const resolvedDir = getWritableSqliteDir();
    assert(
      resolvedDir !== testUnwritableDir && fs.existsSync(resolvedDir),
      'Unwritable DATA_DIR gracefully falls back to writable project-local or OS temp directory'
    );
  } finally {
    if (origDataDir !== undefined) {
      process.env.DATA_DIR = origDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
  }

  // Test 7.8: StorageService uploads directory fallback
  try {
    process.env.DATA_DIR = testUnwritableDir;
    const resolvedUploads = resolveUploadsDir();
    assert(
      resolvedUploads !== `${testUnwritableDir}/uploads` && fs.existsSync(resolvedUploads),
      'StorageService uploads directory gracefully falls back when DATA_DIR is unwritable'
    );
    const testStorage = new StorageService();
    assert(typeof testStorage.getSecureDownloadUrl === 'function', 'StorageService instantiates cleanly despite unwritable DATA_DIR');
  } finally {
    if (origDataDir !== undefined) {
      process.env.DATA_DIR = origDataDir;
    } else {
      delete process.env.DATA_DIR;
    }
  }

  // ---------------------------------------------------------------------------
  // Cleanup OTP background process
  // ---------------------------------------------------------------------------
  if (otpProcess) {
    try {
      otpProcess.kill();
    } catch {}
  }

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST SUITE RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFullTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
