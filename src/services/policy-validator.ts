import type {
  ValidationContext,
  ValidationResult,
  Policy,
  FilterRule,
  ScannerInfo,
} from "../types/mcp";
import { ScannerClient, FilterType } from "./scanner-client";
import { AuditValidator } from "./audit-validator";

/**
 * Safe MCP methods that don't require threat scanning
 */
const SAFE_MCP_METHODS = new Set([
  "initialize",
  "initialized",
  "ping",
  "$/cancelRequest",
  "$/progress",
  "notifications/initialized",
  "notifications/cancelled",
  "notifications/progress",
]);

export class PolicyValidator {
  private scannerClient: ScannerClient;
  private auditValidator: AuditValidator;

  constructor(modelExecutorBinding: Fetcher) {
    this.scannerClient = new ScannerClient(modelExecutorBinding);
    this.auditValidator = new AuditValidator();
  }

  /**
   * Check if MCP method is safe and should skip scanning
   */
  private isSafeMCPMethod(method: string): boolean {
    return SAFE_MCP_METHODS.has(method);
  }

  /**
   * Extract user-controlled fields from MCP payload
   */
  private extractUserControlledFields(payload: string): string {
    if (!payload) return "";

    try {
      const mcpRequest = JSON.parse(payload);
      const method = mcpRequest.method as string | undefined;

      if (!method) {
        return payload; // No method, scan entire payload
      }

      if (this.isSafeMCPMethod(method)) {
        return ""; // Skip scanning for safe methods
      }

      const params = mcpRequest.params as Record<string, any> | undefined;
      if (!params) {
        return payload; // No params, scan entire payload
      }

      return this.extractFromParams(method, params, payload);
    } catch (error) {
      console.error("[PolicyValidator] Failed to parse payload:", error);
      return payload; // Return original for scanning
    }
  }

  /**
   * Extract content from params based on method type
   */
  private extractFromParams(
    method: string,
    params: Record<string, any>,
    fullPayload: string
  ): string {
    const userFields: any[] = [];

    switch (method) {
      case "tools/call": {
        const toolName = params.name as string | undefined;
        const args = params.arguments;

        if (toolName && args) {
          return `Tool: ${toolName}\nArguments:\n${JSON.stringify(
            args
          )}\nContext:\norigin: mcp_call`;
        } else if (toolName) {
          return `Tool: ${toolName}\nArguments:\n{}\nContext:\norigin: mcp_call`;
        }
        break;
      }

      case "sampling/createMessage":
      case "prompts/get": {
        const messages = params.messages as any[] | undefined;
        if (messages) {
          for (const msg of messages) {
            if (msg.content) {
              userFields.push({ _message_content: msg.content });
            }
          }
        }
        if (params.prompt) {
          userFields.push({ _prompt: params.prompt });
        }
        break;
      }

      case "resources/read": {
        if (params.uri) {
          userFields.push({ _resource_uri: params.uri });
        }
        break;
      }

      default:
        userFields.push(params);
    }

    if (userFields.length > 0) {
      return JSON.stringify(userFields);
    }

    return fullPayload;
  }

  /**
   * Validate request against policies
   */
  async validateRequest(
    payload: string,
    valCtx: ValidationContext
  ): Promise<ValidationResult> {
    if (!payload) {
      return {
        allowed: true,
        modified: false,
      };
    }

    // Step 1: Check audit policies FIRST (before guardrails)
    if (valCtx.hasAuditRules && valCtx.auditPolicies) {
      const auditResult = this.auditValidator.validateRequest(payload, valCtx);
      if (auditResult) {
        // Audit policy made a decision (either block or explicit allow)
        if (!auditResult.allowed) {
          // Audit policy blocked - return immediately
          console.log(`[PolicyValidator] Request blocked by audit policy: ${auditResult.reason}`);
          return auditResult;
        }
        // Audit policy allowed - continue to guardrails validation
        console.log(`[PolicyValidator] Request passed audit validation`);
      }
    }

    // Step 2: Proceed with guardrails validation
    const policies = valCtx.policies || [];
    console.log(`[PolicyValidator] Validating request with ${policies.length} guardrail policies`);

    // Extract user-controlled content
    const extractedPayload = this.extractUserControlledFields(payload);
    console.log(`[PolicyValidator] Extracted payload (${extractedPayload.length} chars):`, extractedPayload.substring(0, 200));

    if (!extractedPayload) {
      // Safe method, skip validation
      console.log("[PolicyValidator] Skipping validation - safe method detected");
      return {
        allowed: true,
        modified: false,
      };
    }

    // Collect scanner tasks from policies with policy tracking
    interface ScannerTask extends ScannerInfo {
      policyId: string;
      policyName: string;
    }
    const scannerTasks: ScannerTask[] = [];

    for (const policy of policies) {
      if (!policy.active) continue;

      const requestRules = policy.filters.requestPayload || [];
      console.log(`[PolicyValidator] Policy ${policy.name}: ${requestRules.length} request rules`);

      for (const rule of requestRules) {
        if (ScannerClient.isScannerFilterType(rule.type)) {
          const scanners = ScannerClient.getScannersForFilterType(rule.type);

          for (const scannerName of scanners) {
            scannerTasks.push({
              scanner_type: "prompt",
              scanner_name: scannerName,
              config: rule.config || {},
              policyId: policy.id,
              policyName: policy.name,
            });
          }
        }
      }
    }

    console.log(`[PolicyValidator] Collected ${scannerTasks.length} scanner tasks`);

    // Run scanners if we have any
    if (scannerTasks.length > 0) {
      const scanResponse = await this.scannerClient.scan(
        extractedPayload,
        scannerTasks
      );

      console.log(`[PolicyValidator] Scan complete: ${scanResponse.success_count} passed, ${scanResponse.failure_count} failed`);

      // Check if any scanner detected an issue and find which policy triggered it
      for (const result of scanResponse.results) {
        console.log(`[PolicyValidator] Scanner ${result.scanner_name}: valid=${result.is_valid}, risk_score=${result.risk_score}`);

        if (!result.is_valid) {
          // Find the policy that triggered this scanner
          const matchedTask = scannerTasks.find(
            (task) => task.scanner_name === result.scanner_name
          );

          return {
            allowed: false,
            modified: false,
            reason: `Blocked by scanner: ${result.scanner_name} (risk score: ${result.risk_score})`,
            metadata: {
              policy_id: matchedTask?.policyId || "unknown",
              scanner: result.scanner_name,
              risk_score: result.risk_score,
              details: result.details,
            },
          };
        }
      }
    } else {
      console.log("[PolicyValidator] No scanner tasks - no active policies with scanner rules");
    }

    // All checks passed
    return {
      allowed: true,
      modified: false,
    };
  }

  /**
   * Validate response against policies
   */
  async validateResponse(
    payload: string,
    valCtx: ValidationContext
  ): Promise<ValidationResult> {
    if (!payload) {
      return {
        allowed: true,
        modified: false,
      };
    }

    const policies = valCtx.policies || [];

    // Collect scanner tasks from policies with policy tracking
    interface ScannerTask extends ScannerInfo {
      policyId: string;
      policyName: string;
    }
    const scannerTasks: ScannerTask[] = [];

    for (const policy of policies) {
      if (!policy.active) continue;

      const responseRules = policy.filters.responsePayload || [];

      for (const rule of responseRules) {
        if (ScannerClient.isScannerFilterType(rule.type)) {
          const scanners = ScannerClient.getScannersForFilterType(rule.type);

          for (const scannerName of scanners) {
            scannerTasks.push({
              scanner_type: "output",
              scanner_name: scannerName,
              config: rule.config || {},
              policyId: policy.id,
              policyName: policy.name,
            });
          }
        }
      }
    }

    // Run scanners if we have any
    if (scannerTasks.length > 0) {
      const scanResponse = await this.scannerClient.scan(payload, scannerTasks);

      // Check if any scanner detected an issue and find which policy triggered it
      for (const result of scanResponse.results) {
        if (!result.is_valid) {
          // Find the policy that triggered this scanner
          const matchedTask = scannerTasks.find(
            (task) => task.scanner_name === result.scanner_name
          );

          return {
            allowed: false,
            modified: false,
            reason: `Blocked by scanner: ${result.scanner_name} (risk score: ${result.risk_score})`,
            metadata: {
              policy_id: matchedTask?.policyId || "unknown",
              scanner: result.scanner_name,
              risk_score: result.risk_score,
              details: result.details,
            },
          };
        }
      }
    }

    // All checks passed
    return {
      allowed: true,
      modified: false,
    };
  }

  /**
   * Create blocked response
   */
  createBlockedResponse(
    payload: string,
    reason: string
  ): Record<string, any> {
    return {
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Request blocked by security policy",
        data: {
          reason,
          original_payload: payload,
        },
      },
    };
  }
}
