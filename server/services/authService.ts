// server/services/authService.ts
import { db } from '../db';
import { User, UserRole } from '../types';
import crypto from 'node:crypto';

export interface AuthSendOtpResult {
  success: boolean;
  bypassed?: boolean;
  email?: string;
  otpToken?: string;
  token?: string;
  user?: User;
  message: string;
}

export interface AuthVerifyOtpResult {
  success: boolean;
  token: string;
  user: User;
  message: string;
}

export interface IAuthService {
  sendOtp(name: string, rollNumber: string, clientIp?: string): Promise<AuthSendOtpResult>;
  verifyOtp(otp: string, otpToken: string, name?: string): Promise<AuthVerifyOtpResult>;
  resendOtp(rollNumber: string, clientIp?: string): Promise<AuthSendOtpResult>;
  verifyAdmin(passkey: string): Promise<AuthVerifyOtpResult>;
  getUserByToken(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
  initiateAuth(name: string, rollNumber: string): Promise<any>;
}

// In-memory rate limiting: max 5 requests per 60 seconds per roll/IP
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string, maxRequests = 5, windowMs = 60000): void {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (entry.count >= maxRequests) {
    const waitSeconds = Math.ceil((entry.resetAt - now) / 1000);
    throw new Error(`Too many OTP requests. Please wait ${waitSeconds}s before requesting another verification code.`);
  }

  entry.count += 1;
}

export class WebmailOtpAuthService implements IAuthService {
  private otpServiceUrl: string;

  constructor() {
    let base = (process.env.OTP_SERVICE_URL || 'http://127.0.0.1:5001').trim().replace(/\/+$/, '');
    if (!base.startsWith('http://') && !base.startsWith('https://')) {
      base = `http://${base}`;
    }
    this.otpServiceUrl = base;
  }

  /**
   * Step 1: Send OTP to institutional webmail address derived from student roll number.
   * Enforces roll-number normalization, rate-limiting, and organizer credential isolation.
   */
  async sendOtp(name: string, rollNumber: string, clientIp = '127.0.0.1'): Promise<AuthSendOtpResult> {
    const cleanName = String(name || '').trim();
    const cleanRoll = String(rollNumber || '').trim().toLowerCase();

    if (!cleanName) {
      throw new Error('Name is required for participant attribution.');
    }
    if (!cleanRoll) {
      throw new Error('Roll number is required.');
    }

    // Role isolation: Participant login cannot use organizer roll number
    if (cleanRoll === 'organizer_admin') {
      throw new Error('Organizer credentials must be accessed via the dedicated organizer portal.');
    }

    // Rate limiting
    checkRateLimit(`send_${cleanRoll}_${clientIp}`);

    // Call Python OTP service endpoint POST /api/send-otp
    let responseData: any;
    try {
      const res = await fetch(`${this.otpServiceUrl}/api/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: cleanRoll }),
      });
      responseData = await res.json().catch(() => ({}));
      if (!res.ok || responseData.error) {
        throw new Error(responseData.error || `OTP service returned HTTP ${res.status}`);
      }
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        throw new Error(`Webmail OTP service unavailable at ${this.otpServiceUrl}. Ensure the Python OTP service is running.`);
      }
      throw err;
    }

    // Handle developer bypass mode
    if (responseData.bypassed) {
      // In production, bypass mode must never be allowed
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Development bypass mode is strictly forbidden in production.');
      }

      const verifiedRoll = cleanRoll;
      const user = await this.upsertParticipantUser(verifiedRoll, cleanName);
      const token = responseData.token || `tok_dev_${crypto.randomUUID()}`;

      // Persist authenticated session
      await db.execute(`
        INSERT INTO auth_sessions (token, user_id, role, is_mock, created_at)
        VALUES (?, ?, 'participant', 1, ?)
        ON CONFLICT (token) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          role = EXCLUDED.role,
          is_mock = EXCLUDED.is_mock,
          created_at = EXCLUDED.created_at
      `, [token, user.id, new Date().toISOString()]);

      return {
        success: true,
        bypassed: true,
        token,
        user,
        message: 'Dev bypass active. Authenticated directly without SMTP delivery.',
      };
    }

    return {
      success: true,
      bypassed: false,
      email: responseData.email,
      otpToken: responseData.otp_token,
      message: `Verification code sent to ${responseData.email}`,
    };
  }

  /**
   * Step 2: Verifies submitted OTP against signed cryptographic challenge token.
   * Associates verified roll number with participant user record in database.
   */
  async verifyOtp(otp: string, otpToken: string, name?: string): Promise<AuthVerifyOtpResult> {
    let cleanOtp = String(otp || '').trim();
    let cleanToken = String(otpToken || '').trim();

    // Defend against swapped parameter order (e.g. verifyOtp(token, otp))
    if (!/^\d{6}$/.test(cleanOtp) && /^\d{6}$/.test(cleanToken)) {
      const temp = cleanOtp;
      cleanOtp = cleanToken;
      cleanToken = temp;
    }

    if (!cleanOtp) {
      throw new Error('Please enter the 6-digit OTP code.');
    }
    if (!/^\d{6}$/.test(cleanOtp)) {
      throw new Error('OTP must be a 6-digit numeric code.');
    }
    if (!cleanToken) {
      throw new Error('No OTP challenge token provided. Please request a new OTP.');
    }

    // Call Python OTP service endpoint POST /api/verify-otp
    let responseData: any;
    try {
      const res = await fetch(`${this.otpServiceUrl}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp_input: cleanOtp,
          otp_token: cleanToken,
        }),
      });
      responseData = await res.json().catch(() => ({}));
      if (!res.ok || responseData.error) {
        throw new Error(responseData.error || `Verification failed (HTTP ${res.status})`);
      }
    } catch (err: any) {
      if (err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        throw new Error(`Webmail OTP service unavailable at ${this.otpServiceUrl}.`);
      }
      throw err;
    }

    const verifiedRoll = String(responseData.student_id || '').trim().toLowerCase();
    const authToken = String(responseData.token || '').trim();

    if (!verifiedRoll || !authToken) {
      throw new Error('Invalid verification response from OTP service.');
    }

    // Authoritative user binding: Derive verified identity strictly from validated OTP engine output.
    const user = await this.upsertParticipantUser(verifiedRoll, name?.trim());

    // Record authenticated session
    await db.execute(`
      INSERT INTO auth_sessions (token, user_id, role, is_mock, created_at)
      VALUES (?, ?, 'participant', 0, ?)
      ON CONFLICT (token) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        role = EXCLUDED.role,
        is_mock = EXCLUDED.is_mock,
        created_at = EXCLUDED.created_at
    `, [authToken, user.id, new Date().toISOString()]);

    return {
      success: true,
      token: authToken,
      user,
      message: `Verified successfully as ${verifiedRoll}.`,
    };
  }

  /**
   * Resends OTP code to student webmail.
   */
  async resendOtp(rollNumber: string, clientIp = '127.0.0.1'): Promise<AuthSendOtpResult> {
    const cleanRoll = String(rollNumber || '').trim().toLowerCase();
    checkRateLimit(`resend_${cleanRoll}_${clientIp}`, 3, 60000);

    return this.sendOtp('Participant', cleanRoll, clientIp);
  }

  /**
   * Dedicated organizer passkey authorization — strictly separate from roll numbers.
   */
  async verifyAdmin(passkey: string): Promise<AuthVerifyOtpResult> {
    const isProduction = process.env.NODE_ENV === 'production';
    const configuredKey = process.env.ORGANIZER_SECRET_KEY;
    if (isProduction && (!configuredKey || configuredKey === 'ccg-admin-2026')) {
      throw new Error('ORGANIZER_SECRET_KEY must be securely configured in production and cannot use the default placeholder.');
    }
    const expectedKey = configuredKey || 'ccg-admin-2026';
    if (!passkey || passkey.trim() !== expectedKey) {
      throw new Error('Invalid organizer passkey. Access denied.');
    }

    let organizerUser = await db.queryOne("SELECT * FROM users WHERE roll_number = 'ORGANIZER_ADMIN'");
    if (!organizerUser) {
      const id = 'usr_organizer_root';
      const nowIso = new Date().toISOString();
      await db.execute(`
        INSERT INTO users (id, name, roll_number, role, last_login_at, created_at)
        VALUES (?, 'Lead Case Coordinator', 'ORGANIZER_ADMIN', 'organizer', ?, ?)
        ON CONFLICT (id) DO NOTHING
      `, [id, nowIso, nowIso]);
      organizerUser = { id, name: 'Lead Case Coordinator', roll_number: 'ORGANIZER_ADMIN', role: 'organizer', created_at: nowIso };
    } else {
      await db.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [new Date().toISOString(), organizerUser.id]);
    }

    const token = `adm_tok_${crypto.randomUUID()}`;
    await db.execute(`
      INSERT INTO auth_sessions (token, user_id, role, is_mock, created_at)
      VALUES (?, ?, 'organizer', 0, ?)
      ON CONFLICT (token) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        role = EXCLUDED.role,
        is_mock = EXCLUDED.is_mock,
        created_at = EXCLUDED.created_at
    `, [token, organizerUser.id, new Date().toISOString()]);

    const user: User = {
      id: organizerUser.id,
      name: organizerUser.name,
      rollNumber: organizerUser.roll_number,
      role: 'organizer',
      createdAt: organizerUser.created_at,
      lastLoginAt: new Date().toISOString(),
    };

    return {
      success: true,
      token,
      user,
      message: 'Organizer session established.',
    };
  }

  /**
   * Retrieves user identity by session token.
   */
  async getUserByToken(token: string): Promise<User | null> {
    if (!token) return null;

    // 1. Look up in auth_sessions table
    const session = await db.queryOne('SELECT * FROM auth_sessions WHERE token = ?', [token]);
    if (session) {
      const userRow = await db.queryOne('SELECT * FROM users WHERE id = ?', [session.user_id]);
      if (userRow) {
        return {
          id: userRow.id,
          name: userRow.name,
          rollNumber: userRow.roll_number,
          role: userRow.role as UserRole,
          createdAt: userRow.created_at,
          lastLoginAt: userRow.last_login_at,
        };
      }
    }

    // 2. Fallback: Validate Bearer token cryptographically with OTP service
    try {
      const res = await fetch(`${this.otpServiceUrl}/api/verify-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.valid && data.student_id) {
          const user = await this.upsertParticipantUser(data.student_id);
          await db.execute(`
            INSERT INTO auth_sessions (token, user_id, role, is_mock, created_at)
            VALUES (?, ?, 'participant', 0, ?)
            ON CONFLICT (token) DO UPDATE SET
              user_id = EXCLUDED.user_id,
              role = EXCLUDED.role,
              is_mock = EXCLUDED.is_mock,
              created_at = EXCLUDED.created_at
          `, [token, user.id, new Date().toISOString()]);
          return user;
        }
      }
    } catch {
      // Service offline or invalid token
    }

    return null;
  }

  /**
   * Invalidates authenticated session.
   */
  async logout(token: string): Promise<void> {
    if (!token) return;
    await db.execute('DELETE FROM auth_sessions WHERE token = ?', [token]);
  }

  /**
   * Helper: Links verified roll number to database user record.
   * Open Participation: Anyone with a valid roll number can authenticate.
   * Duplicate prevention: Existing roll numbers are associated with the same user.
   */
  private async upsertParticipantUser(normalizedRollNumber: string, displayName?: string): Promise<User> {
    const cleanRoll = normalizedRollNumber.trim().toUpperCase();
    const existing = await db.queryOne('SELECT * FROM users WHERE UPPER(roll_number) = ?', [cleanRoll]);
    const nowIso = new Date().toISOString();

    if (existing) {
      const updatedName = displayName?.trim() || existing.name;
      await db.execute(`
        UPDATE users SET name = ?, roll_number = ?, last_login_at = ? WHERE id = ?
      `, [updatedName, cleanRoll, nowIso, existing.id]);

      return {
        id: existing.id,
        name: updatedName,
        rollNumber: cleanRoll,
        role: 'participant',
        createdAt: existing.created_at,
        lastLoginAt: nowIso,
      };
    }

    // New eligible participant
    const newId = `usr_${crypto.randomUUID().slice(0, 8)}`;
    const nameToSave = displayName?.trim() || `Student ${cleanRoll}`;

    await db.execute(`
      INSERT INTO users (id, name, roll_number, role, last_login_at, created_at)
      VALUES (?, ?, ?, 'participant', ?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [newId, nameToSave, cleanRoll, nowIso, nowIso]);

    return {
      id: newId,
      name: nameToSave,
      rollNumber: cleanRoll,
      role: 'participant',
      createdAt: nowIso,
      lastLoginAt: nowIso,
    };
  }

  // Backward-compatibility wrapper for test_workflow and initial flow
  async initiateAuth(name: string, rollNumber: string): Promise<any> {
    const res = await this.sendOtp(name, rollNumber);
    return {
      success: res.success,
      isMock: Boolean(res.bypassed),
      sessionId: res.otpToken || res.token || 'mock_sess_1',
      otpToken: res.otpToken,
      email: res.email,
      message: res.message,
    };
  }
}

export const activeAuthService: IAuthService = new WebmailOtpAuthService();
