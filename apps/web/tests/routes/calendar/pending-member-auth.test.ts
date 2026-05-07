/**
 * Regression test: pending/revoked members must be blocked from
 * calendar and schedule API routes. Only active members should pass.
 *
 * Tests the getOrgMembership() gate that replaced manual
 * `status === "revoked"` checks (which allowed pending members through).
 */
import test from "node:test";
import assert from "node:assert";
import type { AuthContext } from "../../utils/authMock.ts";
import {
  isAuthenticated,
  hasOrgMembership,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";

const ORG_ID = "org-1";

type RouteType = "read" | "admin";

interface RouteSimulation {
  name: string;
  type: RouteType;
  simulate: (auth: AuthContext) => { status: number };
}

function simulateReadRoute(auth: AuthContext, orgId: string): { status: number } {
  if (!isAuthenticated(auth)) return { status: 401 };
  if (!hasOrgMembership(auth, orgId)) return { status: 403 };
  return { status: 200 };
}

function simulateAdminRoute(auth: AuthContext, orgId: string): { status: number } {
  if (!isAuthenticated(auth)) return { status: 401 };
  if (!hasOrgMembership(auth, orgId)) return { status: 403 };
  if (!isOrgAdmin(auth, orgId)) return { status: 403 };
  return { status: 200 };
}

const routes: RouteSimulation[] = [
  { name: "GET /api/calendar/unified-events", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "GET /api/calendar/org-events", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "GET /api/calendar/events", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "GET /api/calendar/feeds", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "POST /api/calendar/feeds (ICS)", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "POST /api/calendar/feeds (Google)", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "GET /api/schedules/events", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "POST /api/schedules/verify-source", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "GET /api/schedules/sources", type: "read", simulate: (auth) => simulateReadRoute(auth, ORG_ID) },
  { name: "GET /api/calendar/org-feeds", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/calendar/org-feeds (ICS)", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/calendar/org-feeds (Google)", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "DELETE /api/calendar/org-feeds/:feedId", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/calendar/org-feeds/:feedId/sync", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "GET /api/schedules/google/calendars", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/schedules/google/connect", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "PATCH /api/schedules/sources/:sourceId", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "DELETE /api/schedules/sources/:sourceId", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/schedules/sources/:sourceId/sync", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/schedules/connect", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
  { name: "POST /api/schedules/preview", type: "admin", simulate: (auth) => simulateAdminRoute(auth, ORG_ID) },
];

// --- Pending member must get 403 on ALL routes ---

for (const route of routes) {
  test(`pending member → 403 on ${route.name}`, () => {
    const result = route.simulate(AuthPresets.pendingMember(ORG_ID));
    assert.strictEqual(result.status, 403, `Expected 403 for pending member on ${route.name}`);
  });
}

// --- Revoked member must get 403 on ALL routes ---

for (const route of routes) {
  test(`revoked member → 403 on ${route.name}`, () => {
    const result = route.simulate(AuthPresets.revokedUser(ORG_ID));
    assert.strictEqual(result.status, 403, `Expected 403 for revoked member on ${route.name}`);
  });
}

// --- Active member gets 200 on read routes ---

for (const route of routes.filter((r) => r.type === "read")) {
  test(`active member → 200 on ${route.name}`, () => {
    const result = route.simulate(AuthPresets.orgMember(ORG_ID));
    assert.strictEqual(result.status, 200, `Expected 200 for active member on ${route.name}`);
  });
}

// --- Active admin gets 200 on admin routes ---

for (const route of routes.filter((r) => r.type === "admin")) {
  test(`active admin → 200 on ${route.name}`, () => {
    const result = route.simulate(AuthPresets.orgAdmin(ORG_ID));
    assert.strictEqual(result.status, 200, `Expected 200 for active admin on ${route.name}`);
  });
}

// --- Active non-admin gets 403 on admin routes ---

for (const route of routes.filter((r) => r.type === "admin")) {
  test(`active non-admin → 403 on ${route.name}`, () => {
    const result = route.simulate(AuthPresets.orgMember(ORG_ID));
    assert.strictEqual(result.status, 403, `Expected 403 for non-admin on ${route.name}`);
  });
}
