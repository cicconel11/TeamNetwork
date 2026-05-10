import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PendingActionCard } from "../../src/components/ai-assistant/PendingActionCard.tsx";
import type { PendingActionState } from "../../src/components/ai-assistant/panel-state.ts";

function buildAction(overrides: Partial<PendingActionState> = {}): PendingActionState {
  return {
    actionId: "act-1",
    actionType: "member_role_change",
    summary: { title: "Change member role", description: "Promote Alice to admin" },
    payload: { target_display_name: "Alice", new_role: "admin" },
    previousPayload: null,
    reviseCount: 0,
    expiresAt: "2099-01-01T00:00:00.000Z",
    status: "pending",
    errorMessage: null,
    ...overrides,
  };
}

test("PendingActionCard: pending status shows confirm + cancel, no failed banner", () => {
  const html = renderToStaticMarkup(
    React.createElement(PendingActionCard, {
      action: buildAction(),
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );

  assert.equal(html.includes("Confirm"), true);
  assert.equal(html.includes("Cancel"), true);
  assert.equal(html.includes("pending-action-failed-banner"), false);
  assert.equal(html.includes("This action could not be completed."), false);
});

test("PendingActionCard: failed status renders banner with errorMessage and hides buttons", () => {
  const action = buildAction({
    status: "failed",
    errorMessage: "Only active admins can change member roles.",
  });

  const html = renderToStaticMarkup(
    React.createElement(PendingActionCard, {
      action,
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );

  assert.equal(html.includes("pending-action-failed-banner"), true);
  assert.equal(html.includes("This action could not be completed."), true);
  assert.equal(html.includes("Only active admins can change member roles."), true);
  assert.equal(html.includes(">Confirm<"), false, "confirm button must be hidden when failed");
  assert.equal(html.includes(">Cancel<"), false, "cancel button must be hidden when failed");
});

test("PendingActionCard: failed status without errorMessage still renders banner header", () => {
  const action = buildAction({ status: "failed", errorMessage: null });

  const html = renderToStaticMarkup(
    React.createElement(PendingActionCard, {
      action,
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );

  assert.equal(html.includes("pending-action-failed-banner"), true);
  assert.equal(html.includes("This action could not be completed."), true);
});

test("PendingActionCard: pending status with transient error prop still shows buttons", () => {
  const html = renderToStaticMarkup(
    React.createElement(PendingActionCard, {
      action: buildAction(),
      error: "Could not update member role. Please try again.",
      onConfirm: () => {},
      onCancel: () => {},
    }),
  );

  assert.equal(html.includes("Could not update member role. Please try again."), true);
  assert.equal(html.includes("pending-action-failed-banner"), false);
  assert.equal(html.includes(">Confirm<"), true);
});
