import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";
import { resolveLabel, resolveActionLabel } from "../src/lib/navigation/label-resolver.ts";
import { ORG_NAV_ITEMS, type NavConfig } from "../src/lib/navigation/nav-items.tsx";

/**
 * Property 4: Nav Label Resolution with Fallback
 * Validates: Requirements 2.2, 2.3
 *
 * For any navigation href and nav config, the resolved label should equal
 * the custom label if one exists in the config, otherwise it should equal
 * the default label from ORG_NAV_ITEMS.
 */
test("Property 4: Nav Label Resolution with Fallback", async (t) => {
    // Get all valid hrefs from ORG_NAV_ITEMS
    const validHrefs = ORG_NAV_ITEMS.map((item) => item.href);

    await t.test("resolveLabel returns custom label when present in navConfig", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...validHrefs),
                fc.string({ minLength: 1, maxLength: 50 }),
                (href, customLabel) => {
                    const navConfig: NavConfig = {
                        [href]: { label: customLabel },
                    };

                    const result = resolveLabel(href, navConfig);
                    assert.strictEqual(result, customLabel, `Should return custom label "${customLabel}" for href "${href}"`);
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("resolveLabel returns default label when navConfig is null", () => {
        fc.assert(
            fc.property(fc.constantFrom(...validHrefs), (href) => {
                const defaultItem = ORG_NAV_ITEMS.find((item) => item.href === href);
                const expectedLabel = defaultItem?.label ?? "";

                const result = resolveLabel(href, null);
                assert.strictEqual(result, expectedLabel, `Should return default label "${expectedLabel}" for href "${href}"`);
            }),
            { numRuns: 100 }
        );
    });

    await t.test("resolveLabel returns default label when navConfig is undefined", () => {
        fc.assert(
            fc.property(fc.constantFrom(...validHrefs), (href) => {
                const defaultItem = ORG_NAV_ITEMS.find((item) => item.href === href);
                const expectedLabel = defaultItem?.label ?? "";

                const result = resolveLabel(href, undefined);
                assert.strictEqual(result, expectedLabel, `Should return default label "${expectedLabel}" for href "${href}"`);
            }),
            { numRuns: 100 }
        );
    });

    await t.test("resolveLabel returns default label when href not in navConfig", () => {
        fc.assert(
            fc.property(fc.constantFrom(...validHrefs), (href) => {
                const defaultItem = ORG_NAV_ITEMS.find((item) => item.href === href);
                const expectedLabel = defaultItem?.label ?? "";

                // Empty navConfig - href not present
                const navConfig: NavConfig = {};

                const result = resolveLabel(href, navConfig);
                assert.strictEqual(result, expectedLabel, `Should return default label "${expectedLabel}" when href not in config`);
            }),
            { numRuns: 100 }
        );
    });

    await t.test("resolveLabel returns default label when custom label is empty string", () => {
        fc.assert(
            fc.property(fc.constantFrom(...validHrefs), (href) => {
                const defaultItem = ORG_NAV_ITEMS.find((item) => item.href === href);
                const expectedLabel = defaultItem?.label ?? "";

                const navConfig: NavConfig = {
                    [href]: { label: "" },
                };

                const result = resolveLabel(href, navConfig);
                assert.strictEqual(result, expectedLabel, `Should return default label when custom label is empty`);
            }),
            { numRuns: 100 }
        );
    });

    await t.test("resolveActionLabel converts plural labels to singular with prefix", () => {
        // Test with known plural labels
        const pluralLabels = [
            { href: "/members", expected: "Add Member" },
            { href: "/workouts", expected: "Add Workout" },
            { href: "/events", expected: "Add Event" },
            { href: "/announcements", expected: "Add Announcement" },
        ];

        for (const { href, expected } of pluralLabels) {
            const result = resolveActionLabel(href, null);
            assert.strictEqual(result, expected, `Should convert "${href}" to "${expected}"`);
        }
    });

    await t.test("resolveActionLabel uses custom label when present", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...validHrefs),
                fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.endsWith("s")),
                (href, customLabel) => {
                    const navConfig: NavConfig = {
                        [href]: { label: customLabel },
                    };

                    const result = resolveActionLabel(href, navConfig);
                    // Since the custom label doesn't end in 's', it should remain unchanged
                    assert.strictEqual(result, `Add ${customLabel}`, `Should use custom label in action`);
                }
            ),
            { numRuns: 100 }
        );
    });

    await t.test("resolveActionLabel supports custom prefix", () => {
        fc.assert(
            fc.property(
                fc.constantFrom(...validHrefs),
                fc.constantFrom("New", "Create", "Edit", "Delete"),
                (href, prefix) => {
                    const result = resolveActionLabel(href, null, prefix);
                    assert.ok(result.startsWith(prefix), `Action label should start with prefix "${prefix}"`);
                }
            ),
            { numRuns: 100 }
        );
    });
});
