// server/services/authService.ts
import { db } from '../db';
import { User, UserRole } from '../types';
import crypto from 'node:crypto';

export interface AuthAuthResult {
  success: boolean;
  token: string;
  user: User;
  message: string;
}

export interface IAuthService {
  register(name: string, rollNumber: string, password: string, email?: string): Promise<AuthAuthResult>;
  login(rollNumber: string, password: string): Promise<AuthAuthResult>;
  verifyAdmin(passkey: string): Promise<AuthAuthResult>;
  getUserByToken(token: string): Promise<User | null>;
  logout(token: string): Promise<void>;
}

/**
 * Securely hashes a plaintext password using Node.js native crypto.scrypt.
 * Output format: salt:hexDerivedKey
 */
export function hashPassword(password: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('A valid password string is required for hashing.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored salt:hexDerivedKey hash.
 * Uses timingSafeEqual to protect against side-channel timing attacks.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  if (!password || !storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }
  try {
    const [salt, keyHex] = storedHash.split(':');
    if (!salt || !keyHex) return false;
    const derivedKey = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(keyHex, 'hex');
    if (derivedKey.length !== keyBuffer.length) return false;
    return crypto.timingSafeEqual(derivedKey, keyBuffer);
  } catch {
    return false;
  }
}

// In-memory rate limiting: max 10 failed login attempts per 60 seconds per IP/roll
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitStore = new Map<string, RateLimitEntry>();

function checkRateLimit(key: string, maxAttempts = 10, windowMs = 60000): void {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (entry.count >= maxAttempts) {
    const waitSeconds = Math.ceil((entry.resetAt - now) / 1000);
    throw new Error(`Too many authentication attempts. Please wait ${waitSeconds}s before trying again.`);
  }

  entry.count += 1;
}

export class PasswordAuthService implements IAuthService {
  /**
   * Provisions a new participant account with password-based authentication.
   */
  async register(name: string, rollNumber: string, password: string, email?: string): Promise<AuthAuthResult> {
    const cleanName = String(name || '').trim();
    const cleanRoll = String(rollNumber || '').trim().toUpperCase();
    const cleanPassword = String(password || '');
    const cleanEmail = email ? String(email).trim().toLowerCase() : undefined;

    if (!cleanName || cleanName.length < 2) {
      throw new Error('Full name is required (minimum 2 characters).');
    }
    if (!cleanRoll || !/^[A-Z0-9_-]{3,30}$/.test(cleanRoll)) {
      throw new Error('Valid student roll number is required (3–30 alphanumeric characters).');
    }
    if (cleanRoll === 'ORGANIZER_ADMIN' || cleanRoll === 'ADMIN') {
      throw new Error('Organizer accounts must be accessed via the dedicated organizer portal.');
    }
    if (!cleanPassword || cleanPassword.length < 8) {
      throw new Error('Password must be at least 8 characters long.');
    }
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Please enter a valid email address.');
    }

    // Check if participant with roll number already exists
    const existing = await db.queryOne('SELECT * FROM users WHERE UPPER(roll_number) = ?', [cleanRoll]);
    const passwordHash = hashPassword(cleanPassword);
    const nowIso = new Date().toISOString();
    let userId: string;
    const finalEmail = cleanEmail || `${cleanRoll.toLowerCase()}@college.edu`;

    if (existing) {
      // If user exists and already has a password, prevent duplicate registration
      if (existing.password_hash) {
        throw new Error(`Participant with roll number ${cleanRoll} is already registered. Please sign in with your password.`);
      }
      // If user exists without password (e.g. pre-seeded or legacy), provision password
      userId = existing.id;
      await db.execute(
        'UPDATE users SET name = ?, password_hash = ?, email = COALESCE(?, email), last_login_at = ? WHERE id = ?',
        [cleanName, passwordHash, finalEmail, nowIso, userId]
      );
    } else {
      userId = `usr_${crypto.randomUUID().slice(0, 8)}`;
      await db.execute(`
        INSERT INTO users (id, name, roll_number, email, password_hash, role, last_login_at, created_at)
        VALUES (?, ?, ?, ?, ?, 'participant', ?, ?)
      `, [userId, cleanName, cleanRoll, finalEmail, passwordHash, nowIso, nowIso]);
    }

    // Create session token
    const token = `tok_${crypto.randomUUID()}`;
    await db.execute(`
      INSERT INTO auth_sessions (token, user_id, role, is_mock, created_at)
      VALUES (?, ?, 'participant', 0, ?)
    `, [token, userId, nowIso]);

    const user: User = {
      id: userId,
      name: cleanName,
      rollNumber: cleanRoll,
      email: finalEmail,
      role: 'participant',
      createdAt: existing ? existing.created_at : nowIso,
      lastLoginAt: nowIso,
    };

    return {
      success: true,
      token,
      user,
      message: `Account registered successfully for ${cleanRoll}.`,
    };
  }

  /**
   * Authenticates participant by student roll number and password.
   */
  async login(rollNumber: string, password: string): Promise<AuthAuthResult> {
    const cleanRoll = String(rollNumber || '').trim().toUpperCase();
    const cleanPassword = String(password || '');

    if (!cleanRoll || !cleanPassword) {
      throw new Error('Roll number and password are required.');
    }
    if (cleanRoll === 'ORGANIZER_ADMIN' || cleanRoll === 'ADMIN') {
      throw new Error('Organizer accounts must be accessed via the dedicated organizer portal.');
    }

    checkRateLimit(`login_${cleanRoll}`);

    const userRow = await db.queryOne('SELECT * FROM users WHERE UPPER(roll_number) = ?', [cleanRoll]);
    if (!userRow || !userRow.password_hash || !verifyPassword(cleanPassword, userRow.password_hash)) {
      throw new Error('Invalid roll number or password.');
    }

    const nowIso = new Date().toISOString();
    await db.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso, userRow.id]);

    const token = `tok_${crypto.randomUUID()}`;
    await db.execute(`
      INSERT INTO auth_sessions (token, user_id, role, is_mock, created_at)
      VALUES (?, ?, ?, 0, ?)
      ON CONFLICT (token) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        role = EXCLUDED.role,
        is_mock = EXCLUDED.is_mock,
        created_at = EXCLUDED.created_at
    `, [token, userRow.id, userRow.role || 'participant', nowIso]);

    const user: User = {
      id: userRow.id,
      name: userRow.name,
      rollNumber: userRow.roll_number,
      email: userRow.email || undefined,
      role: (userRow.role as UserRole) || 'participant',
      createdAt: userRow.created_at,
      lastLoginAt: nowIso,
    };

    return {
      success: true,
      token,
      user,
      message: `Welcome back, ${user.name}!`,
    };
  }

  /**
   * Dedicated organizer passkey authorization with server-side role validation.
   */
  async verifyAdmin(passkey: string): Promise<AuthAuthResult> {
    const cleanPasskey = String(passkey || '').trim();
    if (!cleanPasskey) {
      throw new Error('Organizer passkey is required.');
    }

    const configuredKey = process.env.ORGANIZER_SECRET_KEY;
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && (!configuredKey || configuredKey === 'ccg-admin-2026')) {
      console.warn('⚠️ ORGANIZER_SECRET_KEY should be customized in production environment variables.');
    }

    const expectedKey = configuredKey || 'ccg-admin-2026';
    if (cleanPasskey !== expectedKey) {
      throw new Error('Invalid organizer passkey. Access denied.');
    }

    let organizerUser = await db.queryOne("SELECT * FROM users WHERE roll_number = 'ORGANIZER_ADMIN'");
    const nowIso = new Date().toISOString();

    if (!organizerUser) {
      const id = 'usr_organizer_root';
      await db.execute(`
        INSERT INTO users (id, name, roll_number, role, last_login_at, created_at)
        VALUES (?, 'Lead Case Coordinator', 'ORGANIZER_ADMIN', 'organizer', ?, ?)
        ON CONFLICT (id) DO NOTHING
      `, [id, nowIso, nowIso]);
      organizerUser = {
        id,
        name: 'Lead Case Coordinator',
        roll_number: 'ORGANIZER_ADMIN',
        role: 'organizer',
        created_at: nowIso,
      };
    } else {
      await db.execute('UPDATE users SET last_login_at = ? WHERE id = ?', [nowIso, organizerUser.id]);
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
    `, [token, organizerUser.id, nowIso]);

    const user: User = {
      id: organizerUser.id,
      name: organizerUser.name,
      rollNumber: organizerUser.roll_number,
      role: 'organizer',
      createdAt: organizerUser.created_at,
      lastLoginAt: nowIso,
    };

    return {
      success: true,
      token,
      user,
      message: 'Organizer session established.',
    };
  }

  /**
   * Retrieves authenticated user identity by session token.
   */
  async getUserByToken(token: string): Promise<User | null> {
    if (!token || typeof token !== 'string') return null;

    const session = await db.queryOne('SELECT * FROM auth_sessions WHERE token = ?', [token]);
    if (!session) return null;

    const userRow = await db.queryOne('SELECT * FROM users WHERE id = ?', [session.user_id]);
    if (!userRow) return null;

    return {
      id: userRow.id,
      name: userRow.name,
      rollNumber: userRow.roll_number,
      email: userRow.email || undefined,
      role: (session.role as UserRole) || (userRow.role as UserRole) || 'participant',
      createdAt: userRow.created_at,
      lastLoginAt: userRow.last_login_at,
    };
  }

  /**
   * Invalidates authenticated session token.
   */
  async logout(token: string): Promise<void> {
    if (!token) return;
    await db.execute('DELETE FROM auth_sessions WHERE token = ?', [token]);
  }
}

export const activeAuthService = new PasswordAuthService();
