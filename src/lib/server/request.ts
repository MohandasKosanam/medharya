export class RequestBodyTooLargeError extends Error {
  constructor(message = "The request body is too large.") {
    super(message);
    this.name = "RequestBodyTooLargeError";
  }
}

/** Parse JSON after bounding both declared and actual UTF-8 body size. */
export async function readJsonBody(request: Request, maximumBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestBodyTooLargeError();
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) {
    throw new RequestBodyTooLargeError();
  }
  return JSON.parse(raw) as unknown;
}
