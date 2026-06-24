// libsql-backed client. Works against a local file DB in dev and a remote
// Turso database in production — same async interface either way. The route
// code is written in PG-flavoured SQL, so this layer translates it on the fly.
//
// Config:
//   Local dev  → no env needed; uses a file at linkedin/backend/data/jobhunt.db
//                (override with SQLITE_DB_PATH).
//   Production → LIBSQL_URL=libsql://<db>-<org>.turso.io
//                LIBSQL_AUTH_TOKEN=<turso token>

import { createClient } from "@libsql/client";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/jobhunt.db");

let client;

export function initPool() {
  let url = process.env.LIBSQL_URL || process.env.TURSO_DATABASE_URL || "";
  const authToken = process.env.LIBSQL_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || undefined;

  if (!url) {
    const dbPath = process.env.SQLITE_DB_PATH || DEFAULT_DB_PATH;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    url = "file:" + dbPath;
  }

  client = createClient({ url, authToken, intMode: "number" });
  console.log("[DB] libsql client created:", url.startsWith("file:") ? url : url.replace(/\?.*/, "..."));
  return client;
}

export function getPool() {
  if (!client) throw new Error("DB not initialized. Call initPool() first.");
  return client;
}

function translatePgSyntax(sql) {
  let result = sql;
  // PG date cast: col::date  →  date(col)
  result = result.replace(/(\w+)::date/gi, "date($1)");
  // PG NOW() - INTERVAL 'N units'  →  datetime('now', '-N units')
  result = result.replace(
    /NOW\(\)\s*-\s*INTERVAL\s*'(\d+)\s+(\w+)'/gi,
    "datetime('now', '-$1 $2')"
  );
  // PG NOW()  →  datetime('now')
  result = result.replace(/\bNOW\(\)/g, "datetime('now')");
  return result;
}

// Replace PG positional placeholders ($1, $2, ...) with libsql/SQLite '?' slots.
// PG allows re-using the same $N — SQLite doesn't, so each occurrence must get
// its own '?' AND the params array must be expanded to match.
function rewritePlaceholders(sql, params) {
  const newParams = [];
  const newSql = sql.replace(/\$(\d+)/g, (_match, n) => {
    const idx = parseInt(n, 10) - 1;
    newParams.push(params[idx]);
    return "?";
  });
  return [newSql, newParams];
}

async function runStmt(sql, params = [], executor = client) {
  const [withPlaceholders, expandedParams] = rewritePlaceholders(
    translatePgSyntax(sql),
    params
  );
  const rs = await executor.execute({ sql: withPlaceholders, args: expandedParams });
  return { rows: rs.rows, rowCount: rs.rowsAffected ?? rs.rows.length };
}

export async function getRow(sql, params = []) {
  return (await runStmt(sql, params)).rows[0];
}

export async function getRows(sql, params = []) {
  return (await runStmt(sql, params)).rows;
}

export async function execute(sql, params = []) {
  return (await runStmt(sql, params)).rowCount;
}

export async function withTransaction(fn) {
  const tx = await client.transaction("write");
  try {
    const fakeClient = {
      query: async (sql, params = []) => runStmt(sql, params, tx),
    };
    const result = await fn(fakeClient);
    await tx.commit();
    return result;
  } catch (err) {
    try { await tx.close(); } catch {}
    throw err;
  }
}
