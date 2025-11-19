/**
 * Utility functions for request handling
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
      console.log("[RequestUtils] Request has no body, using clone()");
      return [request, request.clone()];
    }

    const [stream1, stream2] = request.body.tee();
    const req1 = new Request(request, { body: stream1 });
    const req2 = new Request(request, { body: stream2 });

    console.log("[RequestUtils] Request replicated using tee()");
    return [req1, req2];
  } catch (error) {
    console.error("[RequestUtils] Failed to replicate request:", (error as Error).message);
    throw error;
  }
}
