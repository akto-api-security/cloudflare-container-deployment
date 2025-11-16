import { shouldCaptureTraffic } from "./validations";
import { buildIngestDataPayload, type AdditionalData } from "./models";
import { AktoIngestionClient } from "./akto-ingestion-client";

/**
 * Ingest traffic data to Akto (main entry point)
 */
export async function ingestTrafficToAkto(
  request: Request,
  response: Response,
  additionalData?: AdditionalData
): Promise<void> {
  const requestUrl = new URL(request.url);
  const path = requestUrl.pathname;

  try {
    // Check if traffic should be captured
    if (!shouldCaptureTraffic(request, response)) {
      console.log(`[Akto] Skipping capture for ${request.method} ${path} - Status: ${response.status}, Content-Type: ${request.headers.get("content-type")}`);
      return;
    }

    console.log(`[Akto] Capturing traffic: ${request.method} ${path} - Status: ${response.status}`);

    // Extract request and response bodies
    const requestBody = await request.text();
    const responseBody = await response.text();

    console.log(`[Akto] Bodies extracted - Request: ${requestBody.length} bytes, Response: ${responseBody.length} bytes`);

    // Build ingestion payload
    const payload = buildIngestDataPayload(request, requestBody, response, responseBody, additionalData);

    // Send to Akto ingestion service
    const client = AktoIngestionClient.getInstance();
    await client.ingestData(payload);

    console.log(`[Akto] Successfully ingested traffic for ${request.method} ${path}`);
  } catch (error) {
    console.error(`[Akto] Failed to ingest traffic for ${request.method} ${path}:`, (error as Error).message);
    // Don't throw - we don't want ingestion failures to affect the main request
  }
}
