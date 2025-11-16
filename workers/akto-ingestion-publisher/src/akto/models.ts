import { getStatusText } from "./utils";

export interface AdditionalData {
  parentMcpToolNames?: string[];
}

export interface IngestDataPayload {
  path: string;
  requestHeaders: string;
  responseHeaders: string;
  method: string;
  requestPayload: string;
  responsePayload: string;
  ip: string;
  time: string;
  statusCode: string;
  type: string;
  status: string;
  akto_account_id: string;
  akto_vxlan_id: string;
  is_pending: string;
  source: string;
  tag: string;
  parentMcpToolNames?: string[];
}

/**
 * Build Akto ingest data payload from request and response
 */
export function buildIngestDataPayload(
  request: Request,
  requestBody: string,
  res: Response,
  responseBody: string,
  additionalData?: AdditionalData
): string {
  const tags = {
    service: "cloudflare",
    source: "ENDPOINT"
  };
  const url = new URL(request.url);
  const statusText = res.statusText || getStatusText(res.status);

  const value: IngestDataPayload = {
    path: url.pathname + url.search,
    requestHeaders: JSON.stringify(Object.fromEntries(request.headers)),
    responseHeaders: JSON.stringify(Object.fromEntries(res.headers)),
    method: request.method,
    requestPayload: requestBody,
    responsePayload: responseBody,
    ip: request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "",
    time: Math.round(Date.now() / 1000).toString(),
    statusCode: res.status.toString(),
    type: "HTTP/1.1",
    status: statusText,
    akto_account_id: "1000000",
    akto_vxlan_id: "0",
    is_pending: "false",
    source: "MIRRORING",
    tag: JSON.stringify(tags) // '{\n  "service": "cloudflare"\n}'
  };

  // ONLY add parentMcpToolNames if it exists and is not empty
  if (additionalData?.parentMcpToolNames && additionalData.parentMcpToolNames.length > 0) {
    value.parentMcpToolNames = additionalData.parentMcpToolNames;
    console.log(`Added parentMcpToolNames to log: ${JSON.stringify(additionalData.parentMcpToolNames)}`);
  } else {
    console.log("No parentMcpToolNames - this is MCP traffic (not from inside a tool)");
  }

  return JSON.stringify({ batchData: [value] });
}
