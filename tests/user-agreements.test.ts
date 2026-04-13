import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TOS_VERSION,
  hasAcceptedCurrentAgreementVersions,
} from "../src/lib/compliance/user-agreements";

describe("hasAcceptedCurrentAgreementVersions", () => {
  it("returns true when both current versions are present", () => {
    assert.equal(
      hasAcceptedCurrentAgreementVersions([
        {
          agreement_type: "terms_of_service",
          version: CURRENT_TOS_VERSION,
        },
        {
          agreement_type: "privacy_policy",
          version: CURRENT_PRIVACY_VERSION,
        },
      ]),
      true,
    );
  });

  it("returns false when only one agreement is present", () => {
    assert.equal(
      hasAcceptedCurrentAgreementVersions([
        {
          agreement_type: "terms_of_service",
          version: CURRENT_TOS_VERSION,
        },
      ]),
      false,
    );
  });

  it("returns false when a stale version is present", () => {
    assert.equal(
      hasAcceptedCurrentAgreementVersions([
        {
          agreement_type: "terms_of_service",
          version: "2025-12-01",
        },
        {
          agreement_type: "privacy_policy",
          version: CURRENT_PRIVACY_VERSION,
        },
      ]),
      false,
    );
  });

  it("ignores duplicate historical rows once both current versions exist", () => {
    assert.equal(
      hasAcceptedCurrentAgreementVersions([
        {
          agreement_type: "terms_of_service",
          version: "2025-01-01",
        },
        {
          agreement_type: "terms_of_service",
          version: CURRENT_TOS_VERSION,
        },
        {
          agreement_type: "privacy_policy",
          version: CURRENT_PRIVACY_VERSION,
        },
      ]),
      true,
    );
  });
});
