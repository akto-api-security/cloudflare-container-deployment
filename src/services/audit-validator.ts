import type { ValidationContext, AuditPolicy, ValidationResult } from "../types/mcp";

const AUDIT_POLICY_CATEGORY = "AuditPolicy";

/**
 * AuditValidator handles validation logic for audit-type policies
 */
export class AuditValidator {
  /**
   * Extract resource name from MCP request based on method type
   * - tools/call: uses "name" field
   * - resources/read: uses "uri" field
   * - prompts/get: uses "name" field
   */
  private extractResourceName(requestData: Record<string, any>): string {
    const method = requestData.method as string | undefined;
    if (!method) return "";

    const params = requestData.params as Record<string, any> | undefined;
    if (!params) return "";

    switch (method) {
      case "tools/call":
      case "prompts/get":
        // For tools and prompts, use the "name" field
        return (params.name as string) || "";

      case "resources/read":
        // For resources, use the "uri" field
        return (params.uri as string) || "";

      default:
        return "";
    }
  }

  /**
   * Validate request against audit policies
   * Returns null if no audit validation needed, otherwise returns validation result
   */
  validateRequest(payload: string, valCtx: ValidationContext): ValidationResult | null {
    // Parse request to extract method and parameters
    let requestData: Record<string, any>;
    try {
      requestData = JSON.parse(payload);
    } catch (error) {
      return null;
    }

    // Extract resource name from request parameters
    const resourceName = this.extractResourceName(requestData);
    if (!resourceName) {
      return null;
    }

    // Check server-level policy first (by McpServerName)
    if (valCtx.mcpServerName) {
      const serverPolicy = valCtx.auditPolicies?.[valCtx.mcpServerName.toLowerCase()];
      if (serverPolicy) {
        const result = this.validateWithPolicy(serverPolicy, valCtx, resourceName);
        if (result && !result.allowed) {
          return result;
        }
      }
    }

    // Look up audit policy for this specific resource
    const policy = valCtx.auditPolicies?.[resourceName];
    if (!policy) {
      // No audit policy defined for this resource - allow by default
      return null;
    }

    // Validate based on remarks
    return this.validateWithPolicy(policy, valCtx, resourceName);
  }

  /**
   * Validate request against a specific audit policy
   */
  private validateWithPolicy(
    policy: AuditPolicy,
    valCtx: ValidationContext,
    resourcePath: string
  ): ValidationResult | null {
    const remarks = policy.remarks?.trim() || "";
    const remarksLower = remarks.toLowerCase();

    switch (remarksLower) {
      case "approved":
        // Explicitly approved - allow
        console.log(`[AuditValidator] Request approved: ${resourcePath}`);
        return {
          allowed: true,
          modified: false,
        };

      case "rejected":
        // Explicitly rejected - block
        console.log(`[AuditValidator] Request rejected: ${resourcePath} (marked by: ${policy.markedBy})`);
        return {
          allowed: false,
          modified: false,
          reason: "Resource access has been rejected by Audit Policy",
          metadata: {
            policy_id: AUDIT_POLICY_CATEGORY,
          },
        };

      case "conditionally approved":
        // Conditionally approved - check conditions
        console.log(`[AuditValidator] Request conditionally approved, checking conditions: ${resourcePath}`);
        return this.validateConditionalApproval(policy, valCtx, resourcePath);

      default:
        // Unknown remarks value - default to allow with warning
        console.warn(`[AuditValidator] Unknown remarks value "${remarks}" for resource ${resourcePath}, defaulting to allow`);
        return {
          allowed: true,
          modified: false,
        };
    }
  }

  /**
   * Validate conditionally approved requests
   */
  private validateConditionalApproval(
    policy: AuditPolicy,
    valCtx: ValidationContext,
    resourcePath: string
  ): ValidationResult {
    const conditions = policy.approvalConditions;

    if (!conditions) {
      console.log(`[AuditValidator] No approval conditions found, blocking request: ${resourcePath}`);
      return {
        allowed: false,
        modified: false,
        reason: "No approval conditions defined",
        metadata: {
          policy_id: AUDIT_POLICY_CATEGORY,
        },
      };
    }

    // Check 1: Expiry time
    if (conditions.expiresAt && conditions.expiresAt > 0) {
      const currentTime = Math.floor(Date.now() / 1000);
      if (currentTime > conditions.expiresAt) {
        console.log(
          `[AuditValidator] Conditional approval expired: ${resourcePath} (expired at: ${conditions.expiresAt}, current: ${currentTime})`
        );
        return {
          allowed: false,
          modified: false,
          reason: "Conditional approval has expired",
          metadata: {
            policy_id: AUDIT_POLICY_CATEGORY,
          },
        };
      }
    }

    // Check 2 & 3: IP validation (both allowed IPs and IP ranges)
    const clientIP = valCtx.ip;
    if (
      clientIP &&
      (conditions.allowedIps?.length || conditions.allowedIpRanges?.length)
    ) {
      if (!this.isIPAllowed(clientIP, conditions.allowedIps || [], conditions.allowedIpRanges || [])) {
        console.log(`[AuditValidator] Client IP not allowed: ${resourcePath} (IP: ${clientIP})`);
        return {
          allowed: false,
          modified: false,
          reason: "Client IP is not in the allowed list",
          metadata: {
            policy_id: AUDIT_POLICY_CATEGORY,
          },
        };
      }
    }

    // Check 4: Whitelisted endpoints
    // Note: In Cloudflare Workers environment, we don't have a machine ID concept like in Go
    // This check would need to be implemented based on your deployment architecture
    if (conditions.whitelistedEndpoints?.length) {
      // TODO: Implement endpoint ID checking based on your Cloudflare Workers architecture
      console.warn(`[AuditValidator] Whitelisted endpoints check not implemented in Workers environment`);
    }

    // All conditions passed
    console.log(`[AuditValidator] All conditional approval checks passed: ${resourcePath}`);
    return {
      allowed: true,
      modified: false,
    };
  }

  /**
   * Check if client IP matches any allowed IPs or IP ranges
   */
  private isIPAllowed(clientIP: string, allowedIPs: string[], allowedIPRanges: string[]): boolean {
    // Check exact IP matches
    for (const allowedIP of allowedIPs) {
      if (clientIP === allowedIP) {
        return true;
      }
    }

    // Check IP ranges (CIDR notation)
    for (const ipRange of allowedIPRanges) {
      if (this.isIPInCIDR(clientIP, ipRange)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if IP is within CIDR range
   * Simple implementation for IPv4 CIDR checking
   */
  private isIPInCIDR(ip: string, cidr: string): boolean {
    try {
      const [range, bits] = cidr.split("/");
      if (!bits) return false;

      const mask = ~(2 ** (32 - parseInt(bits)) - 1);
      const ipNum = this.ipToNumber(ip);
      const rangeNum = this.ipToNumber(range);

      return (ipNum & mask) === (rangeNum & mask);
    } catch (error) {
      console.error(`[AuditValidator] Invalid CIDR format: ${cidr}`, error);
      return false;
    }
  }

  /**
   * Convert IP address string to number
   */
  private ipToNumber(ip: string): number {
    return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }
}
