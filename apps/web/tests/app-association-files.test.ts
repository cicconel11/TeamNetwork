import assert from "node:assert";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const wellKnownRoot = path.join(repoRoot, "apps/web/public/.well-known");

const IOS_APP_ID = "5GWLTFG43T.com.myteamnetwork.teammeet";
const ANDROID_PACKAGE_NAME = "com.myteamnetwork.teammeet";
const HANDLE_ALL_URLS_RELATION = "delegate_permission/common.handle_all_urls";
const EXPECTED_AASA_PATHS = ["/auth/callback", "/auth/callback/*", "/auth/claim", "/auth/claim/*"];
const UNHANDLED_HTTPS_PATH_MARKERS = [
  "/app/join",
  "/app/parents-join",
  "announcements",
  "events",
  "chat",
  "discussions",
  "feed",
  "jobs",
  "mentorship",
];

function readWellKnownJson(fileName: string): unknown {
  return JSON.parse(readFileSync(path.join(wellKnownRoot, fileName), "utf8"));
}

describe("app association files", () => {
  it("serves an AASA file scoped to HTTPS routes the mobile parser handles", () => {
    const aasa = readWellKnownJson("apple-app-site-association") as {
      applinks?: {
        details?: Array<{
          appIDs?: string[];
          components?: Array<Record<string, unknown>>;
        }>;
      };
    };

    assert.ok(aasa.applinks, "AASA must contain applinks");
    assert.ok(Array.isArray(aasa.applinks.details), "AASA applinks.details must be an array");

    const detail = aasa.applinks.details.find((entry) => entry.appIDs?.includes(IOS_APP_ID));
    assert.ok(detail, `AASA must include app ID ${IOS_APP_ID}`);
    assert.ok(Array.isArray(detail.components), "AASA entry must use modern components");

    const componentPaths = detail.components.map((component) => component["/"]);
    assert.deepStrictEqual(
      componentPaths,
      EXPECTED_AASA_PATHS,
      "AASA must only claim HTTPS paths parseTeammeetUrl routes today"
    );

    const serializedComponents = JSON.stringify(detail.components);
    for (const marker of UNHANDLED_HTTPS_PATH_MARKERS) {
      assert.ok(
        !serializedComponents.includes(marker),
        `AASA must not claim unhandled HTTPS path marker: ${marker}`
      );
    }
  });

  it("serves Android Digital Asset Links with a release signing fingerprint", () => {
    const assetLinks = readWellKnownJson("assetlinks.json") as Array<{
      relation?: string[];
      target?: {
        namespace?: string;
        package_name?: string;
        sha256_cert_fingerprints?: string[];
      };
    }>;

    assert.ok(Array.isArray(assetLinks), "assetlinks.json must be a JSON array");

    const appStatement = assetLinks.find(
      (statement) => statement.target?.package_name === ANDROID_PACKAGE_NAME
    );
    assert.ok(appStatement, `assetlinks.json must include ${ANDROID_PACKAGE_NAME}`);
    assert.ok(
      appStatement.relation?.includes(HANDLE_ALL_URLS_RELATION),
      "assetlinks.json must delegate common.handle_all_urls"
    );
    assert.strictEqual(appStatement.target?.namespace, "android_app");

    const fingerprints = appStatement.target?.sha256_cert_fingerprints ?? [];
    assert.ok(fingerprints.length > 0, "assetlinks.json must include a SHA-256 fingerprint");
    for (const fingerprint of fingerprints) {
      assert.match(
        fingerprint,
        /^([A-F0-9]{2}:){31}[A-F0-9]{2}$/,
        "fingerprint must be a colon-separated SHA-256 certificate fingerprint"
      );
      assert.doesNotMatch(fingerprint, /PLACEHOLDER|TODO|REPLACE/i);
    }
  });
});
