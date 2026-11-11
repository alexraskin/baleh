import { z } from "zod";

export class HttpError extends Error {
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message, details: error.details }, { status: error.status });
  }
  console.error(error);
  return json({ error: "Internal server error" }, { status: 500 });
}

/**
 * Parses a JSON body against a Zod schema. Requiring `application/json` also
 * means cross-site form posts can't reach these endpoints without a CORS preflight.
 */
export async function parseJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema>> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    throw new HttpError(415, "Expected application/json");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(400, "Invalid request", z.flattenError(result.error));
  }
  return result.data;
}
