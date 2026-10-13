/**
 * Webmail OTP Client SDK for Web & Node.js
 * =========================================
 * Lightweight, zero-dependency client SDK for IIT Bombay (and institutional)
 * Webmail OTP verification services.
 *
 * Works in:
 * - Browsers (Vanilla JS, React, Vue, Next.js, Svelte, Vite)
 * - Node.js (v18+ with native fetch)
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.WebmailOtpClient = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  /**
   * Helper to parse IIT Bombay roll numbers
   * @param {string} rollNumber - e.g. "23b1234", "22m0456"
   * @returns {{ studentId: string, year: string, degree: string, programCode: string }}
   */
  function parseRollNumber(rollNumber) {
    const clean = String(rollNumber || '').trim().toLowerCase();
    let year = '';
    let degree = '';
    let programCode = '';

    if (clean.length >= 3 && /^\d{2}/.test(clean)) {
      year = '20' + clean.slice(0, 2);
      programCode = clean.charAt(2);
      const degreeMap = {
        b: 'B.Tech.',
        m: 'M.Tech.',
        p: 'Ph.D.',
        d: 'Dual Degree (B.Tech. + M.Tech.)',
        s: 'M.Sc.',
        r: 'M.S. by Research'
      };
      degree = degreeMap[programCode] || 'Degree Student';
    }

    return {
      studentId: clean,
      year: year,
      degree: degree,
      programCode: programCode
    };
  }

  /**
   * Webmail OTP Client
   */
  class WebmailOtpClient {
    /**
     * @param {Object} [config]
     * @param {string} [config.baseUrl="http://127.0.0.1:5000"] - Base URL of OTP service
     * @param {Storage} [config.storage] - Storage to persist auth tokens (e.g. window.sessionStorage)
     * @param {string} [config.storagePrefix="webmail_otp_"] - Storage key prefix
     */
    constructor(config = {}) {
      this.baseUrl = (config.baseUrl || 'http://127.0.0.1:5000').replace(/\/+$/, '');
      this.storagePrefix = config.storagePrefix || 'webmail_otp_';
      this.storage = config.storage || (typeof window !== 'undefined' ? window.sessionStorage : null);

      this.currentStudentId = this._getItem('sid') || null;
      this.lastOtpToken = null;
      this.authToken = this._getItem('auth_token') || null;
    }

    _setItem(key, value) {
      if (!this.storage) return;
      try {
        if (value === null || value === undefined) {
          this.storage.removeItem(this.storagePrefix + key);
        } else {
          this.storage.setItem(this.storagePrefix + key, value);
        }
      } catch (e) {
        console.warn('[WebmailOtpClient] Storage error:', e);
      }
    }

    _getItem(key) {
      if (!this.storage) return null;
      try {
        return this.storage.getItem(this.storagePrefix + key);
      } catch {
        return null;
      }
    }

    /**
     * Step 1: Send OTP to student webmail
     * @param {string} studentId - Roll number / LDAP ID (e.g., "23b1234")
     * @returns {Promise<{ status: string, email?: string, otpToken?: string, bypassed?: boolean, authToken?: string, studentId?: string, defaultDegree?: string, defaultYear?: string }>}
     */
    async sendOtp(studentId) {
      const cleanSid = String(studentId || '').trim().toLowerCase();
      if (!cleanSid) {
        throw new Error('Student ID / Roll number is required');
      }

      this.currentStudentId = cleanSid;
      this._setItem('sid', cleanSid);

      const resp = await fetch(`${this.baseUrl}/api/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_id: cleanSid })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        throw new Error(data.error || `Failed to send OTP (HTTP ${resp.status})`);
      }

      // Handle developer bypass mode
      if (data.bypassed) {
        this.authToken = data.token;
        this._setItem('auth_token', this.authToken);
        return {
          status: 'ok',
          bypassed: true,
          authToken: data.token,
          studentId: data.student_id || cleanSid,
          defaultDegree: data.default_degree,
          defaultYear: data.default_year
        };
      }

      this.lastOtpToken = data.otp_token;
      return {
        status: 'ok',
        bypassed: false,
        email: data.email,
        otpToken: data.otp_token,
        studentId: cleanSid
      };
    }

    /**
     * Step 2: Verify OTP entered by user
     * @param {string} otpInput - 6-digit OTP code entered by student
     * @param {string} [otpToken] - Optional override for the challenge token
     * @returns {Promise<{ status: string, studentId: string, authToken: string, defaultDegree?: string, defaultYear?: string }>}
     */
    async verifyOtp(otpInput, otpToken) {
      const code = String(otpInput || '').trim();
      const token = otpToken || this.lastOtpToken;

      if (!code) {
        throw new Error('Please enter the 6-digit OTP');
      }
      if (!token) {
        throw new Error('No OTP challenge token available. Call sendOtp first.');
      }

      const resp = await fetch(`${this.baseUrl}/api/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          otp_input: code,
          otp_token: token
        })
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        throw new Error(data.error || `Verification failed (HTTP ${resp.status})`);
      }

      this.authToken = data.token;
      this.currentStudentId = data.student_id;
      this._setItem('auth_token', this.authToken);
      this._setItem('sid', this.currentStudentId);

      return {
        status: 'ok',
        studentId: data.student_id,
        authToken: data.token,
        defaultDegree: data.default_degree,
        defaultYear: data.default_year
      };
    }

    /**
     * Get Authorization header for authenticated requests
     * @returns {{ Authorization: string } | {}}
     */
    getAuthHeader() {
      if (!this.authToken) return {};
      return { Authorization: `Bearer ${this.authToken}` };
    }

    /**
     * Check if client currently holds an authentication token
     * @returns {boolean}
     */
    isAuthenticated() {
      return Boolean(this.authToken);
    }

    /**
     * Clears local session and stored authentication tokens
     */
    logout() {
      this.authToken = null;
      this.lastOtpToken = null;
      this.currentStudentId = null;
      this._setItem('auth_token', null);
      this._setItem('sid', null);
    }

    /**
     * Utility method: Parse roll number info
     */
    parseRollNumber(rollNumber) {
      return parseRollNumber(rollNumber || this.currentStudentId);
    }
  }

  WebmailOtpClient.parseRollNumber = parseRollNumber;
  return WebmailOtpClient;
});
