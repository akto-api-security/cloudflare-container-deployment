import type { ValidationResult, Policy, FilterRule } from "../types/mcp";

/**
 * PII detection patterns
 */
const PII_PATTERNS: Record<string, RegExp> = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  password: /\b(password|passwd|pwd)[\s:=]+[^\s]+/gi,
  api_key: /\b(api[_-]?key|apikey|access[_-]?token)[\s:=]+[^\s]+/gi,
  url: /\bhttps?:\/\/[^\s]+/gi,
};

/**
 * Validator for PII filtering rules
 */
export class PIIValidator {
  /**
   * Get regex pattern for PII type
   */
  private getPIIRegex(piiType: string): RegExp | null {
    const piiTypeKey = piiType.toLowerCase();
    return PII_PATTERNS[piiTypeKey] || null;
  }

  /**
   * Validate text against PII filtering rule
   */
  validate(
    text: string,
    rule: FilterRule,
    policy: Policy
  ): ValidationResult {
    if (!rule.pattern) {
      return { allowed: true, modified: false };
    }

    const piiType = rule.pattern; // pattern field contains PII type (e.g., "phone", "email")
    const piiRegex = this.getPIIRegex(piiType);

    if (!piiRegex) {
      console.warn(`[PIIValidator] Unknown PII type: ${piiType}`);
      return { allowed: true, modified: false };
    }

    const match = piiRegex.test(text);

    if (match) {
      const action = rule.action || "block";

      if (action === "block") {
        console.log(`[PIIValidator] PII detected (blocking): ${piiType}`);
        return {
          allowed: false,
          modified: false,
          reason: `Blocked due to PII detection: ${piiType}`,
          metadata: {
            policy_id: policy.id,
            rule_type: "pii",
            pii_type: piiType,
          },
        };
      } else if (action === "redact") {
        // Mask/redact PII
        const redactedText = text.replace(piiRegex, `[${piiType.toUpperCase()}_REDACTED]`);
        console.log(`[PIIValidator] PII detected (redacting): ${piiType}`);
        return {
          allowed: true,
          modified: true,
          modifiedPayload: redactedText,
        };
      }
    }

    return { allowed: true, modified: false };
  }
}
