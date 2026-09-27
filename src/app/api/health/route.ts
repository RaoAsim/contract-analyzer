import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { workerStatus } from "@/lib/jobs/worker";
import { bucketReachable } from "@/lib/storage/supabase";
import type { HealthResponse } from "@/types/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function check(fn: () => Promise<unknown>): Promise<"ok" | "error"> {
  try {
    const r = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
    ]);
    return r === false ? "error" : "ok";
  } catch (err) {
    console.warn("[health] check failed:", err instanceof Error ? err.message : String(err));
    return "error";
  }
}

/** Database reachable + Storage bucket reachable + worker loop alive. Never echoes secrets or error details. */
export async function GET(): Promise<NextResponse<HealthResponse>> {
  let configOk = true;
  let runWorker = true;
  try {
    runWorker = getConfig().RUN_WORKER;
  } catch {
    configOk = false;
  }
  const dbStart = Date.now();
  const database = configOk ? await check(() => getDb().execute(sql`select 1`)) : "error";
  const dbLatencyMs = Date.now() - dbStart;
  const storage = configOk ? await check(() => bucketReachable()) : "error";
  const worker: HealthResponse["worker"] = runWorker ? workerStatus() : "disabled";
  const ok = database === "ok" && storage === "ok" && worker !== "stopped";
  return NextResponse.json({ ok, database, dbLatencyMs, storage, worker }, { status: ok ? 200 : 503 });
}
