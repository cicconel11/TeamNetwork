const LOCAL_DEVELOPMENT_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function isLocalDevelopmentHostname(
  hostname: string | null | undefined,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (nodeEnv !== "development" || !hostname) {
    return false;
  }

  return LOCAL_DEVELOPMENT_HOSTNAMES.has(hostname);
}

export function shouldAutoRetryCaptchaError(
  errorCode: string,
  isLocalDevelopment: boolean,
): boolean {
  return isLocalDevelopment && errorCode === "network-error";
}

export function getCaptchaErrorMessage(
  errorCode: string,
  isLocalDevelopment: boolean,
): string {
  if (errorCode === "network-error" && isLocalDevelopment) {
    return "Captcha could not reach hCaptcha from localhost. Retrying once. If this keeps failing, add localhost to the hCaptcha site key allowlist.";
  }

  if (errorCode === "network-error") {
    return "Captcha could not reach hCaptcha. Check your connection and try again.";
  }

  return `Captcha error: ${errorCode}`;
}
