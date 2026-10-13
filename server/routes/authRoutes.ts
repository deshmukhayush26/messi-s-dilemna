// server/routes/authRoutes.ts
import { Router, Request, Response } from 'express';
import { activeAuthService } from '../services/authService';

export const authRouter = Router();

// GET /api/auth/status: Report authentication capabilities
authRouter.get('/status', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    authMode: 'password',
    participantRegistrationEnabled: true,
    participantLoginEnabled: true,
    organizerLoginEnabled: true,
  });
});

// POST /api/auth/register: Register a new participant account with roll number & password
authRouter.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, rollNumber, student_id, password, email } = req.body;
    const targetRoll = rollNumber || student_id;

    if (!name || !targetRoll || !password) {
      return res.status(400).json({ error: 'Name, student roll number, and password (minimum 8 characters) are required.' });
    }

    const result = await activeAuthService.register(name, targetRoll, password, email);

    // Set secure cookie for cross-domain / same-domain sessions
    res.cookie('ccg_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 86400 * 1000, // 24 hours
    });

    return res.status(201).json(result);
  } catch (error: any) {
    const status = error.message?.includes('already registered') ? 409 : 400;
    return res.status(status).json({ error: error.message || 'Registration failed.' });
  }
});

// POST /api/auth/login: Authenticate participant with roll number & password
authRouter.post('/login', async (req: Request, res: Response) => {
  try {
    const { rollNumber, student_id, password } = req.body;
    const targetRoll = rollNumber || student_id;

    if (!targetRoll || !password) {
      return res.status(400).json({ error: 'Student roll number and password are required.' });
    }

    const result = await activeAuthService.login(targetRoll, password);

    res.cookie('ccg_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 86400 * 1000,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Authentication failed.' });
  }
});

// POST /api/auth/admin-login: Dedicated organizer passkey authorization
authRouter.post('/admin-login', async (req: Request, res: Response) => {
  try {
    const { passkey } = req.body;
    if (!passkey) {
      return res.status(400).json({ error: 'Organizer passkey is required.' });
    }

    const result = await activeAuthService.verifyAdmin(passkey);

    res.cookie('ccg_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 86400 * 1000,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized organizer access.' });
  }
});

// GET /api/auth/me: Retrieve currently authenticated identity
authRouter.get('/me', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

    // Check cookie fallback
    if (!token && req.headers.cookie) {
      const match = req.headers.cookie.match(/ccg_session=([^;]+)/);
      if (match) token = match[1];
    }

    if (!token) {
      return res.status(200).json({ user: null });
    }

    const user = await activeAuthService.getUserByToken(token);
    return res.status(200).json({ user });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// POST /api/auth/logout: Invalidate session
authRouter.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token && req.headers.cookie) {
      const match = req.headers.cookie.match(/ccg_session=([^;]+)/);
      if (match) token = match[1];
    }

    if (token) {
      await activeAuthService.logout(token);
    }

    res.clearCookie('ccg_session');
    return res.status(200).json({ success: true, message: 'Logged out successfully.' });
  } catch {
    return res.status(500).json({ error: 'Logout failed' });
  }
});

// Deprecated legacy endpoints with clear guidance
authRouter.all(['/send-otp', '/verify-otp', '/resend-otp'], (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'OTP authentication has been retired. Please use /api/auth/register or /api/auth/login with your password.',
  });
});
