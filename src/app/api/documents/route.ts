import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { errorResponse, withApiHandler } from "@/lib/api/handler";
import { getConfig } from "@/lib/config";
import { listDocuments } from "@/lib/db/queries/documents";
import { PermanentIngestError } from "@/lib/ingest/errors";
import { createDocumentFromUpload } from "@/lib/ingest/upload";
import type { DocumentSummary } from "@/types/document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idsSchema = z.array(z.string().uuid()).max(50);

export const GET = withApiHandler(async (req: Request): Promise<NextResponse<{ documents: DocumentSummary[] }>> => {
  const raw = new URL(req.url).searchParams.get("ids");
  const ids = raw ? idsSchema.parse(raw.split(",").filter(Boolean)) : undefined;
  return NextResponse.json({ documents: await listDocuments(ids) });
});

/** Upload ONE file (multipart field "file"). 201 / 413 / 415 / 422 with `{error:{code,message}}` (§8.1). */
export const POST = withApiHandler(async (req: Request): Promise<Response> => {
  const limitMb = getConfig().MAX_UPLOAD_MB;
  const declared = Number(req.headers.get("content-length") ?? "0");
  // Multipart overhead is small; reject clearly oversized bodies before reading them.
  if (declared > (limitMb + 1) * 1024 * 1024) {
    return errorResponse(413, "too_large", `This file is ${(declared / 1048576).toFixed(0)} MB. The limit is ${limitMb} MB.`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new ApiError(400, "invalid_request", "The upload could not be read. Please try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "invalid_request", "No file was attached to the upload.");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const document = await createDocumentFromUpload(file.name, bytes);
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    if (err instanceof PermanentIngestError) return errorResponse(err.httpStatus, err.code, err.message);
    throw err;
  }
});
