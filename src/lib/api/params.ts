import { z } from "zod";
import { ApiError } from "./errors";

const uuid = z.string().uuid();

/** Validate a route `[id]` param as a UUID; a malformed id is a 404, not a 500. */
export async function idParam(ctx: { params: Promise<{ id: string }> }, what = "The item"): Promise<string> {
  const { id } = await ctx.params;
  if (!uuid.safeParse(id).success) throw new ApiError(404, "not_found", `${what} was not found.`);
  return id;
}
