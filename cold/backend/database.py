from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy.engine import URL
import os
import urllib.parse


def _build_engine():
    raw_url = os.getenv("DATABASE_URL", "sqlite:///./cold_email.db")

    # Turso / libsql (remote SQLite). URL form:
    #   sqlite+libsql://<db>-<org>.turso.io/?authToken=<token>&secure=true
    # The sqlalchemy-libsql dialect handles the HTTP connection; it does not
    # accept the pysqlite-only check_same_thread arg.
    if "libsql" in raw_url:
        return create_engine(raw_url, pool_pre_ping=True)

    if raw_url.startswith("sqlite"):
        return create_engine(raw_url, connect_args={"check_same_thread": False})

    # Parse the URL ourselves so psycopg2 receives an already-decoded username.
    # Supabase session-pooler usernames contain a literal dot
    # (e.g. postgres.projectref) which older psycopg2 URL parsers truncate at the
    # dot.  By passing components via URL.create() we bypass that parser entirely.
    parsed = urllib.parse.urlparse(raw_url)
    username = urllib.parse.unquote(parsed.username or "")
    password = urllib.parse.unquote(parsed.password or "")
    host     = parsed.hostname or "localhost"
    port     = parsed.port or 5432
    database = (parsed.path or "/postgres").lstrip("/")

    sa_url = URL.create(
        drivername="postgresql+psycopg2",
        username=username,
        password=password,
        host=host,
        port=port,
        database=database,
    )
    return create_engine(sa_url, pool_pre_ping=True)


engine = _build_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
