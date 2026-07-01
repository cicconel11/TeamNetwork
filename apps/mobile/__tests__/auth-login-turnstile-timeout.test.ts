import { readFileSync } from "node:fs";
import { join } from "node:path";

const loginSource = readFileSync(
  join(process.cwd(), "app/(auth)/login.tsx"),
  "utf8",
);

describe("login Turnstile timeout", () => {
  it("does not leave password sign-in loading forever if captcha never responds", () => {
    expect(loginSource).toContain("const CAPTCHA_LOAD_TIMEOUT_MS = 15_000");
    expect(loginSource).toContain('handleCaptchaError("captcha load timeout")');
  });

  it("clears the captcha timeout when verification, cancellation, or errors finish the flow", () => {
    expect(loginSource).toMatch(
      /const handleCaptchaVerify = async \(captchaToken: string\) => \{\s*clearCaptchaTimeout\(\);/,
    );
    expect(loginSource).toMatch(
      /const handleCaptchaCancel = \(\) => \{\s*clearCaptchaTimeout\(\);/,
    );
    expect(loginSource).toMatch(
      /const handleCaptchaError = \(message: string\) => \{\s*clearCaptchaTimeout\(\);/,
    );
  });
});
