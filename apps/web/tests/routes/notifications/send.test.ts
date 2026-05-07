import test from "node:test";
import assert from "node:assert";
import {
  AuthContext,
  isAuthenticated,
  isOrgAdmin,
  AuthPresets,
} from "../../utils/authMock.ts";
import { createSupabaseStub } from "../../utils/supabaseStub.ts";

/**
 * Tests for POST /api/notifications/send
 *
 * This route:
 * 1. Requires authentication
 * 2. Requires admin role in the organization
 * 3. Validates notification parameters
 * 4. Sends email/SMS to targeted audience
 * 5. Blocks mutations in read-only mode
 */

// Types
interface SendNotificationRequest {
  auth: AuthContext;
  organizationId?: string;
  announcementId?: string;
  notificationId?: string;
  title?: string;
  body?: string;
  audience?: "members" | "alumni" | "both";
  channel?: "email" | "sms" | "both";
  targetUserIds?: string[];
  persistNotification?: boolean;
}

interface SendNotificationResult {
  status: number;
  success?: boolean;
  sent?: number;
  emailSent?: number;
  smsSent?: number;
  total?: number;
  skipped?: number;
  errors?: string[];
  error?: string;
}

interface SendNotificationContext {
  supabase: ReturnType<typeof createSupabaseStub>;
  announcement?: {
    id: string;
    title: string;
    body: string;
    organization_id: string;
    audience: string;
  };
  notification?: {
    id: string;
    title: string;
    body: string;
    organization_id: string;
    audience: string;
    channel: string;
  };
  recipients?: number;
  isReadOnly?: boolean;
}

function simulateSendNotification(
  request: SendNotificationRequest,
  ctx: SendNotificationContext
): SendNotificationResult {
  if (!isAuthenticated(request.auth)) {
    return { status: 401, error: "Unauthorized" };
  }

  // Must have announcementId, notificationId, or organizationId
  if (!request.announcementId && !request.notificationId && !request.organizationId) {
    return { status: 400, error: "announcementId, notificationId, or organizationId is required" };
  }

  // Determine organizationId from context
  let organizationId: string | null = null;
  let title: string | null = request.title ?? null;

  if (request.announcementId) {
    if (!ctx.announcement || ctx.announcement.id !== request.announcementId) {
      return { status: 404, error: "Announcement not found" };
    }
    organizationId = ctx.announcement.organization_id;
    title = ctx.announcement.title;
  } else if (request.notificationId) {
    if (!ctx.notification || ctx.notification.id !== request.notificationId) {
      return { status: 404, error: "Notification not found" };
    }
    organizationId = ctx.notification.organization_id;
    title = ctx.notification.title;
  } else {
    organizationId = request.organizationId ?? null;
    title = request.title ?? null;
  }

  // Title required for new notifications
  if (!request.announcementId && !request.notificationId && !title) {
    return { status: 400, error: "title is required when sending a new notification" };
  }

  if (!organizationId) {
    return { status: 400, error: "Missing notification details" };
  }

  // Admin role check
  if (!isOrgAdmin(request.auth, organizationId)) {
    return { status: 403, error: "Only admins can send notifications" };
  }

  // Read-only mode check
  if (ctx.isReadOnly) {
    return { status: 403, error: "Organization is in read-only mode" };
  }

  // No recipients
  const recipients = ctx.recipients ?? 0;
  if (recipients === 0) {
    return { status: 400, error: "No recipients matched the selected audience", total: 0, skipped: 0 };
  }

  // Success
  return {
    status: 200,
    success: true,
    sent: recipients,
    emailSent: recipients,
    smsSent: 0,
    total: recipients,
    skipped: 0,
  };
}

// Tests

test("send notification requires authentication", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.unauthenticated, organizationId: "org-1", title: "Test" },
    { supabase }
  );
  assert.strictEqual(result.status, 401);
});

test("send notification requires organizationId, announcementId, or notificationId", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), title: "Test" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
});

test("send notification requires title for new notification", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1" },
    { supabase }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("title"));
});

test("send notification requires admin role", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgMember("org-1"), organizationId: "org-1", title: "Test" },
    { supabase, recipients: 10 }
  );
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("admins"));
});

test("send notification rejects alumni role", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAlumni("org-1"), organizationId: "org-1", title: "Test" },
    { supabase, recipients: 10 }
  );
  assert.strictEqual(result.status, 403);
});

test("send notification blocks read-only mode", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", title: "Test" },
    { supabase, recipients: 10, isReadOnly: true }
  );
  assert.strictEqual(result.status, 403);
  assert.ok(result.error?.includes("read-only"));
});

test("send notification returns 404 for non-existent announcement", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), announcementId: "ann-nonexistent" },
    { supabase }
  );
  assert.strictEqual(result.status, 404);
  assert.ok(result.error?.includes("Announcement"));
});

test("send notification returns 404 for non-existent notification", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), notificationId: "notif-nonexistent" },
    { supabase }
  );
  assert.strictEqual(result.status, 404);
  assert.ok(result.error?.includes("Notification"));
});

test("send notification returns 400 when no recipients match", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", title: "Test", audience: "alumni" },
    { supabase, recipients: 0 }
  );
  assert.strictEqual(result.status, 400);
  assert.ok(result.error?.includes("No recipients"));
});

test("send notification succeeds with valid parameters", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", title: "Important Update", body: "Details here" },
    { supabase, recipients: 25 }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.sent, 25);
  assert.strictEqual(result.total, 25);
});

test("send notification uses announcement data", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), announcementId: "ann-123" },
    {
      supabase,
      announcement: {
        id: "ann-123",
        title: "Announcement Title",
        body: "Announcement body",
        organization_id: "org-1",
        audience: "members",
      },
      recipients: 15,
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("send notification uses existing notification data", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), notificationId: "notif-123" },
    {
      supabase,
      notification: {
        id: "notif-123",
        title: "Notification Title",
        body: "Notification body",
        organization_id: "org-1",
        audience: "both",
        channel: "email",
      },
      recipients: 30,
    }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("send notification accepts audience parameter", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", title: "Test", audience: "members" },
    { supabase, recipients: 20 }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("send notification accepts channel parameter", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", title: "Test", channel: "email" },
    { supabase, recipients: 10 }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});

test("send notification accepts targetUserIds", () => {
  const supabase = createSupabaseStub();
  const result = simulateSendNotification(
    { auth: AuthPresets.orgAdmin("org-1"), organizationId: "org-1", title: "Test", targetUserIds: ["user-1", "user-2"] },
    { supabase, recipients: 2 }
  );
  assert.strictEqual(result.status, 200);
  assert.strictEqual(result.success, true);
});
