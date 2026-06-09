import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Contract test for the fix to two critical privilege-escalation vulnerabilities:
//   1. Self-service membership escalation on public.user_organization_roles
//      (self-grant admin in any org / self-approve pending / move row to another org).
//   2. Anon/authenticated-executable SECURITY DEFINER cross-tenant write RPCs.
//
// These assertions encode the security invariants so the protection cannot be
// silently weakened or dropped in a future migration edit.

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20261218000000_fix_membership_privilege_escalation.sql",
    import.meta.url
  ),
  "utf8"
);

describe("membership privilege-escalation fix — migration contract", () => {
  describe("Part 1: user_organization_roles self-service guard", () => {
    it("defines the guard as a SECURITY INVOKER function with a locked search_path", () => {
      assert.match(
        migration,
        /create or replace function public\.enforce_user_org_role_self_service\(\)/i
      );
      // SECURITY INVOKER is load-bearing: current_user must reflect the firing
      // role. SECURITY DEFINER would silently disable the guard. Assert the
      // function declaration itself (not the surrounding prose) is INVOKER.
      assert.match(
        migration,
        /returns trigger\s+language plpgsql\s+security invoker\s+set search_path = ''/i
      );
    });

    it("wires the guard as a BEFORE INSERT OR UPDATE row trigger on the table", () => {
      assert.match(
        migration,
        /create trigger enforce_user_org_role_self_service\s+before insert or update on public\.user_organization_roles\s+for each row execute function public\.enforce_user_org_role_self_service\(\)/i
      );
    });

    it("only restricts direct end-user (authenticated/anon) writes, exempting service-role and definer RPCs", () => {
      assert.match(
        migration,
        /current_user not in \('authenticated', 'anon'\)\s*then\s*return new/i
      );
    });

    it("lets org admins continue managing memberships in their own org", () => {
      assert.match(migration, /public\.is_org_admin\(new\.organization_id\)\s*then\s*return new/i);
    });

    it("blocks a user from modifying another user's membership row", () => {
      assert.match(
        migration,
        /new\.user_id <> v_uid[\s\S]*?raise exception 'not authorized to modify membership for another user'/i
      );
    });

    it("blocks self-granting an elevated or active membership on INSERT", () => {
      assert.match(
        migration,
        /new\.role::text = 'admin' or new\.status::text <> 'pending'[\s\S]*?raise exception 'cannot self-grant elevated or active membership'/i
      );
    });

    it("blocks moving a membership row to another org or user on UPDATE", () => {
      assert.match(
        migration,
        /new\.organization_id <> old\.organization_id or new\.user_id <> old\.user_id[\s\S]*?raise exception 'cannot move your membership to another org or user'/i
      );
    });

    it("blocks a user changing their own role on UPDATE", () => {
      assert.match(
        migration,
        /new\.role::text <> old\.role::text[\s\S]*?raise exception 'cannot change your own role'/i
      );
    });

    it("blocks self-approval but still allows leaving (-> revoked)", () => {
      assert.match(
        migration,
        /new\.status::text <> old\.status::text and new\.status::text <> 'revoked'[\s\S]*?raise exception 'cannot self-approve membership; admin approval required'/i
      );
    });

    it("grants execute on the guard to firing roles (required for an INVOKER trigger)", () => {
      assert.match(
        migration,
        /grant execute on function public\.enforce_user_org_role_self_service\(\) to authenticated, anon/i
      );
    });
  });

  describe("Part 2: anon/authenticated cannot execute cross-tenant write RPCs", () => {
    const fns: Array<[string, string]> = [
      ["bulk_import_linkedin_alumni", "uuid, jsonb, boolean"],
      [
        "enrich_alumni_by_id",
        "uuid, uuid, text, text, text, text, text, text, text, text, jsonb, jsonb, text, text, jsonb, jsonb, jsonb",
      ],
      ["save_user_linkedin_url", "uuid, text"],
    ];

    for (const [fn, args] of fns) {
      it(`revokes execute on ${fn} from public, anon and authenticated`, () => {
        const escaped = args.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Must include PUBLIC — anon/authenticated inherit the default PUBLIC grant.
        const re = new RegExp(
          `revoke execute on function public\\.${fn}\\(${escaped}\\) from public, anon, authenticated`,
          "i"
        );
        assert.match(migration, re);
      });

      it(`keeps ${fn} executable by service_role`, () => {
        const escaped = args.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          `grant execute on function public\\.${fn}\\(${escaped}\\) to service_role`,
          "i"
        );
        assert.match(migration, re);
      });
    }
  });
});
