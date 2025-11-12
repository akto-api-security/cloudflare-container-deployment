import type {
  ValidationContext,
  ProcessResult,
  Policy,
  AuditPolicy,
} from "../types/mcp";
import { PolicyValidator } from "./policy-validator";
import { reportThreat } from "./threat-reporter";

export class MCPProcessor {
  private validator: PolicyValidator;
  private skipThreat: boolean;
  private tbsToken: string;
  private executionCtx?: ExecutionContext;

  constructor(
    modelExecutorBinding: Fetcher,
    tbsToken: string = "",
    skipThreat: boolean = false,
    executionCtx?: ExecutionContext
  ) {
    this.validator = new PolicyValidator(modelExecutorBinding);
    this.tbsToken = tbsToken;
    this.skipThreat = skipThreat;
    this.executionCtx = executionCtx;
  }

  /**
   * Process and validate incoming MCP requests
   */
  async processRequest(
    rawRequestPayload: string,
    valCtx: ValidationContext,
    policies: Policy[],
    auditPolicies: Record<string, AuditPolicy>,
    hasAuditRules: boolean
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      isBlocked: false,
      shouldForward: true,
    };

    if (!rawRequestPayload) {
      return result;
    }

    // Parse JSON to extract structured data
    let requestData: Record<string, any>;
    try {
      requestData = JSON.parse(rawRequestPayload);
      result.parsedData = requestData;
    } catch (error) {
      console.error("[MCP] Failed to parse request JSON:", error);
      return result; // Still allow forwarding for non-JSON payloads
    }

    // Validate request if threat detection is enabled
    if (!this.skipThreat) {
      valCtx.requestPayload = rawRequestPayload;
      valCtx.policies = policies;
      valCtx.auditPolicies = auditPolicies;
      valCtx.hasAuditRules = hasAuditRules;

      const validationResult = await this.validator.validateRequest(
        rawRequestPayload,
        valCtx
      );

      console.log(
        `[MCP] ValidateRequest: allowed=${validationResult.allowed}, modified=${validationResult.modified}, reason=${validationResult.reason}`
      );

      // Handle blocked requests
      if (!validationResult.allowed) {
        const blockedResponse = this.validator.createBlockedResponse(
          rawRequestPayload,
          validationResult.reason || "Blocked by policy"
        );

        result.isBlocked = true;
        result.blockedResponse = blockedResponse;
        result.shouldForward = false;
        valCtx.responsePayload = JSON.stringify(blockedResponse);

        // Report threat asynchronously (non-blocking)
        if (this.tbsToken) {
          this.reportThreatAsync(validationResult, valCtx);
        }
      } else if (validationResult.modified && validationResult.modifiedPayload) {
        result.modifiedPayload = validationResult.modifiedPayload;
        valCtx.requestPayload = validationResult.modifiedPayload;

        // Report threat asynchronously (non-blocking)
        if (this.tbsToken) {
          this.reportThreatAsync(validationResult, valCtx);
        }
      }
    }

    return result;
  }

  /**
   * Process and validate MCP responses
   */
  async processResponse(
    rawResponsePayload: string,
    valCtx: ValidationContext,
    policies: Policy[]
  ): Promise<ProcessResult> {
    const result: ProcessResult = {
      isBlocked: false,
      shouldForward: true,
    };

    if (!rawResponsePayload) {
      return result;
    }

    // Parse JSON to extract structured data
    let responseData: Record<string, any>;
    try {
      responseData = JSON.parse(rawResponsePayload);
      result.parsedData = responseData;
    } catch (error) {
      console.error("[Processor] Failed to parse response JSON:", error);
      return result; // Still allow forwarding for non-JSON payloads
    }

    // Set response payload for validation context
    valCtx.responsePayload = rawResponsePayload;

    if (!this.skipThreat) {
      valCtx.policies = policies;

      const validationResult = await this.validator.validateResponse(
        rawResponsePayload,
        valCtx
      );

      console.log(
        `[MCP] ValidateResponse: allowed=${validationResult.allowed}, modified=${validationResult.modified}, reason=${validationResult.reason}`
      );

      if (!validationResult.allowed) {
        const blockedResponse = this.validator.createBlockedResponse(
          rawResponsePayload,
          validationResult.reason || "Blocked by policy"
        );

        result.isBlocked = true;
        result.blockedResponse = blockedResponse;
        result.shouldForward = false;
        valCtx.responsePayload = JSON.stringify(blockedResponse);

        // Report threat asynchronously (non-blocking)
        if (this.tbsToken) {
          this.reportThreatAsync(validationResult, valCtx);
        }
      } else if (validationResult.modified && validationResult.modifiedPayload) {
        valCtx.responsePayload = validationResult.modifiedPayload;
        result.modifiedPayload = validationResult.modifiedPayload;

        // Report threat asynchronously (non-blocking)
        if (this.tbsToken) {
          this.reportThreatAsync(validationResult, valCtx);
        }
      }
    }

    return result;
  }

  /**
   * Report threat asynchronously (non-blocking)
   * TODO: Eventually move to a queue-based system to avoid impacting API latency
   */
  private reportThreatAsync(
    validationResult: any,
    valCtx: ValidationContext
  ): void {
    const promise = reportThreat(validationResult, valCtx, this.tbsToken).catch((error) => {
      console.error("[MCP] Threat reporting failed:", error);
    });

    // Use waitUntil to ensure the TBS request completes even after response is sent
    // This prevents the worker from terminating before the TBS call finishes
    if (this.executionCtx) {
      this.executionCtx.waitUntil(promise);
    }
  }
}
