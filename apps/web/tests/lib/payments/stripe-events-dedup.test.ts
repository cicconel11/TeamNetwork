import test from "node:test";
import assert from "node:assert";
import { registerStripeEvent } from "../../../src/lib/payments/stripe-events.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

test("first insert succeeds and returns alreadyProcessed: false", async () => {
  const supabase = createSupabaseStub();

  const result = await registerStripeEvent({
    supabase: supabase as never,
    eventId: "evt_fresh",
    type: "invoice.paid",
  });

  assert.strictEqual(result.alreadyProcessed, false);
  assert.ok(result.eventRow, "eventRow should be present");
  assert.strictEqual(result.eventRow.event_id, "evt_fresh");
});

test("unique violation with processed_at set returns alreadyProcessed: true", async () => {
  const supabase = createSupabaseStub();

  // Seed a fully-processed event
  supabase.seed("stripe_events", [
    {
      event_id: "evt_done",
      type: "invoice.paid",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      processed_at: new Date().toISOString(),
    },
  ]);

  // Attempt to insert same event_id — triggers unique violation
  const result = await registerStripeEvent({
    supabase: supabase as never,
    eventId: "evt_done",
    type: "invoice.paid",
  });

  assert.strictEqual(result.alreadyProcessed, true, "already fully processed — must skip");
});

test("unique violation with no processed_at and RPC returns empty array returns alreadyProcessed: true (active lease)", async () => {
  const supabase = createSupabaseStub();

  // Seed an event with no processed_at — another worker holds the lease
  supabase.seed("stripe_events", [
    {
      event_id: "evt_active_lease",
      type: "invoice.paid",
      created_at: new Date().toISOString(),
      processed_at: null,
    },
  ]);

  // RPC returns empty array — lease is still active
  supabase.registerRpc("claim_stale_stripe_event", () => []);

  const result = await registerStripeEvent({
    supabase: supabase as never,
    eventId: "evt_active_lease",
    type: "invoice.paid",
  });

  assert.strictEqual(
    result.alreadyProcessed,
    true,
    "active lease (RPC returned empty) — another worker is processing, must skip",
  );
});

test("unique violation with no processed_at and RPC returns row returns alreadyProcessed: false (crash recovery)", async () => {
  const supabase = createSupabaseStub();

  const seededEvent = {
    event_id: "evt_stale_lease",
    type: "invoice.paid",
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    processed_at: null,
  };

  // Seed an event inserted 10 minutes ago with no processed_at — original worker crashed
  supabase.seed("stripe_events", [seededEvent]);

  // RPC returns the claimed row — stale lease successfully claimed
  supabase.registerRpc("claim_stale_stripe_event", () => [seededEvent]);

  const result = await registerStripeEvent({
    supabase: supabase as never,
    eventId: "evt_stale_lease",
    type: "invoice.paid",
  });

  assert.strictEqual(
    result.alreadyProcessed,
    false,
    "stale lease claimed by RPC — original worker crashed, allow re-processing",
  );
  assert.ok(result.eventRow, "eventRow should be present for crash recovery");
});

test("secondary SELECT error after unique violation is thrown", async () => {
  const insertError = { code: "23505", message: "duplicate key value" };
  const selectError = { code: "57P03", message: "cannot connect to server" };

  // Hand-crafted stub: insert triggers 23505, subsequent SELECT also errors
  const fakeSupabase = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => ({ data: null, error: insertError }),
        }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => ({ data: null, error: selectError }),
        }),
      }),
    }),
  };

  await assert.rejects(
    () =>
      registerStripeEvent({
        supabase: fakeSupabase as never,
        eventId: "evt_select_error",
        type: "invoice.paid",
      }),
    (err: unknown) => {
      assert.deepStrictEqual(err, selectError, "selectError should be thrown");
      return true;
    },
    "secondary SELECT error must propagate",
  );
});

test("RPC claim error is thrown", async () => {
  const supabase = createSupabaseStub();

  supabase.seed("stripe_events", [
    {
      event_id: "evt_rpc_error",
      type: "invoice.paid",
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      processed_at: null,
    },
  ]);

  const rpcError = new Error("RPC function unavailable");
  supabase.registerRpc("claim_stale_stripe_event", () => {
    throw rpcError;
  });

  await assert.rejects(
    () =>
      registerStripeEvent({
        supabase: supabase as never,
        eventId: "evt_rpc_error",
        type: "invoice.paid",
      }),
    (err: unknown) => {
      assert.ok(
        err instanceof Object && "message" in (err as object) &&
          (err as { message: string }).message === "RPC function unavailable",
        "RPC error should propagate",
      );
      return true;
    },
    "RPC claim error must propagate",
  );
});

test("non-unique DB errors are re-thrown", async () => {
  // Build a minimal stub that returns a non-23505 insert error
  const dbError = { code: "42P01", message: "relation does not exist" };
  const fakeSupabase = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => ({ data: null, error: dbError }),
        }),
      }),
    }),
  };

  await assert.rejects(
    () =>
      registerStripeEvent({
        supabase: fakeSupabase as never,
        eventId: "evt_db_error",
        type: "invoice.paid",
      }),
    (err: unknown) => {
      assert.deepStrictEqual(err, dbError, "original error object should be re-thrown");
      return true;
    },
    "non-unique DB errors must propagate",
  );
});
