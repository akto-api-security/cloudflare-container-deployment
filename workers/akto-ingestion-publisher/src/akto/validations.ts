/**
 * Validation functions for traffic ingestion to Akto
 */

/**
 * Check if content type is allowed for capture
 */
export function isAllowedContentType(contentType: string): boolean {
  const allowedTypes = [
    "application/json",
    "application/xml",
    "text/xml",
    "application/grpc",
    "application/x-www-form-urlencoded",
    "application/soap+xml"
  ];
  return allowedTypes.some(type => contentType.includes(type));
}

/**
 * Check if status code is valid for capture
 */
export function isValidStatus(status: number): boolean {
  return (status >= 200 && status < 300) || [301, 302, 304].includes(status);
}

/**
 * Check if traffic should be captured based on request and response
 */
export function shouldCaptureTraffic(request: Request, response: Response): boolean {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  const isAllowed = isAllowedContentType(contentType);
  return isAllowed && isValidStatus(response.status);
}
