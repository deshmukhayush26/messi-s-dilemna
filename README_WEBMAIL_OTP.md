# Webmail OTP Verification SDK & Integration Guide

A secure, production-tested, **stateless** Webmail OTP authentication system and SDK designed for IIT Bombay and academic/institutional applications.

---

## 1. Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Backend Core** | Python 3.9+ / Flask / FastAPI | High performance, lightweight API servers |
| **Cryptographic Tokens** | `itsdangerous` (`URLSafeTimedSerializer`) | Tamper-proof, signed, time-expiring tokens without database/Redis overhead |
| **Integrity & Security** | `hmac` + `hashlib.sha256` (`compare_digest`) | Cryptographic OTP hashing with constant-time equality check to prevent timing side-channel attacks |
| **Email Protocol** | Standard `smtplib` + STARTTLS (Port 587) | Encrypted transport for sending OTPs via institutional relay (`smtp-auth.iitb.ac.in`) |
| **Client Protocols** | Python SDK (`webmail_otp_sdk.py`), JS Client (`webmail_otp_client.js`) | Zero-friction integration into both frontend and backend projects |

---

## 2. API Endpoints

### 1) Send OTP
Requests a 6-digit verification code sent to the student's institutional webmail.

- **URL:** `/api/send-otp`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "student_id": "23b1234"
  }
  ```

#### Responses:

- **Standard Success (`200 OK`):**
  ```json
  {
    "status": "ok",
    "email": "23b1234@iitb.ac.in",
    "otp_token": "eyJzaWQiOiIyM2IxMjM0IiwiZW1haWwiOiIyM2IxMjM0QGlpdGIuYWMuaW4iLCJvaCI6ImFlMz..."
  }
  ```
  > **Note:** `otp_token` is a stateless, signed payload containing `sid`, `email`, and the HMAC hash of `(otp + student_id)`. It is valid for `OTP_EXPIRY_SEC` (default: 10 minutes).

- **Dev Bypass Mode (`200 OK` when `DEV_BYPASS_OTP=true`):**
  ```json
  {
    "status": "ok",
    "bypassed": true,
    "student_id": "23b1234",
    "default_degree": "B.Tech.",
    "default_year": "2023",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
  *(Instantly returns the authenticated Bearer token without triggering SMTP delivery).*

- **Error (`400 Bad Request` or `500 Internal Error`):**
  ```json
  {
    "error": "No valid webmail address found for sending OTP"
  }
  ```

---

### 2) Verify OTP
Validates the user's submitted OTP against the signed `otp_token` challenge.

- **URL:** `/api/verify-otp`
- **Method:** `POST`
- **Headers:** `Content-Type: application/json`
- **Request Body:**
  ```json
  {
    "otp_input": "482910",
    "otp_token": "eyJzaWQiOiIyM2IxMjM0IiwiZW1haWwiOiIyM2IxMjM0QGlpdGIuYWMuaW4iLCJvaCI6ImFlMz..."
  }
  ```

#### Responses:

- **Success (`200 OK`):**
  ```json
  {
    "status": "ok",
    "student_id": "23b1234",
    "default_degree": "B.Tech.",
    "default_year": "2023",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
  > Returns a signed session `token` (Bearer token) valid for 24 hours (`max_age=86400`).

- **Error (`400 Bad Request`):**
  - `"error": "Incorrect OTP. Please try again."`
  - `"error": "OTP has expired. Please request a new one."`
  - `"error": "Invalid request. Please request a new OTP."`

---

### 3) Protected Endpoints Pattern
Subsequent API calls in your application can require the returned Bearer token:

- **Header:** `Authorization: Bearer <token>`
- Token contains: `{"sid": "23b1234", "typ": "auth"}`
- Failure response: `401 Unauthorized` (`{"error": "Session expired. Please verify again."}`)

---

## 3. Environment Variables

Add these to your `.env` file in any project running or testing the authentication service:

```bash
# SMTP Settings (Institutional Mail Server)
SMTP_HOST="smtp-auth.iitb.ac.in"
SMTP_PORT=587
SMTP_USER="your_ldap_or_sending_id"
SMTP_PASS="your_password_or_app_password"

# Application Security
FLASK_SECRET="generate_a_long_random_hex_key_here"
OTP_EXPIRY_SEC=600                 # 10 minutes in seconds

# Development Toggle
DEV_BYPASS_OTP=false               # Set to 'true' during local offline testing
```

---

## 4. How to Use the SDK in Another Project

### Use Case A: Python Client SDK (`WebmailOtpClient`)
Use this when your new project needs to authenticate users via an existing Webmail OTP backend:

```python
from webmail_otp_sdk import WebmailOtpClient

# 1. Initialize client with OTP service URL
client = WebmailOtpClient(base_url="http://127.0.0.1:5000")

# 2. Step 1: Send OTP
res = client.send_otp("23b1234")
if not res.is_success:
    print(f"Error: {res.error}")
    exit(1)

if res.bypassed:
    print("Dev bypass active! Directly authenticated.")
    print("Session Token:", res.auth_token)
else:
    print(f"OTP sent to {res.email}")

    # 3. Step 2: Verify OTP
    user_otp = input("Enter OTP received on webmail: ")
    verify_res = client.verify_otp(user_otp)

    if verify_res.is_success:
        print(f"Verified student: {verify_res.student_id}")
        print(f"Degree: {verify_res.default_degree}, Batch Year: {verify_res.default_year}")
        print("Auth Token:", verify_res.auth_token)
        
        # Make authenticated requests with:
        headers = client.get_auth_headers()  # {'Authorization': 'Bearer <token>'}
    else:
        print("Verification failed:", verify_res.error)
```

---

### Use Case B: Embedded Server Engine (`WebmailOtpEngine`)
Use this when your new project is a **backend** (Flask, FastAPI, Django, etc.) and you want to implement the exact same stateless OTP issuance and verification inside your own service:

#### In Flask:
```python
from flask import Flask, request, jsonify
from webmail_otp_sdk import WebmailOtpEngine

app = Flask(__name__)

# Initialize OTP Engine
otp_engine = WebmailOtpEngine(
    secret_key="my_super_secret_project_key",
    smtp_host="smtp-auth.iitb.ac.in",
    smtp_port=587,
    smtp_user="sending_account",
    smtp_pass="password",
    otp_expiry_sec=600,
    dev_bypass=False,
    service_name="My New Portal"
)

require_auth = otp_engine.flask_auth_decorator(app)

@app.route("/api/send-otp", methods=["POST"])
def send_otp_endpoint():
    data = request.get_json() or {}
    result = otp_engine.process_send_request(data.get("student_id"))
    return jsonify(result), result.get("status_code", 200)

@app.route("/api/verify-otp", methods=["POST"])
def verify_otp_endpoint():
    data = request.get_json() or {}
    result = otp_engine.process_verify_request(
        otp_input=data.get("otp_input"),
        otp_token=data.get("otp_token")
    )
    return jsonify(result), result.get("status_code", 200)

@app.route("/api/protected-data", methods=["GET"])
@require_auth
def protected_endpoint():
    # request.student_id is automatically populated and verified!
    return jsonify({"message": f"Hello student {request.student_id}!"})
```

#### In FastAPI:
```python
from fastapi import FastAPI, Header, HTTPException, Depends
from webmail_otp_sdk import WebmailOtpEngine
from pydantic import BaseModel

app = FastAPI()
otp_engine = WebmailOtpEngine(secret_key="secret", dev_bypass=True)

class SendOtpPayload(BaseModel):
    student_id: str

class VerifyOtpPayload(BaseModel):
    otp_input: str
    otp_token: str

@app.post("/api/send-otp")
def send_otp(payload: SendOtpPayload):
    return otp_engine.process_send_request(payload.student_id)

@app.post("/api/verify-otp")
def verify_otp(payload: VerifyOtpPayload):
    return otp_engine.process_verify_request(payload.otp_input, payload.otp_token)

def get_current_student(authorization: str = Header(...)):
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")
    valid, sid, err = otp_engine.verify_auth_token(authorization[7:])
    if not valid:
        raise HTTPException(status_code=401, detail=err)
    return sid

@app.get("/api/profile")
def get_profile(student_id: str = Depends(get_current_student)):
    return {"student_id": student_id, "status": "authenticated"}
```

---

### Use Case C: Web Frontend (Vanilla JS / React / Next.js)
Using `webmail_otp_client.js`:

```html
<script src="/webmail_otp_client.js"></script>
<script>
  const client = new WebmailOtpClient({ baseUrl: 'http://127.0.0.1:5000' });

  async function handleSend() {
    try {
      const res = await client.sendOtp('23b1234');
      if (res.bypassed) {
        alert('Dev bypass active! Welcome: ' + res.studentId);
      } else {
        alert('OTP sent to ' + res.email);
      }
    } catch(err) {
      alert('Error: ' + err.message);
    }
  }

  async function handleVerify() {
    try {
      const res = await client.verifyOtp('123456');
      alert(`Verified: ${res.studentId} (${res.defaultDegree})`);
      
      // Call protected endpoints:
      const response = await fetch('/api/user-data', {
        headers: { ...client.getAuthHeader() }
      });
    } catch(err) {
      alert('Verification failed: ' + err.message);
    }
  }
</script>
```

In React / Next.js / Vite (ES Modules):
```javascript
import WebmailOtpClient from './webmail_otp_client.js';

const otpClient = new WebmailOtpClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:5000'
});

// Step 1:
await otpClient.sendOtp(studentId);

// Step 2:
const result = await otpClient.verifyOtp(enteredCode);
console.log('Logged in user:', result.studentId);
```

---

## 5. Security Architecture Highlights

1. **Zero Database / Redis Storage Required (Stateless)**:
   OTPs and temporary sessions are not stored in memory or a database. The OTP verification challenge is cryptographically bound into an URL-safe signed payload.
2. **Replay & Tampering Resistance**:
   If an attacker alters the roll number, the email, or the expiry time inside `otp_token`, `itsdangerous` immediately rejects the signature.
3. **Timing-Attack Prevention**:
   OTP comparison uses `hmac.compare_digest` ensuring constant-time validation that cannot be decoded via byte comparison latency measurements.
4. **Dev Bypass Safety**:
   `DEV_BYPASS_OTP` can only be activated via environment variables on trusted non-production environments.
