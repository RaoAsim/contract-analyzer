/** An expected API failure with a user-facing message. Serialized as `{ error: { code, message } }`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string): ApiError =>
  new ApiError(404, "not_found", `${what} was not found. It may have been deleted.`);
