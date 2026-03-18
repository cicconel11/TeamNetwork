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
  "cron",
  "linkedin-enrich",
  "route.ts",
);

const routeSource = fs.readFileSync(routePath, "utf8");

test("cron route has per-user try/catch inside the for loop", () => {
  // Extract the for loop body
  const forIdx = routeSource.indexOf("for (const conn of eligible)");
  assert.ok(forIdx > -1, "expected for loop over eligible connections");

  const loopBody = routeSource.slice(forIdx);
  const tryIdx = loopBody.indexOf("try {");
  const catchIdx = loopBody.indexOf("catch (err)");
  assert.ok(tryIdx > -1, "expected try block inside for loop");
  assert.ok(catchIdx > -1, "expected catch block inside for loop");
  assert.ok(tryIdx < catchIdx, "try must come before catch");
});

test("cron route: getLinkedInUrlForUser is inside the per-user try block", () => {
  const forIdx = routeSource.indexOf("for (const conn of eligible)");
  const loopBody = routeSource.slice(forIdx);
  const tryIdx = loopBody.indexOf("try {");
  const urlCallIdx = loopBody.indexOf("getLinkedInUrlForUser");
  const catchIdx = loopBody.indexOf("catch (err)");

  assert.ok(urlCallIdx > tryIdx, "getLinkedInUrlForUser must be inside try block");
  assert.ok(urlCallIdx < catchIdx, "getLinkedInUrlForUser must be before catch block");
});

test("cron route: catch block increments failed counter and pushes error", () => {
  const forIdx = routeSource.indexOf("for (const conn of eligible)");
  const loopBody = routeSource.slice(forIdx);
  const catchBlock = loopBody.slice(loopBody.indexOf("catch (err)"));

  assert.match(catchBlock, /failed\+\+/, "catch block should increment failed counter");
  assert.match(catchBlock, /errors\.push/, "catch block should push error message");
});

test("cron route: catch block logs per-user error with userId", () => {
  const forIdx = routeSource.indexOf("for (const conn of eligible)");
  const loopBody = routeSource.slice(forIdx);
  const catchBlock = loopBody.slice(loopBody.indexOf("catch (err)"));

  assert.match(
    catchBlock,
    /console\.error.*Per-user error/,
    "catch block should log per-user error",
  );
  assert.match(
    catchBlock,
    /\$\{userId\}/,
    "catch block should include userId in log message",
  );
});
