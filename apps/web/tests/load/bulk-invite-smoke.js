import http from "k6/http";
import { check, sleep } from "k6";

/**
 * k6 load test for the org bulk invite endpoint.
 *
 * Usage:
 *   k6 run -e BASE_URL=https://staging.teamnetwork.app \
 *          -e AUTH_TOKEN=<jwt> \
 *          -e ORG_ID=<uuid> \
 *          tests/load/bulk-invite-smoke.js
 */

export const options = {
  vus: 5,
  iterations: 50, // 5 VUs × 10 iterations each
  thresholds: {
    http_req_duration: ["p(95)<2000"],
    http_req_failed: ["rate<0.01"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const AUTH_TOKEN = __ENV.AUTH_TOKEN || "";
const ORG_ID = __ENV.ORG_ID || "";

// eslint-disable-next-line import/no-anonymous-default-export
export default function () {
  const emails = Array.from({ length: 5 }, (_, i) =>
    `loadtest+${Date.now()}-${__VU}-${__ITER}-${i}@example.com`
  );

  const payload = JSON.stringify({
    emails,
    role: "active_member",
  });

  const headers = {
    "Content-Type": "application/json",
    ...(AUTH_TOKEN ? { Cookie: `sb-access-token=${AUTH_TOKEN}` } : {}),
  };

  const res = http.post(
    `${BASE_URL}/api/organizations/${ORG_ID}/invites/bulk`,
    payload,
    { headers }
  );

  check(res, {
    "status is 200": (r) => r.status === 200,
    "response has summary": (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.summary && typeof body.summary.total === "number";
      } catch {
        return false;
      }
    },
  });

  sleep(0.5);
}
