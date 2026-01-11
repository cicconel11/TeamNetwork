import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { validateOrgName } from "../src/lib/validation/org-name";

/**
 * Property 2: Organization Name Validation
 * Validates: Requirements 1.3
 *
 * For any string submitted as an organization name, the validation function
 * should return valid=true if and only if the trimmed string is non-empty
 * and has length ≤ 100 characters.
 */
test("Property 2: Organization Name Validation", async (t) => {
    await t.test("valid names: non-empty strings with length ≤ 100 after trim", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0 && s.trim().length <= 100),
                (name) => {
                    const result = validateOrgName(name);
                    assert.strictEqual(result.valid, true, `Name "${name}" should be valid`);
                    assert.strictEqual(result.error, undefined, `Valid name should have no error`);
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("invalid names: empty strings or whitespace-only strings", () => {
        // Test empty string
        const emptyResult = validateOrgName("");
        assert.strictEqual(emptyResult.valid, false);
        assert.strictEqual(emptyResult.error, "Organization name cannot be empty");

        // Test whitespace-only strings using nat to generate varying lengths
        fc.assert(
            fc.property(
                fc.nat({ max: 20 }).map((n) => " ".repeat(n + 1)),
                (whitespace) => {
                    const result = validateOrgName(whitespace);
                    assert.strictEqual(result.valid, false, `Whitespace-only should be invalid`);
                    assert.strictEqual(result.error, "Organization name cannot be empty");
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("invalid names: strings longer than 100 characters after trim", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 101, maxLength: 200 }).filter((s) => s.trim().length > 100),
                (longName) => {
                    const result = validateOrgName(longName);
                    assert.strictEqual(result.valid, false, `Long name should be invalid`);
                    assert.strictEqual(result.error, "Organization name must be under 100 characters");
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("empty string is invalid", () => {
        const result = validateOrgName("");
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, "Organization name cannot be empty");
    });

    await t.test("exactly 100 character name is valid", () => {
        const name = "a".repeat(100);
        const result = validateOrgName(name);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.error, undefined);
    });

    await t.test("101 character name is invalid", () => {
        const name = "a".repeat(101);
        const result = validateOrgName(name);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.error, "Organization name must be under 100 characters");
    });

    await t.test("name with leading/trailing whitespace is validated after trim", () => {
        fc.assert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 90 }).filter((s) => s.trim().length > 0),
                (name) => {
                    const paddedName = `   ${name}   `;
                    const result = validateOrgName(paddedName);
                    // Should be valid if trimmed length is ≤ 100
                    const trimmedLength = paddedName.trim().length;
                    assert.strictEqual(result.valid, trimmedLength > 0 && trimmedLength <= 100);
                }
            ),
            { numRuns: 100 }
        );
    });
});
