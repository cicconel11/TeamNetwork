import test from "node:test";
import assert from "node:assert";
import {
  deriveNameFromEmail,
  getLinkedInImportCapacitySnapshot,
  planLinkedInImport,
} from "@/lib/alumni/linkedin-import";

test("deriveNameFromEmail keeps first and last token for multi-part email prefixes", () => {
  const result = deriveNameFromEmail("mary.jane.watson@example.com");

  assert.deepStrictEqual(result, {
    first_name: "Mary",
    last_name: "Watson",
  });
});

test("planLinkedInImport dedupes duplicate unmatched emails case-insensitively", () => {
  const result = planLinkedInImport({
    rows: [
      { email: "Alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice-1" },
      { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice-2" },
    ],
    overwrite: false,
    dryRun: true,
    alumniByEmail: new Map(),
    remainingCapacity: 5,
  });

  assert.strictEqual(result.toCreate.length, 1);
  assert.strictEqual(result.quotaBlocked, 0);
  assert.deepStrictEqual(result.toCreate.map((row) => row.email), ["alice@example.com"]);
});

test("planLinkedInImport does not spend quota twice on duplicate overflow rows", () => {
  const result = planLinkedInImport({
    rows: [
      { email: "new.person@example.com", linkedin_url: "https://www.linkedin.com/in/new-person" },
      { email: "NEW.PERSON@example.com", linkedin_url: "https://www.linkedin.com/in/new-person-2" },
      { email: "other.person@example.com", linkedin_url: "https://www.linkedin.com/in/other-person" },
    ],
    overwrite: false,
    dryRun: true,
    alumniByEmail: new Map(),
    remainingCapacity: 1,
  });

  assert.strictEqual(result.toCreate.length, 1);
  assert.strictEqual(result.toCreate[0].email, "new.person@example.com");
  assert.strictEqual(result.quotaBlocked, 1);
  assert.strictEqual(result.preview["new.person@example.com"], "will_create");
  assert.strictEqual(result.preview["other.person@example.com"], "quota_blocked");
});

test("planLinkedInImport dedupes duplicate matched emails into a single update", () => {
  const result = planLinkedInImport({
    rows: [
      { email: "alice@example.com", linkedin_url: "https://www.linkedin.com/in/alice-new" },
      { email: "Alice@Example.com", linkedin_url: "https://www.linkedin.com/in/alice-newer" },
    ],
    overwrite: true,
    dryRun: true,
    alumniByEmail: new Map([[
      "alice@example.com",
      { id: "alumni-1", linkedin_url: null },
    ]]),
    remainingCapacity: 5,
  });

  assert.strictEqual(result.toUpdate.length, 1);
  assert.deepStrictEqual(result.toUpdate[0], {
    alumniId: "alumni-1",
    linkedinUrl: "https://www.linkedin.com/in/alice-new",
  });
  assert.strictEqual(result.skipped, 0);
  assert.strictEqual(result.quotaBlocked, 0);
  assert.strictEqual(result.preview["alice@example.com"], "will_update");
});

test("getLinkedInImportCapacitySnapshot uses enterprise-wide alumni count for enterprise-managed orgs", async () => {
  const calls = {
    orgCount: 0,
    enterpriseCount: 0,
  };

  const result = await getLinkedInImportCapacitySnapshot("org-1", {
    async getAlumniLimitForOrg() {
      return 10;
    },
    async getEnterpriseIdForOrg() {
      return "enterprise-1";
    },
    async countAlumniForOrg() {
      calls.orgCount += 1;
      return 2;
    },
    async countAlumniForEnterprise() {
      calls.enterpriseCount += 1;
      return 10;
    },
  });

  assert.strictEqual(calls.orgCount, 0);
  assert.strictEqual(calls.enterpriseCount, 1);
  assert.strictEqual(result.scope, "enterprise");
  assert.strictEqual(result.currentAlumniCount, 10);
  assert.strictEqual(result.remainingCapacity, 0);
});

test("getLinkedInImportCapacitySnapshot uses org-local alumni count for standalone orgs", async () => {
  const calls = {
    orgCount: 0,
    enterpriseCount: 0,
  };

  const result = await getLinkedInImportCapacitySnapshot("org-2", {
    async getAlumniLimitForOrg() {
      return 3;
    },
    async getEnterpriseIdForOrg() {
      return null;
    },
    async countAlumniForOrg() {
      calls.orgCount += 1;
      return 1;
    },
    async countAlumniForEnterprise() {
      calls.enterpriseCount += 1;
      return 99;
    },
  });

  assert.strictEqual(calls.orgCount, 1);
  assert.strictEqual(calls.enterpriseCount, 0);
  assert.strictEqual(result.scope, "organization");
  assert.strictEqual(result.currentAlumniCount, 1);
  assert.strictEqual(result.remainingCapacity, 2);
});

test("getLinkedInImportCapacitySnapshot preserves unlimited quota as positive infinity remaining", async () => {
  const result = await getLinkedInImportCapacitySnapshot("org-3", {
    async getAlumniLimitForOrg() {
      return null;
    },
    async getEnterpriseIdForOrg() {
      return null;
    },
    async countAlumniForOrg() {
      return 42;
    },
    async countAlumniForEnterprise() {
      throw new Error("should not be called");
    },
  });

  assert.strictEqual(result.alumniLimit, null);
  assert.strictEqual(result.currentAlumniCount, 42);
  assert.strictEqual(result.remainingCapacity, Number.POSITIVE_INFINITY);
});
