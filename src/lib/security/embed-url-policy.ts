const STRIPE_HOST_PATTERN = /(^|\.)stripe\.com$/i;

export function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function isStripeFamilyHost(hostname: string): boolean {
  return STRIPE_HOST_PATTERN.test(hostname);
}

export function canRenderAsIframe(url: string): { ok: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { ok: false, reason: "URL must be a valid https:// URL" };
    }
    if (isStripeFamilyHost(parsed.hostname)) {
      return {
        ok: false,
        reason: "Stripe pages cannot be embedded in iframes due to Stripe security policy. Use Link mode instead.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "URL must be a valid https:// URL" };
  }
}
