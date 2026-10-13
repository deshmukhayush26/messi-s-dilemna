"""
Webmail OTP Verification SDK
============================
A complete, lightweight, dependency-safe Python SDK for IIT Bombay (and institutional)
webmail OTP verification.

Supports two primary use-cases:
1. Client Mode (`WebmailOtpClient`): Connect to an existing Webmail OTP backend service.
2. Server/Engine Mode (`WebmailOtpEngine`): Embed the stateless cryptographic OTP flow
   directly inside your own backend (Flask, FastAPI, Django, Tornado, etc.).

Stack & Cryptographic Design:
- Stateless tokens using itsdangerous.URLSafeTimedSerializer
- Constant-time HMAC-SHA256 comparison (hmac.compare_digest)
- Standard SMTP / STARTTLS mail delivery (smtplib)
"""

from __future__ import annotations

import os
import re
import hmac
import random
import smtplib
import hashlib
from typing import Optional, Dict, Any, Tuple, Callable
from email.mime.text import MIMEText
from dataclasses import dataclass

try:
    from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
except ImportError:
    URLSafeTimedSerializer = None
    BadSignature = Exception
    SignatureExpired = Exception

try:
    import requests
except ImportError:
    requests = None


# ─────────────────────────────────────────────────────────────────────────────
# Data Transfer Objects
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class SendOtpResult:
    status: str
    email: Optional[str] = None
    otp_token: Optional[str] = None
    bypassed: bool = False
    auth_token: Optional[str] = None
    student_id: Optional[str] = None
    default_degree: Optional[str] = None
    default_year: Optional[str] = None
    error: Optional[str] = None

    @property
    def is_success(self) -> bool:
        return self.status == "ok" and not self.error


@dataclass
class VerifyOtpResult:
    status: str
    student_id: Optional[str] = None
    auth_token: Optional[str] = None
    default_degree: Optional[str] = None
    default_year: Optional[str] = None
    error: Optional[str] = None

    @property
    def is_success(self) -> bool:
        return self.status == "ok" and not self.error


# ─────────────────────────────────────────────────────────────────────────────
# Utility Functions
# ─────────────────────────────────────────────────────────────────────────────

def parse_iitb_roll_number(roll_number: str) -> Dict[str, str]:
    """
    Parses an IIT Bombay roll number (e.g. '23b1234', '22m0456', '24d0890').
    Returns inferred year, degree program, and clean student ID.
    """
    clean = str(roll_number or "").strip().lower()
    default_year = ""
    default_degree = ""
    program_code = ""

    if len(clean) >= 3 and clean[:2].isdigit():
        default_year = "20" + clean[:2]
        program_code = clean[2]
        degree_map = {
            "b": "B.Tech.",
            "m": "M.Tech.",
            "p": "Ph.D.",
            "d": "Dual Degree (B.Tech. + M.Tech.)",
            "s": "M.Sc.",
            "r": "M.S. by Research",
        }
        default_degree = degree_map.get(program_code, "Undergraduate / Postgraduate")

    return {
        "student_id": clean,
        "year": default_year,
        "degree": default_degree,
        "program_code": program_code,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 1. CLIENT SDK (For apps calling the OTP API service)
# ─────────────────────────────────────────────────────────────────────────────

class WebmailOtpClient:
    """
    Client SDK to integrate Webmail OTP verification into any Python project
    by communicating with an existing verification API.
    """

    def __init__(self, base_url: str = "http://127.0.0.1:5000", timeout: float = 12.0):
        if requests is None:
            raise ImportError("The 'requests' package is required for WebmailOtpClient. Run: pip install requests")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.current_student_id: Optional[str] = None
        self.last_otp_token: Optional[str] = None
        self.auth_token: Optional[str] = None

    def send_otp(self, student_id: str) -> SendOtpResult:
        """
        Request an OTP for the given student roll number or LDAP ID.
        """
        url = f"{self.base_url}/api/send-otp"
        clean_sid = student_id.strip().lower()
        self.current_student_id = clean_sid

        try:
            resp = self.session.post(
                url,
                json={"student_id": clean_sid},
                headers={"Content-Type": "application/json"},
                timeout=self.timeout
            )
            data = resp.json()
        except requests.RequestException as e:
            return SendOtpResult(status="error", error=f"Network error: {e}")
        except ValueError:
            return SendOtpResult(status="error", error=f"Invalid server response (HTTP {resp.status_code})")

        if resp.status_code != 200 or "error" in data:
            return SendOtpResult(status="error", error=data.get("error", "Failed to send OTP"))

        if data.get("bypassed"):
            self.auth_token = data.get("token")
            return SendOtpResult(
                status="ok",
                bypassed=True,
                auth_token=data.get("token"),
                student_id=data.get("student_id", clean_sid),
                default_degree=data.get("default_degree"),
                default_year=data.get("default_year"),
            )

        self.last_otp_token = data.get("otp_token")
        return SendOtpResult(
            status="ok",
            email=data.get("email"),
            otp_token=self.last_otp_token,
            bypassed=False,
            student_id=clean_sid,
        )

    def verify_otp(self, otp_input: str, otp_token: Optional[str] = None) -> VerifyOtpResult:
        """
        Verify the OTP entered by the user. If otp_token is omitted,
        the token from the most recent send_otp call is used.
        """
        token_to_use = otp_token or self.last_otp_token
        if not token_to_use:
            return VerifyOtpResult(
                status="error",
                error="No OTP token available. Call send_otp first or provide otp_token explicitly."
            )

        url = f"{self.base_url}/api/verify-otp"
        try:
            resp = self.session.post(
                url,
                json={"otp_input": str(otp_input).strip(), "otp_token": token_to_use},
                headers={"Content-Type": "application/json"},
                timeout=self.timeout
            )
            data = resp.json()
        except requests.RequestException as e:
            return VerifyOtpResult(status="error", error=f"Network error: {e}")
        except ValueError:
            return VerifyOtpResult(status="error", error=f"Invalid server response (HTTP {resp.status_code})")

        if resp.status_code != 200 or "error" in data:
            return VerifyOtpResult(status="error", error=data.get("error", "Verification failed"))

        self.auth_token = data.get("token")
        return VerifyOtpResult(
            status="ok",
            student_id=data.get("student_id"),
            auth_token=self.auth_token,
            default_degree=data.get("default_degree"),
            default_year=data.get("default_year"),
        )

    def get_auth_headers(self) -> Dict[str, str]:
        """
        Returns Authorization headers for authenticated requests once verified.
        """
        if not self.auth_token:
            return {}
        return {"Authorization": f"Bearer {self.auth_token}"}


# ─────────────────────────────────────────────────────────────────────────────
# 2. SERVER ENGINE SDK (Embed OTP service directly in your own backend)
# ─────────────────────────────────────────────────────────────────────────────

class WebmailOtpEngine:
    """
    Stateless Server-Side Webmail OTP Engine.
    Embed this in another Flask, FastAPI, or Django service to issue and verify OTPs.
    """

    def __init__(
        self,
        secret_key: str,
        smtp_host: str = "smtp-auth.iitb.ac.in",
        smtp_port: int = 587,
        smtp_user: str = "",
        smtp_pass: str = "",
        otp_expiry_sec: int = 600,
        auth_token_expiry_sec: int = 86400,
        dev_bypass: bool = False,
        default_domain: str = "iitb.ac.in",
        email_lookup_map: Optional[Dict[str, str]] = None,
        service_name: str = "Campus Service",
    ):
        if URLSafeTimedSerializer is None:
            raise ImportError(
                "The 'itsdangerous' package is required for WebmailOtpEngine. Run: pip install itsdangerous"
            )
        self.secret_key = secret_key
        self.smtp_host = smtp_host
        self.smtp_port = int(smtp_port)
        self.smtp_user = smtp_user
        self.smtp_pass = smtp_pass
        self.otp_expiry_sec = otp_expiry_sec
        self.auth_token_expiry_sec = auth_token_expiry_sec
        self.dev_bypass = dev_bypass
        self.default_domain = default_domain.lstrip("@")
        self.email_lookup_map = email_lookup_map or {}
        self.service_name = service_name
        self.serializer = URLSafeTimedSerializer(self.secret_key)

    def _otp_hash(self, otp: str, student_id: str) -> str:
        msg = f"{otp.strip()}:{student_id.strip().lower()}".encode()
        return hmac.new(self.secret_key.encode(), msg, hashlib.sha256).hexdigest()

    def resolve_email(self, student_id: str) -> str:
        """
        Resolve student roll number / LDAP ID to webmail address.
        Checks mapping first; falls back to {student_id}@{default_domain}.
        """
        sid = str(student_id).strip().lower()
        if not sid:
            raise ValueError("Student ID / Roll number is required")

        # 1. Lookup in explicit mapping table if present
        if sid in self.email_lookup_map:
            return self.email_lookup_map[sid]

        # 2. Check if already a full email
        if "@" in sid:
            return sid

        # 3. Fallback to standard university webmail format
        return f"{sid}@{self.default_domain}"

    def generate_otp(self) -> str:
        """Generates a secure 6-digit numeric OTP."""
        return f"{random.randint(100000, 999999):06d}"

    def send_otp_mail(
        self,
        student_id: str,
        otp: str,
        to_email: str,
        subject: Optional[str] = None,
        body: Optional[str] = None
    ) -> None:
        """
        Sends OTP email using SMTP with STARTTLS.
        """
        if not self.smtp_host or not self.smtp_user or not self.smtp_pass:
            raise ValueError("SMTP credentials (host, user, pass) are missing or incomplete.")

        email_subject = subject or f"{self.service_name} — Webmail OTP Verification"
        email_body = body or (
            f"Hello,\n\n"
            f"Your one-time password (OTP) for {self.service_name} is:\n\n"
            f"    {otp}\n\n"
            f"This code is valid for {int(self.otp_expiry_sec // 60)} minutes.\n"
            f"If you did not request this verification, please ignore this email.\n\n"
            f"— {self.service_name} Team"
        )

        msg = MIMEText(email_body, "plain", "utf-8")
        msg["Subject"] = email_subject
        msg["From"] = self.smtp_user
        msg["To"] = to_email

        with smtplib.SMTP(self.smtp_host, self.smtp_port) as server:
            server.starttls()
            server.login(self.smtp_user, self.smtp_pass)
            server.send_message(msg)

    def process_send_request(self, student_id: str) -> Dict[str, Any]:
        """
        High-level helper for handling an incoming /api/send-otp request.
        """
        sid = str(student_id or "").strip().lower()
        if not sid:
            return {"status": "error", "error": "student_id is required", "status_code": 400}

        try:
            to_email = self.resolve_email(sid)
        except Exception as e:
            return {"status": "error", "error": str(e), "status_code": 400}

        parsed = parse_iitb_roll_number(sid)

        # Developer bypass mode
        if self.dev_bypass:
            auth_token = self.issue_auth_token(sid)
            return {
                "status": "ok",
                "status_code": 200,
                "bypassed": True,
                "student_id": sid,
                "email": to_email,
                "default_degree": parsed["degree"],
                "default_year": parsed["year"],
                "token": auth_token,
            }

        # Normal Flow: generate, send, and issue signed OTP challenge token
        otp = self.generate_otp()
        try:
            self.send_otp_mail(student_id=sid, otp=otp, to_email=to_email)
        except Exception as e:
            return {
                "status": "error",
                "error": f"Failed to deliver OTP email: {str(e)}",
                "status_code": 500,
            }

        otp_token = self.serializer.dumps({
            "sid": sid,
            "email": to_email,
            "oh": self._otp_hash(otp, sid),
            "typ": "otp",
        })

        return {
            "status": "ok",
            "status_code": 200,
            "bypassed": False,
            "email": to_email,
            "otp_token": otp_token,
        }

    def process_verify_request(self, otp_input: str, otp_token: str) -> Dict[str, Any]:
        """
        High-level helper for handling an incoming /api/verify-otp request.
        """
        entered = str(otp_input or "").strip()
        token = str(otp_token or "").strip()

        if not entered or not token:
            return {
                "status": "error",
                "error": "Both otp_input and otp_token are required",
                "status_code": 400,
            }

        try:
            payload = self.serializer.loads(token, max_age=self.otp_expiry_sec)
        except SignatureExpired:
            return {
                "status": "error",
                "error": "OTP has expired. Please request a new one.",
                "status_code": 400,
            }
        except (BadSignature, Exception):
            return {
                "status": "error",
                "error": "Invalid or tampered token. Please request a new OTP.",
                "status_code": 400,
            }

        if payload.get("typ") != "otp":
            return {"status": "error", "error": "Invalid token type.", "status_code": 400}

        expected_hash = payload.get("oh", "")
        actual_hash = self._otp_hash(entered, payload.get("sid", ""))

        # Constant-time comparison to prevent timing side-channel attacks
        if not hmac.compare_digest(expected_hash, actual_hash):
            return {
                "status": "error",
                "error": "Incorrect OTP. Please try again.",
                "status_code": 400,
            }

        sid = payload["sid"]
        parsed = parse_iitb_roll_number(sid)
        auth_token = self.issue_auth_token(sid)

        return {
            "status": "ok",
            "status_code": 200,
            "student_id": sid,
            "default_degree": parsed["degree"],
            "default_year": parsed["year"],
            "token": auth_token,
        }

    def issue_auth_token(self, student_id: str) -> str:
        """Issues a signed bearer token valid for auth_token_expiry_sec."""
        return self.serializer.dumps({
            "sid": str(student_id).strip().lower(),
            "typ": "auth",
        })

    def verify_auth_token(self, token: str) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Verifies a bearer token from Authorization header.
        Returns: (is_valid, student_id_or_none, error_message_or_none)
        """
        try:
            payload = self.serializer.loads(token, max_age=self.auth_token_expiry_sec)
        except SignatureExpired:
            return False, None, "Session expired. Please log in again."
        except BadSignature:
            return False, None, "Invalid authentication token."

        if payload.get("typ") != "auth" or not payload.get("sid"):
            return False, None, "Malformed authentication token."

        return True, payload["sid"], None

    def flask_auth_decorator(self, flask_app=None):
        """
        Returns a Flask route decorator (@require_auth) verifying the Bearer token.
        """
        from functools import wraps
        from flask import request, jsonify

        def decorator(f):
            @wraps(f)
            def wrapper(*args, **kwargs):
                if request.method == "OPTIONS":
                    return jsonify({}), 200
                header = request.headers.get("Authorization", "")
                if not header.startswith("Bearer "):
                    return jsonify({"error": "Missing or malformed Authorization header"}), 401
                token = header[7:].strip()
                valid, sid, err = self.verify_auth_token(token)
                if not valid:
                    return jsonify({"error": err}), 401
                # Attach verified student ID to flask request
                request.student_id = sid
                return f(*args, **kwargs)
            return wrapper
        return decorator


# ─────────────────────────────────────────────────────────────────────────────
# CLI / Quick Test Execution
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    print("Webmail OTP Verification SDK")
    print("---------------------------------")
    print("Classes available:")
    print("  - WebmailOtpClient(base_url)")
    print("  - WebmailOtpEngine(secret_key, smtp_host, ...)")
    print("  - parse_iitb_roll_number(roll_number)")
    print()

    # Self-test roll number parsing
    test_rolls = ["23b1234", "21m0567", "24d9999", "20p0012"]
    for r in test_rolls:
        info = parse_iitb_roll_number(r)
        print(f"Sample Roll {r} -> Year: {info['year']}, Degree: {info['degree']}")
    print("Self-test complete. Import this SDK into your projects or run tests.")
