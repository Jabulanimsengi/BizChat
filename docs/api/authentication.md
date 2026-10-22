# Authentication API

Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production. The token is a random
256-bit value; only an HMAC-SHA256 digest is stored. Password reset and email verification tokens
follow the same pattern and are single-use.

## Endpoints

| Method | Path                           | Guards          | Notes                                                                                   |
| ------ | ------------------------------ | --------------- | --------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/auth/register`        | Origin          | Creates a business, owner, default department, and session. Sends a verification email. |
| `POST` | `/api/v1/auth/login`           | Origin          | Sets the session cookie.                                                                |
| `GET`  | `/api/v1/auth/me`              | Session         | Returns the user, membership, and business.                                             |
| `POST` | `/api/v1/auth/logout`          | Session, Origin | Revokes the current session.                                                            |
| `POST` | `/api/v1/auth/password/forgot` | Origin          | Always `202`; no account enumeration. Emails a reset link when the account exists.      |
| `POST` | `/api/v1/auth/password/reset`  | Origin          | Consumes the token, rotates the password, revokes all sessions.                         |
| `POST` | `/api/v1/auth/email/verify`    | Origin          | Consumes the token and sets `emailVerifiedAt`.                                          |
| `POST` | `/api/v1/auth/email/resend`    | Session, Origin | Re-sends the verification email for the current user.                                   |

All of the above are rate limited. Reset and verification links point at the dashboard
(`DASHBOARD_URL/reset-password?token=…` and `DASHBOARD_URL/verify-email?token=…`).

## Request bodies

```jsonc
// POST /auth/password/forgot
{ "email": "owner@example.com" }

// POST /auth/password/reset
{ "token": "<opaque token>", "password": "at-least-12-characters" }

// POST /auth/email/verify
{ "token": "<opaque token>" }
```

## Configuration

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` control delivery.
- When `SMTP_HOST` is unset (development), messages are written to the structured log instead of sent.
- `PASSWORD_RESET_TTL_MINUTES` (default `60`) and `EMAIL_VERIFICATION_TTL_HOURS` (default `24`) bound
  link lifetimes.
- Production requires `SMTP_HOST`; the environment guard refuses to boot without it.
