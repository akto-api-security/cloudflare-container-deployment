import type { RateLimitConfig } from "../types/mcp";
import { RATE_LIMIT_IDENTIFIER_TYPE } from "../types/mcp";

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  enabled: true,
  limit: 100,
  windowSeconds: 300,
  identifierTypes: [RATE_LIMIT_IDENTIFIER_TYPE.IP, RATE_LIMIT_IDENTIFIER_TYPE.TOOL],
};

/**
 * Get rate limit config with defaults applied
 * If rate limit is not provided in policy, uses DEFAULT_RATE_LIMIT_CONFIG
 * If rate limit is provided but incomplete, fills in missing fields with defaults
 */
export function getRateLimitConfig(
  rateLimit?: Partial<RateLimitConfig>
): RateLimitConfig {
  // If not provided, use default config (rate limiting enabled by default)
  if (!rateLimit) {
    return DEFAULT_RATE_LIMIT_CONFIG;
  }

  // If explicitly disabled, return full config with disabled flag
  if (rateLimit.enabled === false) {
    return {
      ...DEFAULT_RATE_LIMIT_CONFIG,
      ...rateLimit,
      enabled: false,
    };
  }

  // Apply defaults for missing fields
  return {
    enabled: rateLimit.enabled ?? DEFAULT_RATE_LIMIT_CONFIG.enabled,
    limit: rateLimit.limit ?? DEFAULT_RATE_LIMIT_CONFIG.limit,
    windowSeconds: rateLimit.windowSeconds ?? DEFAULT_RATE_LIMIT_CONFIG.windowSeconds,
    identifierTypes: rateLimit.identifierTypes ?? DEFAULT_RATE_LIMIT_CONFIG.identifierTypes,
  };
}
