import { replicateRequest, replicateResponse } from "./akto/utils";
import { ingestTrafficToAkto } from "./akto/ingest-data";
import { AktoIngestionClient } from "./akto/akto-ingestion-client";

/**
 * Dummy handler for your application logic
 * Replace this with your actual request handler
 */
async function yourRequestHandler(
  request: Request,
  env: any,
  ctx: ExecutionContext
): Promise<Response> {
  // TODO: Implement your actual application logic here

  // Read request body
  const requestBody = await request.text();
  let requestBodyJson = null;

  try {
    requestBodyJson = requestBody ? JSON.parse(requestBody) : null;
  } catch (e) {
    // Not valid JSON, ignore
  }

  // Extract request ID from MCP request
  const requestId = requestBodyJson?.id || 1;

  // Collect request headers
  const requestHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    requestHeaders[key] = value;
  });

  // Return MCP JSON-RPC 2.0 response format
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: requestId,
    result: {
      content: [{
        type: "text",
        text: "Dummy response text"
      }],
      metadata: {
        originalRequestBody: requestBody,
        originalRequestHeaders: requestHeaders
      }
    }
  }) + "\n", {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Connection": "keep-alive",
      "Strict-Transport-Security": "max-age=315360000; includeSubDomains",
      "X-Xss-Protection": "0",
      "Via": "rws"
    }
  });
}

/**
 * Akto Ingestion Publisher Worker
 *
 * This worker intercepts traffic, replicates requests/responses,
 * and publishes them to Akto for API security monitoring.
 */

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    try {
      // Initialize Akto client on first request
      AktoIngestionClient.init(env.AKTO_INGESTION_WORKER);

      // Replicate the request at the start
      const [requestForMainExecution, requestForAktoIngestion] = await replicateRequest(request);

      // Forward to your application handler
      const response = await yourRequestHandler(requestForMainExecution, env, ctx);

      const [responseForMainExecution, responseForAktoIngestion] = replicateResponse(response);

      // Ingest traffic data to Akto in background (non-blocking)
      ctx.waitUntil(
        ingestTrafficToAkto(requestForAktoIngestion, responseForAktoIngestion)
      );

      // Return response to client
      return responseForMainExecution;
    } catch (error) {
      console.error("[Akto] Critical error in traffic ingestion middleware:", (error as Error).message);
      throw error;
    }
  },
};
