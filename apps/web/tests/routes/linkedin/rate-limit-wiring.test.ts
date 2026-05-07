import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROUTES = [
  {
    path: "src/app/api/user/linkedin/bright-data-sync/route.ts",
    feature: "linkedin bright data sync",
    methodArg: "request",
    userLimit: 3,
  },
  {
    path: "src/app/api/user/linkedin/connect/route.ts",
    feature: "linkedin connect",
    methodArg: "request",
    userLimit: 10,
  },
  {
    path: "src/app/api/user/linkedin/disconnect/route.ts",
    feature: "linkedin disconnect",
    methodArg: "request",
    userLimit: 10,
  },
  {
    path: "src/app/api/user/linkedin/sync/route.ts",
    feature: "linkedin sync",
    methodArg: "request",
    userLimit: 5,
  },
  {
    path: "src/app/api/user/linkedin/url/route.ts",
    feature: "linkedin url",
    methodArg: "request",
    userLimit: 10,
  },
];

function readRoute(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

test("LinkedIn mutation and sync routes enforce IP and user rate limits", () => {
  for (const route of ROUTES) {
    const source = readRoute(route.path);

    assert.match(source, /buildRateLimitResponse, checkRateLimit/);
    assert.match(source, new RegExp(`checkRateLimit\\(${route.methodArg}`));
    assert.match(source, new RegExp(`feature: "${route.feature}"`));
    assert.match(source, /limitPerIp: 0/);
    assert.match(source, new RegExp(`limitPerUser: ${route.userLimit}`));
    assert.match(source, /userId: user\.id/);
    assert.match(source, /buildRateLimitResponse\(userRateLimit\)/);
  }
});

test("LinkedIn routes preserve rate-limit headers on handled responses", () => {
  for (const route of ROUTES) {
    const source = readRoute(route.path);

    assert.match(source, /headers: ipRateLimit\.headers/);
    assert.match(source, /headers: userRateLimit\.headers/);
  }
});

test("Bright Data sync applies route limiting before the expensive provider call", () => {
  const source = readRoute("src/app/api/user/linkedin/bright-data-sync/route.ts");

  assert.ok(
    source.indexOf("checkRateLimit(request") < source.indexOf("createServiceClient()"),
    "rate limiting should happen before creating the service client"
  );
  assert.ok(
    source.indexOf("userRateLimit") < source.lastIndexOf("performBrightDataSync"),
    "user rate limiting should happen before Bright Data sync"
  );
});
