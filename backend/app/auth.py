"""
Who is making this request?

The browser sends `Authorization: Bearer <token>` where the token was issued by
Supabase when the user signed in. We verify its signature before believing any
of it. A token is just text, and text can be forged; the signature is what makes
it evidence.

Two signing schemes are supported because Supabase changed defaults:
  - Asymmetric (newer projects): we fetch the public keys from the project's
    JWKS endpoint and verify against those. Nothing secret is stored here.
  - HS256 (older projects): verified with the project's JWT secret, which must
    be kept on the server and never shipped to the browser.

Set whichever your project uses:
    SUPABASE_URL=https://<project>.supabase.co     # enables JWKS verification
    SUPABASE_JWT_SECRET=<secret>                   # enables HS256 verification

With neither set, auth is simply off: endpoints still work anonymously.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from fastapi import Depends, HTTPException, Request, status

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
AUDIENCE = os.getenv("SUPABASE_JWT_AUDIENCE", "authenticated")

auth_enabled = bool(SUPABASE_URL or SUPABASE_JWT_SECRET)


@dataclass(frozen=True)
class AuthUser:
    id: str           # Supabase user uuid, stable for the life of the account
    email: str | None


@lru_cache(maxsize=1)
def _jwk_client():
    """Cached: refetching the public keys on every request would be slow and
    would hammer Supabase. PyJWKClient refreshes on an unknown key id."""
    from jwt import PyJWKClient
    return PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")


def _decode(token: str) -> dict:
    import jwt

    if SUPABASE_URL:
        try:
            signing_key = _jwk_client().get_signing_key_from_jwt(token).key
            return jwt.decode(
                token, signing_key,
                algorithms=["RS256", "ES256"],
                audience=AUDIENCE,
            )
        except Exception:
            # Fall through to the shared secret when the project still signs
            # with HS256; otherwise the error below is raised.
            if not SUPABASE_JWT_SECRET:
                raise

    return jwt.decode(
        token, SUPABASE_JWT_SECRET,
        algorithms=["HS256"],
        audience=AUDIENCE,
    )


def _user_from_request(request: Request) -> AuthUser | None:
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    if not auth_enabled:
        return None

    token = header.split(" ", 1)[1].strip()
    try:
        claims = _decode(token)
    except Exception as exc:  # noqa: BLE001 - any failure means "not signed in"
        print(f"auth: rejected token ({type(exc).__name__}: {exc})")
        return None

    user_id = claims.get("sub")
    if not user_id:
        return None
    return AuthUser(id=user_id, email=claims.get("email"))


def optional_user(request: Request) -> AuthUser | None:
    """For endpoints that work signed in or not. Anonymous use is a feature
    here: the calculator should not demand an account."""
    return _user_from_request(request)


def require_user(request: Request) -> AuthUser:
    """For endpoints that only make sense for a signed-in user."""
    user = _user_from_request(request)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to do that.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# Convenience aliases so endpoint signatures read clearly.
OptionalUser = Depends(optional_user)
RequiredUser = Depends(require_user)
