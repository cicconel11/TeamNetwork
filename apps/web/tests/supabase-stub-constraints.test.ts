import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseStub } from "./utils/supabaseStub.ts";

const MESSAGE_A = "00000000-0000-4000-8000-000000000001";
const MESSAGE_B = "00000000-0000-4000-8000-000000000002";
const USER_A = "00000000-0000-4000-8000-000000000101";
const USER_B = "00000000-0000-4000-8000-000000000102";

test("supabaseStub enforces composite unique key for chat_poll_votes", async () => {
  const stub = createSupabaseStub();

  const first = await stub
    .from("chat_poll_votes")
    .insert({ message_id: MESSAGE_A, user_id: USER_A, option_index: 1 });
  assert.equal(first.error, null);

  const duplicate = await stub
    .from("chat_poll_votes")
    .insert({ message_id: MESSAGE_A, user_id: USER_A, option_index: 2 });
  assert.equal(duplicate.error?.code, "23505");

  const differentMessage = await stub
    .from("chat_poll_votes")
    .insert({ message_id: MESSAGE_B, user_id: USER_A, option_index: 0 });
  assert.equal(differentMessage.error, null);

  const differentUser = await stub
    .from("chat_poll_votes")
    .insert({ message_id: MESSAGE_A, user_id: USER_B, option_index: 0 });
  assert.equal(differentUser.error, null);
});

test("supabaseStub enforces composite unique key for chat_form_responses", async () => {
  const stub = createSupabaseStub();

  const first = await stub
    .from("chat_form_responses")
    .insert({ message_id: MESSAGE_A, user_id: USER_A, responses: { q1: "yes" } });
  assert.equal(first.error, null);

  const duplicate = await stub
    .from("chat_form_responses")
    .insert({ message_id: MESSAGE_A, user_id: USER_A, responses: { q1: "no" } });
  assert.equal(duplicate.error?.code, "23505");

  const differentMessage = await stub
    .from("chat_form_responses")
    .insert({ message_id: MESSAGE_B, user_id: USER_A, responses: { q1: "ok" } });
  assert.equal(differentMessage.error, null);
});
