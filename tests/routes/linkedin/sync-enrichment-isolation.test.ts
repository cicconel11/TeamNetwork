import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const routePath = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "src",
  "app",
  "api",
  "user",
  "linkedin",
  "sync",
  "route.ts",
);

const routeSource = fs.readFileSync(routePath, "utf8");

test("sync route wraps enrichment block in its own try/catch", () => {
  const enrichBlock = routeSource.slice(
    routeSource.indexOf("Best-effort enrichment"),
  );
  assert.ok(enrichBlock.length > 0, "expected 'Best-effort enrichment' comment");

  const catchIdx = enrichBlock.indexOf("catch (enrichErr)");
  assert.ok(catchIdx > -1, "expected a dedicated catch for enrichment errors");
});

test("sync route: enrichment failure does not prevent 200 response", () => {
  // After the catch (enrichErr) block, there should be a return with success
  const catchIdx = routeSource.indexOf("catch (enrichErr)");
  assert.ok(catchIdx > -1, "expected enrichment catch block");

  // The code after the catch block should still return a success response
  const afterCatch = routeSource.slice(catchIdx);
  const nextReturnIdx = afterCatch.indexOf("return NextResponse.json");
  assert.ok(nextReturnIdx > -1, "expected a return statement after enrichment catch");

  // That return should NOT be a 500 error — it should be the normal sync success
  const returnBlock = afterCatch.slice(nextReturnIdx, nextReturnIdx + 80);
  assert.match(
    returnBlock,
    /LinkedIn profile synced/,
    "return after enrichment catch should be a success message, not a 500",
  );
});

test("sync route: getLinkedInUrlForUser is inside enrichment try block", () => {
  // The getLinkedInUrlForUser call should appear after the try { and before catch (enrichErr)
  const tryIdx = routeSource.indexOf("// Best-effort enrichment");
  const block = routeSource.slice(tryIdx);
  const urlCallIdx = block.indexOf("getLinkedInUrlForUser");
  const catchIdx = block.indexOf("catch (enrichErr)");
  assert.ok(urlCallIdx > -1, "expected getLinkedInUrlForUser in enrichment block");
  assert.ok(catchIdx > -1, "expected catch (enrichErr) block");
  assert.ok(
    urlCallIdx < catchIdx,
    "getLinkedInUrlForUser must be inside the try block before catch",
  );
});
