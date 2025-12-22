/**
 * Tests for invite validation logic
 * 
 * These tests verify that invite codes/tokens are properly validated
 * for expiration, revocation, and max uses.
 */

import { describe, it, expect, beforeEach } from "vitest";

// Mock invite data structure
interface MockInvite {
  id: string;
  code: string;
  token: string | null;
  role: string;
  uses_remaining: number | null;
  expires_at: string | null;
  revoked_at: string | null;
  organization_id: string;
}

// Validation functions (these mirror the logic in the join page)
function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt) < new Date();
}

function isRevoked(revokedAt: string | null): boolean {
  return !!revokedAt;
}

function hasUsesRemaining(usesRemaining: number | null): boolean {
  if (usesRemaining === null) return true; // Unlimited
  return usesRemaining > 0;
}

function isValidInvite(invite: MockInvite): { valid: boolean; reason?: string } {
  if (isRevoked(invite.revoked_at)) {
    return { valid: false, reason: "This invite has been revoked." };
  }
  
  if (isExpired(invite.expires_at)) {
    return { valid: false, reason: "This invite has expired." };
  }
  
  if (!hasUsesRemaining(invite.uses_remaining)) {
    return { valid: false, reason: "This invite has no uses remaining." };
  }
  
  return { valid: true };
}

describe("Invite Validation", () => {
  let validInvite: MockInvite;

  beforeEach(() => {
    validInvite = {
      id: "test-invite-1",
      code: "ABCD1234",
      token: "abc123def456",
      role: "active_member",
      uses_remaining: 10,
      expires_at: null,
      revoked_at: null,
      organization_id: "org-1",
    };
  });

  describe("isExpired", () => {
    it("should return false for null expires_at (no expiration)", () => {
      expect(isExpired(null)).toBe(false);
    });

    it("should return false for future expiration date", () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      expect(isExpired(futureDate.toISOString())).toBe(false);
    });

    it("should return true for past expiration date", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      expect(isExpired(pastDate.toISOString())).toBe(true);
    });
  });

  describe("isRevoked", () => {
    it("should return false for null revoked_at", () => {
      expect(isRevoked(null)).toBe(false);
    });

    it("should return true for non-null revoked_at", () => {
      expect(isRevoked(new Date().toISOString())).toBe(true);
    });
  });

  describe("hasUsesRemaining", () => {
    it("should return true for null uses_remaining (unlimited)", () => {
      expect(hasUsesRemaining(null)).toBe(true);
    });

    it("should return true for positive uses_remaining", () => {
      expect(hasUsesRemaining(5)).toBe(true);
      expect(hasUsesRemaining(1)).toBe(true);
    });

    it("should return false for zero uses_remaining", () => {
      expect(hasUsesRemaining(0)).toBe(false);
    });

    it("should return false for negative uses_remaining", () => {
      expect(hasUsesRemaining(-1)).toBe(false);
    });
  });

  describe("isValidInvite", () => {
    it("should validate a fresh invite with no restrictions", () => {
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should validate an invite with unlimited uses", () => {
      validInvite.uses_remaining = null;
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(true);
    });

    it("should reject a revoked invite", () => {
      validInvite.revoked_at = new Date().toISOString();
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("This invite has been revoked.");
    });

    it("should reject an expired invite", () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      validInvite.expires_at = pastDate.toISOString();
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("This invite has expired.");
    });

    it("should reject an invite with no uses remaining", () => {
      validInvite.uses_remaining = 0;
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("This invite has no uses remaining.");
    });

    it("should prioritize revoked status over expiration", () => {
      validInvite.revoked_at = new Date().toISOString();
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      validInvite.expires_at = pastDate.toISOString();
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("This invite has been revoked.");
    });

    it("should accept an invite about to expire", () => {
      const futureDate = new Date();
      futureDate.setMinutes(futureDate.getMinutes() + 1);
      validInvite.expires_at = futureDate.toISOString();
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(true);
    });

    it("should accept an invite with exactly 1 use remaining", () => {
      validInvite.uses_remaining = 1;
      const result = isValidInvite(validInvite);
      expect(result.valid).toBe(true);
    });
  });

  describe("Role mapping", () => {
    it("should accept valid role values", () => {
      const roles = ["admin", "active_member", "alumni", "member", "viewer"];
      roles.forEach((role) => {
        validInvite.role = role;
        const result = isValidInvite(validInvite);
        expect(result.valid).toBe(true);
      });
    });
  });
});




