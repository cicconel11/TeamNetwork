import { z } from "zod";

/** Shared invite fields reused across org and enterprise invite endpoints. */
const baseInviteFieldsSchema = z.object({
  role: z.enum(["admin", "active_member", "alumni", "parent"]),
  expiresAt: z.string().datetime().optional().nullable(),
  requireApproval: z.boolean().optional().nullable(),
});

/** Schema for creating a single org invite (POST /api/organizations/:id/invites). */
export const orgInviteCreateSchema = baseInviteFieldsSchema.extend({
  uses: z.number().int().positive().optional().nullable(),
});

export type OrgInviteCreateForm = z.infer<typeof orgInviteCreateSchema>;

/** Schema for bulk org invite creation (POST /api/organizations/:id/invites/bulk). */
export const orgBulkInviteSchema = baseInviteFieldsSchema.extend({
  emails: z.array(z.string().email()).min(1).max(100),
});

export type OrgBulkInviteForm = z.infer<typeof orgBulkInviteSchema>;
