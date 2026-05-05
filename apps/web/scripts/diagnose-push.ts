/**
 * CLI: bun run apps/web/scripts/diagnose-push.ts <orgId> [audience] [category]
 *
 * Prints a per-recipient table showing which gate (no token / push disabled /
 * category disabled / invalid token) drops each user from a hypothetical push.
 * Use to investigate "members aren't receiving notifications" reports.
 */

import { createClient } from "@supabase/supabase-js";
import { diagnosePush } from "../src/lib/notifications/diagnose";
import type { Database, NotificationAudience } from "../src/types/database";
import type { NotificationCategory } from "../src/lib/notifications";

async function main() {
  const [, , orgId, audienceArg, categoryArg] = process.argv;
  if (!orgId) {
    console.error(
      "Usage: bun run apps/web/scripts/diagnose-push.ts <orgId> [audience=both|members|alumni] [category=announcement|...]",
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const audience = (audienceArg as NotificationAudience | undefined) ?? "both";
  const category = (categoryArg as NotificationCategory | undefined) ?? "announcement";

  const report = await diagnosePush({
    supabase,
    organizationId: orgId,
    audience,
    category,
  });

  console.log(`\nOrg ${orgId}  audience=${audience}  category=${category}`);
  console.log(`Roles in audience: ${report.audienceRoles.join(", ")}`);
  console.log(`Total in audience: ${report.totalInAudience}`);
  console.log(`Would deliver: ${report.delivered}`);
  console.log(`By reason:`);
  for (const [k, v] of Object.entries(report.byReason)) {
    console.log(`  ${k.padEnd(22)} ${v}`);
  }

  console.log(`\nRecipient detail:`);
  console.log(
    "user_id".padEnd(38) +
      "role".padEnd(16) +
      "push".padEnd(10) +
      "category".padEnd(12) +
      "tokens".padEnd(8) +
      "reason",
  );
  for (const r of report.recipients) {
    console.log(
      r.userId.padEnd(38) +
        r.role.padEnd(16) +
        String(r.pushEnabled).padEnd(10) +
        String(r.categoryEnabled).padEnd(12) +
        `${r.validTokenCount}/${r.tokenCount}`.padEnd(8) +
        r.reason,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
