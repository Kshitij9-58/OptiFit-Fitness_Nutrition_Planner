"""Database engine and session.

Reads DATABASE_URL from the environment. On Render this points at Supabase
Postgres so saved plans survive deploys. With no variable set it falls back to
a local SQLite file, so `uvicorn app.main:app --reload` still works on a
laptop with no setup.
"""

import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

_DEFAULT_URL = "sqlite:///./optifit.db"


def _normalise(url: str) -> str:
    # SQLAlchemy 2 rejects the legacy "postgres://" scheme that some providers
    # still hand out, and a bare "postgresql://" leaves the driver to chance.
    # Naming psycopg2 explicitly removes the guesswork.
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


# "or" rather than a getenv default, so a variable that exists but is blank
# falls back to SQLite instead of crashing at boot.
SQLALCHEMY_DATABASE_URL = _normalise((os.getenv("DATABASE_URL") or _DEFAULT_URL).strip())

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        # A free-tier service sleeps, and idle connections get dropped on the
        # way. pre_ping tests a connection before use and replaces a dead one,
        # instead of failing the first request after a quiet spell.
        pool_pre_ping=True,
        pool_recycle=300,
        # Small on purpose: Supabase's pooler has its own limits, and this
        # app handles light traffic.
        pool_size=3,
        max_overflow=2,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()