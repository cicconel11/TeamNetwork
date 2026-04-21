export interface EnterpriseRpcError {
  code?: string | null;
  message?: string | null;
}

export interface EnterpriseOrgLimitInfo {
  currentCount: number;
  maxAllowed: number | null;
  remaining: number | null;
}

export function isEnterpriseOrgLimitRpcError(
  error: EnterpriseRpcError | null | undefined
): boolean {
  if (!error) return false;

  const code = error.code ?? null;
  const message = error.message?.toLowerCase() ?? "";

  if (code === "P0001") {
    return message.includes("org limit");
  }

  if (code === "23514" || code === "check_violation") {
    return message.includes("org limit") || (message.includes("exceed") && message.includes("allowed"));
  }

  return false;
}

export function extractEnterpriseOrgLimitInfo(
  message: string | null | undefined
): EnterpriseOrgLimitInfo | null {
  if (!message) return null;

  const match = message.match(/(\d+)\s+existing\s+\+\s+\d+\s+new\s+>\s+(\d+)\s+allowed/i);
  if (!match) return null;

  const currentCount = Number.parseInt(match[1], 10);
  const maxAllowed = Number.parseInt(match[2], 10);

  if (Number.isNaN(currentCount) || Number.isNaN(maxAllowed)) {
    return null;
  }

  return {
    currentCount,
    maxAllowed,
    remaining: Math.max(0, maxAllowed - currentCount),
  };
}
