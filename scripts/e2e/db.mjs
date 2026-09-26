// Real Postgres (PGlite/WASM) exposed on the wire protocol, standing in for Supabase Postgres.
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

const db = await PGlite.create({ extensions: { vector } });
await db.exec("create schema if not exists extensions;");
const server = new PGLiteSocketServer({ db, port: Number(process.env.PGLITE_PORT ?? 5433), host: "127.0.0.1", maxConnections: 20 });
await server.start();
console.log(`pglite listening on 127.0.0.1:${process.env.PGLITE_PORT ?? 5433}`);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await server.stop(); process.exit(0); });
