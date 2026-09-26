import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError } from "./errors";
import type { ApiErrorBody } from "@/types/api";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

export function errorResponse(status: number, code: string, message: string): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Owns the error envelope for every route: expected failures (`ApiError`, zod) become
 * `{ error: { code, message } }` with an accurate status; anything else is logged server-side
 * and masked as a generic 500 (never leak DB errors or stack traces).
 */
export function withApiHandler<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.status, err.code, err.message);
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const where = first?.path.length ? ` (${first.path.join(".")})` : "";
        return errorResponse(400, "invalid_request", `Invalid request${where}: ${first?.message ?? "bad input"}`);
      }
      console.error(`[api] ${req.method} ${new URL(req.url).pathname} failed:`, err);
      return errorResponse(500, "internal_error", "Something went wrong on our side. Please try again.");
    }
  };
}
