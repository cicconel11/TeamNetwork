import { describe, it } from "node:test";
import assert from "node:assert";

/**
 * Route simulation tests for /api/live-activity/unregister
 *
 * Two end-paths:
 *   - { activityId } -> end one
 *   - { deviceId }   -> end every active LA on this device (sign-out path)
 *
 * Both must scope by `user_id = auth.uid()` so a malicious client can't end
 * someone else's LA. We assert that scoping happens in the simulation.
 */

interface ActiveTokenRow {
  activity_id: string;
  user_id: string;
  device_id: string;
  ended_at: string | null;
}

interface UnregisterInput {
  authedUserId: string | null;
  body: { activityId?: string; deviceId?: string } | null;
  store: ActiveTokenRow[];
}

interface UnregisterOutput {
  status: number;
  body: unknown;
  endedActivityIds: string[];
}

function simulateUnregister(input: UnregisterInput): UnregisterOutput {
  if (!input.authedUserId) {
    return {
      status: 401,
      body: { error: "Unauthorized" },
      endedActivityIds: [],
    };
  }
  if (!input.body || (!input.body.activityId && !input.body.deviceId)) {
    return {
      status: 400,
      body: { error: "Provide activityId or deviceId" },
      endedActivityIds: [],
    };
  }

  const matches = input.store.filter((row) => {
    if (row.user_id !== input.authedUserId) return false;
    if (row.ended_at !== null) return false;
    if (input.body!.activityId && row.activity_id !== input.body!.activityId)
      return false;
    if (input.body!.deviceId && row.device_id !== input.body!.deviceId)
      return false;
    return true;
  });

  return {
    status: 200,
    body: { success: true, ended: matches.length },
    endedActivityIds: matches.map((m) => m.activity_id),
  };
}

describe("/api/live-activity/unregister", () => {
  const otherUser = "user-OTHER";
  const me = "user-ME";

  const fixtureStore = (): ActiveTokenRow[] => [
    {
      activity_id: "mine-1",
      user_id: me,
      device_id: "iphone-A",
      ended_at: null,
    },
    {
      activity_id: "mine-2",
      user_id: me,
      device_id: "iphone-A",
      ended_at: null,
    },
    {
      activity_id: "mine-3-other-device",
      user_id: me,
      device_id: "ipad-B",
      ended_at: null,
    },
    {
      activity_id: "someone-else",
      user_id: otherUser,
      device_id: "iphone-A",
      ended_at: null,
    },
  ];

  it("returns 401 for unauthed callers", () => {
    const result = simulateUnregister({
      authedUserId: null,
      body: { activityId: "mine-1" },
      store: fixtureStore(),
    });
    assert.strictEqual(result.status, 401);
  });

  it("requires activityId or deviceId in the body", () => {
    const result = simulateUnregister({
      authedUserId: me,
      body: {},
      store: fixtureStore(),
    });
    assert.strictEqual(result.status, 400);
  });

  it("ends a single activity by activityId scoped to caller", () => {
    const result = simulateUnregister({
      authedUserId: me,
      body: { activityId: "mine-1" },
      store: fixtureStore(),
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.endedActivityIds, ["mine-1"]);
  });

  it("never ends another user's LA even when activityId matches", () => {
    const result = simulateUnregister({
      authedUserId: me,
      body: { activityId: "someone-else" },
      store: fixtureStore(),
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.endedActivityIds, []);
  });

  it("ends every active LA on the device for sign-out path", () => {
    const result = simulateUnregister({
      authedUserId: me,
      body: { deviceId: "iphone-A" },
      store: fixtureStore(),
    });
    assert.strictEqual(result.status, 200);
    assert.deepStrictEqual(result.endedActivityIds.sort(), [
      "mine-1",
      "mine-2",
    ]);
  });
});
