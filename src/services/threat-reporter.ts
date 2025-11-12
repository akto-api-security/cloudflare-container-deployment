import type { ValidationContext, ValidationResult } from "../types/mcp";

const THREAT_DETECTION_API_URL =
  "https://tbs.akto.io/api/threat_detection/record_malicious_event";
const EVENT_TYPE_SINGLE = "EVENT_TYPE_SINGLE";
const TYPE_RULE_BASED = "Rule-Based";

interface MaliciousEvent {
  actor: string;
  filterId: string;
  detectedAt: string;
  latestApiIp: string;
  latestApiEndpoint: string;
  latestApiMethod: string;
  latestApiCollectionId: number;
  latestApiPayload: string;
  eventType: string;
  category: string;
  subCategory: string;
  severity: string;
  type: string;
  metadata: Record<string, any>;
}

interface ThreatReportRequest {
  maliciousEvent: MaliciousEvent;
}

/**
 * Build API payload matching the format expected by Akto TBS
 */
function buildAPIPayload(
  requestPayload: string,
  responsePayload: string,
  method: string,
  ip: string,
  endpoint: string,
  reqHeaders: Record<string, string>,
  respHeaders: Record<string, string>,
  statusCode: number
): string {
  // Match Go implementation exactly
  const payload: any = {
    method: method || "POST",
    requestPayload,
    responsePayload,
    ip: ip || "unknown",
    destIp: ip || "unknown",
    source: "OTHER",
    type: "http",
    akto_vxlan_id: "",
    path: endpoint || "/mcp/unknown",
    requestHeaders: JSON.stringify(reqHeaders || {}),
    responseHeaders: JSON.stringify(respHeaders || {}),
    time: 0,
    akto_account_id: "",
    statusCode: statusCode || 200,
    status: "OK",
  };

  return JSON.stringify(payload);
}

/**
 * Build malicious event from validation result
 */
function buildMaliciousEvent(
  requestPayload: string,
  responsePayload: string,
  metadata: Record<string, any>,
  actor: string,
  endpoint: string,
  method: string,
  reqHeaders: Record<string, string>,
  respHeaders: Record<string, string>,
  statusCode: number
): MaliciousEvent {
  console.log("[ThreatReporter] buildMaliciousEvent input params:", {
    requestPayload,
    responsePayload,
    metadata,
    actor,
    endpoint,
    method,
    reqHeaders,
    respHeaders,
    statusCode,
  });

  const now = Math.floor(Date.now() / 1000);

  // Extract policy information from metadata
  const policyID = (metadata?.policy_id as string) || "Blocked";
  const category = policyID;
  const severity = "CRITICAL";

  // Build API payload combining request and response
  const apiPayload = buildAPIPayload(
    requestPayload,
    responsePayload,
    method,
    actor,
    endpoint,
    reqHeaders,
    respHeaders,
    statusCode
  );

  const maliciousEvent = {
    actor,
    filterId: policyID,
    detectedAt: now.toString(),
    latestApiIp: actor,
    latestApiEndpoint: endpoint,
    latestApiMethod: method || "POST",
    latestApiCollectionId: now,
    latestApiPayload: apiPayload,
    eventType: EVENT_TYPE_SINGLE,
    category,
    subCategory: category,
    severity,
    type: TYPE_RULE_BASED,
    metadata: {
      countryCode: "IN",
      // Note: Only countryCode in metadata, validation metadata is NOT included here
    },
  };

  console.log("[ThreatReporter] Final MaliciousEvent constructed:", JSON.stringify(maliciousEvent, null, 2));

  return maliciousEvent;
}

/**
 * Report threat to Akto TBS (Threat Backend Service)
 */
export async function reportThreat(
  validationResult: ValidationResult,
  valCtx: ValidationContext,
  tbsToken: string
): Promise<void> {
  try {
    console.log("[ThreatReporter] reportThreat called with validationResult:", JSON.stringify(validationResult, null, 2));
    console.log("[ThreatReporter] reportThreat called with valCtx:", JSON.stringify(valCtx, null, 2));

    const event = buildMaliciousEvent(
      valCtx.requestPayload || "",
      valCtx.responsePayload || "",
      validationResult.metadata || {},
      valCtx.ip || "0.0.0.0",
      valCtx.endpoint || "/",
      valCtx.method || "POST",
      valCtx.requestHeaders || {},
      valCtx.responseHeaders || {},
      valCtx.statusCode || 0
    );

    const request: ThreatReportRequest = {
      maliciousEvent: event,
    };

    const requestBody = JSON.stringify(request);

    console.log("[ThreatReporter] Reporting threat to TBS");
    console.log("[ThreatReporter] URL:", THREAT_DETECTION_API_URL);
    console.log("[ThreatReporter] Request summary:", {
      actor: event.actor,
      endpoint: event.latestApiEndpoint,
      method: event.latestApiMethod,
      filterId: event.filterId,
      category: event.category,
      severity: event.severity,
      hasToken: !!tbsToken,
      tokenPrefix: tbsToken ? tbsToken.substring(0, 10) + "..." : "none",
    });
    console.log("[ThreatReporter] Full request body:", requestBody);

    const response = await fetch(THREAT_DETECTION_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tbsToken}`,
      },
      body: requestBody,
    });

    console.log("[ThreatReporter] TBS response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.error(
        `[ThreatReporter] Failed to report threat: ${response.status} - ${errorText}`
      );
      console.error("[ThreatReporter] Request body that failed:", requestBody);
      throw new Error(`TBS API returned status ${response.status}`);
    }

    const responseText = await response.text();
    console.log("[ThreatReporter] TBS response body:", responseText);
    console.log("[ThreatReporter] Threat reported successfully");
  } catch (error) {
    console.error("[ThreatReporter] Error reporting threat:", error);
    // Don't throw - threat reporting is non-critical
  }
}
