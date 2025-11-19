import type { ValidationContext, ValidationResult, RateLimitIdentifierType } from "../types/mcp";
import { RATE_LIMIT_IDENTIFIER_TYPE } from "../types/mcp";

const RATE_LIMIT_POLICY_CATEGORY = "RateLimitPolicy";

/**
 * RateLimitValidator handles rate limiting for MCP tool calls
 * Uses Cloudflare KV for distributed rate limiting across edge locations
 */
export class RateLimitValidator {
  private kv: KVNamespace;

  constructor(kvNamespace: KVNamespace) {
    this.kv = kvNamespace;
  }

  /**
   * Extract tool name from MCP request
   */
  private extractToolName(requestData: Record<string, any>): string | null {
    const method = requestData.method as string | undefined;
    if (method !== "tools/call") {
      return null; // Rate limiting only applies to tool calls
    }

    const params = requestData.params as Record<string, any> | undefined;
    return (params?.name as string) || null;
  }

  /**
   * Generate rate limit key for KV storage
   * Format: ratelimit:{identifier}
   */
  private getRateLimitKey(identifier: string): string {
    return `ratelimit:${identifier}`;
  }

  /**
   * Check and increment rate limit counter
   * Returns true if request is allowed, false if rate limit exceeded
   */
  private async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; currentCount: number; resetAt: number }> {
    const now = Date.now();

    // Get current rate limit data
    const data = await this.kv.get<{ count: number; resetAt: number }>(key, "json");

    if (!data || now > data.resetAt) {
      // No existing data or window expired - create new window
      const resetAt = now + windowSeconds * 1000;
      await this.kv.put(
        key,
        JSON.stringify({ count: 1, resetAt }),
        { expirationTtl: windowSeconds }
      );

      return {
        allowed: true,
        currentCount: 1,
        resetAt,
      };
    }

    // Check if limit exceeded
    if (data.count >= limit) {
      return {
        allowed: false,
        currentCount: data.count,
        resetAt: data.resetAt,
      };
    }

    // Increment counter
    const newCount = data.count + 1;
    await this.kv.put(
      key,
      JSON.stringify({ count: newCount, resetAt: data.resetAt }),
      { expirationTtl: Math.ceil((data.resetAt - now) / 1000) }
    );

    return {
      allowed: true,
      currentCount: newCount,
      resetAt: data.resetAt,
    };
  }

  /**
   * Validate request against rate limit policy
   * Returns null if no rate limiting needed, otherwise returns validation result
   */
  async validateRequest(
    payload: string,
    valCtx: ValidationContext,
    rateLimitConfig?: {
      enabled: boolean;
      limit: number;
      windowSeconds: number;
      identifierTypes: RateLimitIdentifierType[];
    }
  ): Promise<ValidationResult | null> {
    if (!rateLimitConfig || !rateLimitConfig.enabled) {
      return null;
    }

    let requestData: Record<string, any>;
    try {
      requestData = JSON.parse(payload);
    } catch (error) {
      return null;
    }

    const toolName = this.extractToolName(requestData);
    if (!toolName) {
      return null;
    }

    const identifierParts: string[] = [];

    for (const idType of rateLimitConfig.identifierTypes) {
      switch (idType) {
        case RATE_LIMIT_IDENTIFIER_TYPE.IP:
          identifierParts.push(valCtx.ip || "unknown");
          break;
        case RATE_LIMIT_IDENTIFIER_TYPE.USER:
          identifierParts.push(valCtx.requestHeaders?.["x-user-id"] || valCtx.ip || "unknown");
          break;
        case RATE_LIMIT_IDENTIFIER_TYPE.TOOL:
          identifierParts.push(toolName);
          break;
      }
    }

    const identifier = identifierParts.join(":");
    const key = this.getRateLimitKey(identifier);

    // Check rate limit
    const result = await this.checkRateLimit(
      key,
      rateLimitConfig.limit,
      rateLimitConfig.windowSeconds
    );

    if (!result.allowed) {
      const resetInSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
      console.log(
        `[RateLimitValidator] Rate limit exceeded for ${identifier}:${toolName} ` +
        `(${result.currentCount}/${rateLimitConfig.limit} requests, resets in ${resetInSeconds}s)`
      );

      return {
        allowed: false,
        modified: false,
        reason: `Rate limit exceeded for tool '${toolName}'. Try again in ${resetInSeconds} seconds.`,
        metadata: {
          policy_id: RATE_LIMIT_POLICY_CATEGORY,
          tool_name: toolName,
          current_count: result.currentCount,
          limit: rateLimitConfig.limit,
          reset_at: result.resetAt,
          reset_in_seconds: resetInSeconds,
        },
      };
    }

    console.log(
      `[RateLimitValidator] Request allowed: ${identifier}:${toolName} ` +
      `(${result.currentCount}/${rateLimitConfig.limit} requests)`
    );

    return {
      allowed: true,
      modified: false,
      metadata: {
        rate_limit_current: result.currentCount,
        rate_limit_max: rateLimitConfig.limit,
      },
    };
  }

  /**
   * Get current rate limit status for debugging/monitoring
   */
  async getRateLimitStatus(
    identifier: string
  ): Promise<{ count: number; resetAt: number } | null> {
    const key = this.getRateLimitKey(identifier);
    return await this.kv.get<{ count: number; resetAt: number }>(key, "json");
  }

  /**
   * Reset rate limit for a specific identifier
   */
  async resetRateLimit(identifier: string): Promise<void> {
    const key = this.getRateLimitKey(identifier);
    await this.kv.delete(key);
  }
}
