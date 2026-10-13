"""
otp_server.py
=============
Standalone Python Microservice for Webmail OTP Authentication.
Wraps WebmailOtpEngine from webmail_otp_sdk.py for deployment on Render
and secure server-to-server integration with the Express backend.
"""

import os
import sys
from flask import Flask, request, jsonify

# Ensure local directory is in python path
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.insert(0, current_dir)

from webmail_otp_sdk import WebmailOtpEngine, parse_iitb_roll_number

# Optionally load .env file
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(current_dir, ".env"))
except ImportError:
    pass

app = Flask(__name__)

# Initialize OTP Engine from Environment
secret_key = os.environ.get("FLASK_SECRET") or os.environ.get("OTP_SECRET_KEY") or "ccg_secret_otp_encryption_key_2026_prod"
smtp_host = os.environ.get("SMTP_HOST", "smtp-auth.iitb.ac.in")
smtp_port = int(os.environ.get("SMTP_PORT", 587))
smtp_user = os.environ.get("SMTP_USER", "")
smtp_pass = os.environ.get("SMTP_PASS", "")
otp_expiry_sec = int(os.environ.get("OTP_EXPIRY_SEC", 600))
dev_bypass = os.environ.get("DEV_BYPASS_OTP", "false").strip().lower() in ("true", "1", "yes")

# In production, dev bypass must NEVER be enabled
is_production = os.environ.get("NODE_ENV") == "production" or os.environ.get("RENDER") == "true"
if is_production and dev_bypass:
    print("[OTP Service] WARNING: Disabling DEV_BYPASS_OTP in production mode for security.")
    dev_bypass = False

otp_engine = WebmailOtpEngine(
    secret_key=secret_key,
    smtp_host=smtp_host,
    smtp_port=smtp_port,
    smtp_user=smtp_user,
    smtp_pass=smtp_pass,
    otp_expiry_sec=otp_expiry_sec,
    dev_bypass=dev_bypass,
    service_name="CCG Case Challenge"
)

# Simulated delivery in development when institutional SMTP credentials are not configured
last_generated_otps = {}
if not (smtp_user and smtp_pass) and not dev_bypass:
    def simulated_send_mail(student_id: str, otp: str, to_email: str, subject=None, body=None):
        clean_sid = student_id.strip().lower()
        last_generated_otps[clean_sid] = otp
        print(f"[OTP Service Simulated Mail] Delivering OTP [{otp}] to {to_email}")
    otp_engine.send_otp_mail = simulated_send_mail

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "service": "webmail_otp_service",
        "dev_bypass": dev_bypass,
        "smtp_configured": bool(smtp_user and smtp_pass),
        "smtp_host": smtp_host,
        "smtp_user_masked": f"{smtp_user[:2]}***" if smtp_user else None
    }), 200

@app.route("/api/test/last-otp", methods=["GET"])
def get_test_last_otp():
    if is_production:
        return jsonify({"error": "Forbidden in production"}), 403
    sid = request.args.get("student_id", "").strip().lower()
    return jsonify({
        "student_id": sid,
        "otp": last_generated_otps.get(sid)
    }), 200

@app.route("/api/send-otp", methods=["POST", "OPTIONS"])
def send_otp():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id") or data.get("rollNumber") or data.get("roll_number")

    if not student_id:
        return jsonify({"status": "error", "error": "student_id is required"}), 400

    result = otp_engine.process_send_request(str(student_id))
    status_code = result.get("status_code", 200)
    return jsonify(result), status_code

@app.route("/api/verify-otp", methods=["POST", "OPTIONS"])
def verify_otp():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = request.get_json(silent=True) or {}
    otp_input = data.get("otp_input") or data.get("otp")
    otp_token = data.get("otp_token")

    if not otp_input or not otp_token:
        return jsonify({
            "status": "error",
            "error": "Both otp_input and otp_token are required"
        }), 400

    result = otp_engine.process_verify_request(
        otp_input=str(otp_input),
        otp_token=str(otp_token)
    )
    status_code = result.get("status_code", 200)
    return jsonify(result), status_code

@app.route("/api/verify-token", methods=["POST", "OPTIONS"])
def verify_token():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = request.get_json(silent=True) or {}
    token = data.get("token")
    if not token:
        return jsonify({"valid": False, "error": "Token is required"}), 400

    is_valid, sid, err = otp_engine.verify_auth_token(str(token))
    if not is_valid:
        return jsonify({"valid": False, "error": err or "Invalid session token"}), 401

    parsed = parse_iitb_roll_number(sid)
    return jsonify({
        "valid": True,
        "student_id": sid,
        "default_degree": parsed["degree"],
        "default_year": parsed["year"]
    }), 200

if __name__ == "__main__":
    # In shared local development, avoid colliding with Node's PORT (3001) in .env
    if os.environ.get("RENDER") == "true":
        port = int(os.environ.get("PORT", 5001))
    else:
        port = int(os.environ.get("OTP_PORT", 5001))
    print(f"[OTP Service] Webmail OTP Service running on port {port}")
    print(f"[OTP Service] Dev Bypass: {dev_bypass} | SMTP Host: {smtp_host} | User: {smtp_user}")
    app.run(host="0.0.0.0", port=port, debug=False)
