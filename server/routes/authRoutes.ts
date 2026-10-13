// server/routes/authRoutes.ts
import { Router, Request, Response } from 'express';
import { activeAuthService } from '../services/authService';

export const authRouter = Router();

// Helper to get client IP for rate limiting
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Returns true when institutional webmail OTP login is enabled.
 * Set OTP_ENABLED=false to put participant authentication into maintenance mode.
 * Admin login is NOT affected by this flag.
 */
function isOtpEnabled(): boolean {
  // Default to enabled; only the explicit string "false" disables it
  return process.env.OTP_ENABLED !== 'false';
}

const OTP_DISABLED_RESPONSE = {
  error: 'Institutional OTP login is temporarily unavailable. This website is in staging mode.',
  staging: true,
};

// GET /api/auth/status: Return OTP availability for frontend feature flag
// Checked by LoginScreen on mount to show the staging notice.
authRouter.get('/status', (_req: Request, res: Response) => {
  res.status(200).json({
    otpEnabled: isOtpEnabled(),
    staging: !isOtpEnabled(),
  });
});

// POST /api/auth/send-otp: Initiate login & send Webmail OTP
authRouter.post('/send-otp', async (req: Request, res: Response) => {
  if (!isOtpEnabled()) {
    return res.status(503).json(OTP_DISABLED_RESPONSE);
  }
  try {
    const { name, rollNumber, student_id } = req.body;
    const targetRoll = rollNumber || student_id;

    if (!name || !targetRoll) {
      return res.status(400).json({ error: 'Name and student roll number are required' });
    }

    const clientIp = getClientIp(req);
    const result = await activeAuthService.sendOtp(name, targetRoll, clientIp);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to send OTP' });
  }
});

// Legacy / Convenience alias: POST /api/auth/login -> maps to send-otp
authRouter.post('/login', async (req: Request, res: Response) => {
  if (!isOtpEnabled()) {
    return res.status(503).json(OTP_DISABLED_RESPONSE);
  }
  try {
    const { name, rollNumber, student_id } = req.body;
    const targetRoll = rollNumber || student_id;

    if (!name || !targetRoll) {
      return res.status(400).json({ error: 'Name and student roll number are required' });
    }

    const clientIp = getClientIp(req);
    const result = await activeAuthService.sendOtp(name, targetRoll, clientIp);
    return res.status(200).json({
      ...result,
      sessionId: result.otpToken || result.token || '',
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to initiate login' });
  }
});

// POST /api/auth/verify-otp: Verify 6-digit OTP code against signed challenge token
authRouter.post('/verify-otp', async (req: Request, res: Response) => {
  if (!isOtpEnabled()) {
    return res.status(503).json(OTP_DISABLED_RESPONSE);
  }
  try {
    const { otp, otp_input, otpToken, otp_token, sessionId, name } = req.body;
    const code = otp || otp_input;
    const challengeToken = otpToken || otp_token || sessionId;

    if (!code) {
      return res.status(400).json({ error: 'Verification code is required' });
    }
    if (!challengeToken) {
      return res.status(400).json({ error: 'OTP challenge token is required' });
    }

    const result = await activeAuthService.verifyOtp(code, challengeToken, name);

    // Set secure HttpOnly cookie for session if headers allow
    res.cookie('ccg_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400 * 1000, // 24 hours
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'OTP verification failed' });
  }
});

// POST /api/auth/resend-otp: Resend OTP code to student webmail
authRouter.post('/resend-otp', async (req: Request, res: Response) => {
  if (!isOtpEnabled()) {
    return res.status(503).json(OTP_DISABLED_RESPONSE);
  }
  try {
    const { rollNumber, student_id } = req.body;
    const targetRoll = rollNumber || student_id;

    if (!targetRoll) {
      return res.status(400).json({ error: 'Roll number is required to resend OTP' });
    }

    const clientIp = getClientIp(req);
    const result = await activeAuthService.resendOtp(targetRoll, clientIp);
    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to resend OTP' });
  }
});

// POST /api/auth/admin-login: Dedicated organizer passkey authorization
// NOTE: admin-login is intentionally NOT gated by OTP_ENABLED — organizer access
// uses a passkey, not webmail OTP, and must remain available during staging.
authRouter.post('/admin-login', async (req: Request, res: Response) => {
  try {
    const { passkey } = req.body;
    if (!passkey) {
      return res.status(400).json({ error: 'Organizer passkey is required' });
    }

    const result = await activeAuthService.verifyAdmin(passkey);

    res.cookie('ccg_session', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 86400 * 1000,
    });

    return res.status(200).json(result);
  } catch (error: any) {
    return res.status(401).json({ error: error.message || 'Unauthorized organizer access' });
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
    return res.status(200).json({ success: true });
  } catch {
    return res.status(500).json({ error: 'Logout failed' });
  }
});
