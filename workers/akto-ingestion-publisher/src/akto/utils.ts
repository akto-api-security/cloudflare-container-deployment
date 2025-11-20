/**
 * Utility functions for traffic ingestion to Akto
 */

/**
 * Replicate a request by splitting its body stream
 * Uses tee() to create independent streams for concurrent consumption
 * 
 * Although, tested independently that clone alone works without tee for all cases,
 * Docs also mention that body is cloned just like tee.
 * https://developer.mozilla.org/en-US/docs/Web/API/Request/clone
 */
export async function replicateRequest(request: Request): Promise<[Request, Request]> {
  try {
    if (!request.body) {
      console.log("[Akto] Request has no body, using clone()");
      return [request, request.clone()];
    }

    const [stream1, stream2] = request.body.tee();
    const req1 = new Request(request, { body: stream1 });
    const req2 = new Request(request, { body: stream2 });

    console.log("[Akto] Request replicated using tee()");
    return [req1, req2];
  } catch (error) {
    console.error("[Akto] Failed to replicate request:", (error as Error).message);
    throw error;
  }
}

/**
 * Replicate a response by splitting its body stream
 * Uses tee() to create independent streams for concurrent consumption
 */
export function replicateResponse(response: Response): [Response, Response] {
  try {
    if (!response.body) {
      console.log("[Akto] Response has no body, using clone()");
      return [response, response.clone()];
    }

    const [stream1, stream2] = response.body.tee();
    const res1 = new Response(stream1, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });
    const res2 = new Response(stream2, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText
    });

    console.log("[Akto] Response replicated using tee()");
    return [res1, res2];
  } catch (error) {
    console.error("[Akto] Failed to replicate response:", (error as Error).message);
    throw error;
  }
}

/**
 * Get HTTP status text from status code
 */
export function getStatusText(statusCode: number): string {
  const statusTexts: Record<number, string> = {
    100: "Continue",
    101: "Switching Protocols",
    200: "OK",
    201: "Created",
    202: "Accepted",
    203: "Non-Authoritative Information",
    204: "No Content",
    205: "Reset Content",
    206: "Partial Content",
    300: "Multiple Choices",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    407: "Proxy Authentication Required",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    411: "Length Required",
    412: "Precondition Failed",
    413: "Payload Too Large",
    414: "URI Too Long",
    415: "Unsupported Media Type",
    416: "Range Not Satisfiable",
    417: "Expectation Failed",
    422: "Unprocessable Entity",
    429: "Too Many Requests",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
    505: "HTTP Version Not Supported",
  };
  return statusTexts[statusCode] || "Unknown";
}
