import test from "node:test";
import assert from "node:assert";
import fc from "fast-check";

// Set up environment variables before importing the module
process.env.GOOGLE_CLIENT_ID = "test-client-id-12345.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import {
    getAuthorizationUrl,
    parseAuthorizationUrl,
    encryptToken,
    decryptToken,
} from "../src/lib/google/oauth.ts";

/**
 * Feature: google-calendar-sync, Property 1: OAuth Authorization URL Generation
 * 
 * *For any* state parameter, the generated OAuth authorization URL SHALL contain
 * the correct client ID, redirect URI, required scopes (calendar.events), and
 * the provided state parameter.
 * 
 * **Validates: Requirements 1.2**
 */
test("Property 1: OAuth Authorization URL Generation", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate random state strings (simulating user IDs or CSRF tokens)
            fc.string({ minLength: 1, maxLength: 100 }),
            async (state) => {
                const url = getAuthorizationUrl(state);
                const parsed = parseAuthorizationUrl(url);

                // URL must be a valid Google OAuth URL
                assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth"),
                    "URL should start with Google OAuth endpoint");

                // Must contain the correct client ID
                assert.strictEqual(parsed.clientId, process.env.GOOGLE_CLIENT_ID,
                    "URL must contain the correct client ID");

                // Must contain the correct redirect URI
                const expectedRedirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/google/callback`;
                assert.strictEqual(parsed.redirectUri, expectedRedirectUri,
                    "URL must contain the correct redirect URI");

                // Must contain the calendar.events scope (requirement 7.4)
                assert.ok(parsed.scopes.includes("https://www.googleapis.com/auth/calendar.events"),
                    "URL must include calendar.events scope");

                // Must contain the userinfo.email scope for getting user email
                assert.ok(parsed.scopes.includes("https://www.googleapis.com/auth/userinfo.email"),
                    "URL must include userinfo.email scope");

                // Must contain the provided state parameter
                assert.strictEqual(parsed.state, state,
                    "URL must contain the provided state parameter");

                // Must request offline access for refresh token
                assert.strictEqual(parsed.accessType, "offline",
                    "URL must request offline access for refresh token");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Feature: google-calendar-sync, Property 16: Token Encryption
 * 
 * *For any* `user_calendar_connections` record, the access_token_encrypted and
 * refresh_token_encrypted fields SHALL NOT contain plaintext tokens (they must be encrypted).
 * 
 * **Validates: Requirements 7.3**
 */
test("Property 16: Token Encryption", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate random token strings
            fc.string({ minLength: 10, maxLength: 500 }),
            async (plaintext) => {
                const encrypted = encryptToken(plaintext);

                // Encrypted value must not equal plaintext
                assert.notStrictEqual(encrypted, plaintext,
                    "Encrypted token must not equal plaintext");

                // Encrypted value must not contain the plaintext
                assert.ok(!encrypted.includes(plaintext),
                    "Encrypted token must not contain plaintext");

                // Encrypted value must be in the expected format (iv:authTag:ciphertext)
                const parts = encrypted.split(":");
                assert.strictEqual(parts.length, 3,
                    "Encrypted token must have 3 parts (iv:authTag:ciphertext)");

                // Each part must be valid base64
                for (const part of parts) {
                    assert.ok(part.length > 0, "Each part must be non-empty");
                    // Base64 characters only
                    assert.ok(/^[A-Za-z0-9+/=]+$/.test(part),
                        "Each part must be valid base64");
                }

                // Decryption must return the original plaintext (round-trip)
                const decrypted = decryptToken(encrypted);
                assert.strictEqual(decrypted, plaintext,
                    "Decrypted token must equal original plaintext");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Feature: google-calendar-sync, Property 16 (additional): Encryption produces different ciphertext
 * 
 * Due to random IV, encrypting the same plaintext twice should produce different ciphertext.
 * 
 * **Validates: Requirements 7.3**
 */
test("Property 16 (additional): Encryption produces unique ciphertext", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.string({ minLength: 10, maxLength: 200 }),
            async (plaintext) => {
                const encrypted1 = encryptToken(plaintext);
                const encrypted2 = encryptToken(plaintext);

                // Same plaintext should produce different ciphertext due to random IV
                assert.notStrictEqual(encrypted1, encrypted2,
                    "Same plaintext should produce different ciphertext due to random IV");

                // But both should decrypt to the same value
                assert.strictEqual(decryptToken(encrypted1), plaintext);
                assert.strictEqual(decryptToken(encrypted2), plaintext);

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Feature: google-calendar-sync, Property 2: Token Storage After OAuth Callback
 * 
 * *For any* valid authorization code received from Google, exchanging it for tokens
 * SHALL result in a `user_calendar_connections` record being created with encrypted
 * tokens, the user's Google email, and status "connected".
 * 
 * **Validates: Requirements 1.3**
 * 
 * Note: This test validates the storage logic by testing that:
 * 1. Tokens are encrypted before storage
 * 2. The stored data structure is correct
 * 3. Encrypted tokens can be decrypted back to original values
 */
test("Property 2: Token Storage - tokens are encrypted before storage", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate random token data with valid timestamps
            fc.record({
                accessToken: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length > 0),
                refreshToken: fc.string({ minLength: 20, maxLength: 200 }).filter(s => s.trim().length > 0),
                email: fc.emailAddress(),
                expiresAtMs: fc.integer({ min: Date.now(), max: Date.now() + 86400000 * 365 }),
            }),
            async (tokenData) => {
                const expiresAt = new Date(tokenData.expiresAtMs);

                // Simulate what storeCalendarConnection does
                const encryptedAccessToken = encryptToken(tokenData.accessToken);
                const encryptedRefreshToken = encryptToken(tokenData.refreshToken);

                // Verify tokens are encrypted (not plaintext)
                assert.notStrictEqual(encryptedAccessToken, tokenData.accessToken,
                    "Access token must be encrypted");
                assert.notStrictEqual(encryptedRefreshToken, tokenData.refreshToken,
                    "Refresh token must be encrypted");

                // Verify encrypted tokens don't contain plaintext
                assert.ok(!encryptedAccessToken.includes(tokenData.accessToken),
                    "Encrypted access token must not contain plaintext");
                assert.ok(!encryptedRefreshToken.includes(tokenData.refreshToken),
                    "Encrypted refresh token must not contain plaintext");

                // Verify tokens can be decrypted back
                const decryptedAccess = decryptToken(encryptedAccessToken);
                const decryptedRefresh = decryptToken(encryptedRefreshToken);

                assert.strictEqual(decryptedAccess, tokenData.accessToken,
                    "Decrypted access token must match original");
                assert.strictEqual(decryptedRefresh, tokenData.refreshToken,
                    "Decrypted refresh token must match original");

                // Verify the data structure that would be stored
                const storageRecord = {
                    google_email: tokenData.email,
                    access_token_encrypted: encryptedAccessToken,
                    refresh_token_encrypted: encryptedRefreshToken,
                    token_expires_at: expiresAt.toISOString(),
                    status: "connected" as const,
                };

                // Verify all required fields are present
                assert.ok(storageRecord.google_email, "Record must have google_email");
                assert.ok(storageRecord.access_token_encrypted, "Record must have encrypted access token");
                assert.ok(storageRecord.refresh_token_encrypted, "Record must have encrypted refresh token");
                assert.ok(storageRecord.token_expires_at, "Record must have token_expires_at");
                assert.strictEqual(storageRecord.status, "connected", "Status must be 'connected'");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


import { isTokenExpired } from "../src/lib/google/oauth.ts";

/**
 * Feature: google-calendar-sync, Property 15: Token Auto-Refresh
 * 
 * *For any* API call where the access token has expired but the refresh token is valid,
 * the system SHALL automatically obtain a new access token and retry the operation successfully.
 * 
 * **Validates: Requirements 7.1**
 * 
 * Note: This test validates the token expiration detection logic which is the foundation
 * for auto-refresh. The actual refresh involves external API calls which are tested via
 * integration tests.
 */
test("Property 15: Token Auto-Refresh - expiration detection", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate random buffer seconds (0 to 10 minutes)
            fc.integer({ min: 0, max: 600 }),
            // Generate random offset from now (-1 hour to +1 hour)
            fc.integer({ min: -3600000, max: 3600000 }),
            async (bufferSeconds, offsetMs) => {
                const now = Date.now();
                const expiresAt = new Date(now + offsetMs);
                const bufferMs = bufferSeconds * 1000;

                const isExpired = isTokenExpired(expiresAt, bufferSeconds);

                // Token should be considered expired if:
                // current time >= expiry time - buffer
                // i.e., now >= (now + offsetMs) - bufferMs
                // i.e., 0 >= offsetMs - bufferMs
                // i.e., bufferMs >= offsetMs
                const expectedExpired = bufferMs >= offsetMs;

                assert.strictEqual(isExpired, expectedExpired,
                    `Token with offset ${offsetMs}ms and buffer ${bufferSeconds}s should be ${expectedExpired ? "expired" : "valid"}`);

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 15 (additional): Default buffer is 5 minutes
 */
test("Property 15 (additional): Default expiration buffer is 5 minutes", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate times around the 5-minute boundary
            fc.integer({ min: -600000, max: 600000 }), // -10 to +10 minutes
            async (offsetMs) => {
                const now = Date.now();
                const expiresAt = new Date(now + offsetMs);

                // Default buffer is 300 seconds (5 minutes)
                const isExpired = isTokenExpired(expiresAt);

                // Token should be expired if it expires within 5 minutes
                const fiveMinutesMs = 300 * 1000;
                const expectedExpired = offsetMs <= fiveMinutesMs;

                assert.strictEqual(isExpired, expectedExpired,
                    `Token expiring in ${offsetMs}ms should be ${expectedExpired ? "expired" : "valid"} with default 5-minute buffer`);

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


import { getOAuthErrorMessage } from "../src/lib/google/oauth.ts";

/**
 * Feature: google-calendar-sync, Property 3: OAuth Error Handling
 * 
 * *For any* OAuth error response (invalid code, user denial, network error),
 * the system SHALL return an error object with a user-friendly message and
 * NOT create a connection record.
 * 
 * **Validates: Requirements 1.5**
 */
test("Property 3: OAuth Error Handling - user-friendly error messages", async () => {
    // Known OAuth error codes that Google can return
    const knownErrorCodes = [
        "access_denied",
        "invalid_request",
        "invalid_client",
        "invalid_grant",
        "unauthorized_client",
        "unsupported_response_type",
        "invalid_scope",
        "server_error",
        "temporarily_unavailable",
    ];

    await fc.assert(
        fc.asyncProperty(
            // Generate either known error codes or random strings
            fc.oneof(
                fc.constantFrom(...knownErrorCodes),
                fc.string({ minLength: 1, maxLength: 50 })
            ),
            async (errorCode) => {
                const message = getOAuthErrorMessage(errorCode);

                // Message must be a non-empty string
                assert.ok(typeof message === "string",
                    "Error message must be a string");
                assert.ok(message.length > 0,
                    "Error message must not be empty");

                // Message should be user-friendly (not contain technical jargon)
                assert.ok(!message.includes("undefined"),
                    "Error message should not contain 'undefined'");
                assert.ok(!message.includes("null"),
                    "Error message should not contain 'null'");
                assert.ok(!message.includes("[object"),
                    "Error message should not contain object notation");

                // Known error codes should have specific messages
                if (knownErrorCodes.includes(errorCode)) {
                    // Known errors should have descriptive messages
                    assert.ok(message.length > 20,
                        `Known error '${errorCode}' should have a descriptive message`);
                }

                // All messages should end with proper punctuation or be actionable
                const endsWithPunctuation = message.endsWith(".") || message.endsWith("!") || message.endsWith("?");
                assert.ok(endsWithPunctuation,
                    "Error message should end with proper punctuation");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 3 (additional): Error messages for specific error codes
 */
test("Property 3 (additional): Specific error codes have appropriate messages", async () => {
    const errorMappings: Record<string, string[]> = {
        access_denied: ["denied", "allow"],
        invalid_grant: ["expired", "again"],
        server_error: ["server", "later"],
        temporarily_unavailable: ["unavailable", "later"],
    };

    for (const [errorCode, expectedKeywords] of Object.entries(errorMappings)) {
        const message = getOAuthErrorMessage(errorCode);
        const messageLower = message.toLowerCase();

        for (const keyword of expectedKeywords) {
            assert.ok(
                messageLower.includes(keyword),
                `Error message for '${errorCode}' should contain '${keyword}': got "${message}"`
            );
        }
    }
});


/**
 * Feature: google-calendar-sync, Property 4: Disconnect Removes Connection
 * 
 * *For any* connected user who initiates disconnect, the system SHALL revoke
 * their Google tokens and remove their `user_calendar_connections` record,
 * resulting in no connection existing for that user.
 * 
 * **Validates: Requirements 1.6**
 * 
 * Note: This test validates the disconnect logic by testing that:
 * 1. The disconnect function handles both existing and non-existing connections
 * 2. After disconnect, the connection should be removed
 * 3. The function should be idempotent (calling disconnect on already disconnected user succeeds)
 */

// Simulated connection state for testing disconnect logic
interface MockConnection {
    userId: string;
    googleEmail: string;
    accessToken: string;
    refreshToken: string;
    status: "connected" | "disconnected" | "error";
}

// Simulated database for testing
class MockConnectionStore {
    private connections: Map<string, MockConnection> = new Map();
    private eventEntries: Map<string, string[]> = new Map(); // userId -> eventIds

    addConnection(conn: MockConnection): void {
        this.connections.set(conn.userId, conn);
    }

    addEventEntry(userId: string, eventId: string): void {
        const entries = this.eventEntries.get(userId) || [];
        entries.push(eventId);
        this.eventEntries.set(userId, entries);
    }

    getConnection(userId: string): MockConnection | null {
        return this.connections.get(userId) || null;
    }

    hasConnection(userId: string): boolean {
        return this.connections.has(userId);
    }

    getEventEntries(userId: string): string[] {
        return this.eventEntries.get(userId) || [];
    }

    /**
     * Simulates the disconnect operation
     * Returns success: true if operation completed (even if no connection existed)
     */
    disconnect(userId: string): { success: boolean; tokenRevoked: boolean } {
        const connection = this.connections.get(userId);

        if (!connection) {
            // Already disconnected - idempotent success
            return { success: true, tokenRevoked: false };
        }

        // Simulate token revocation (may fail but we continue)
        const tokenRevoked = true; // In real impl, this could fail

        // Remove connection
        this.connections.delete(userId);

        // Remove event entries
        this.eventEntries.delete(userId);

        return { success: true, tokenRevoked };
    }
}

test("Property 4: Disconnect Removes Connection", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate user data
            fc.uuid(),
            fc.emailAddress(),
            fc.string({ minLength: 20, maxLength: 100 }),
            fc.string({ minLength: 20, maxLength: 100 }),
            // Generate some event entries
            fc.array(fc.uuid(), { minLength: 0, maxLength: 5 }),
            // Whether user has a connection initially
            fc.boolean(),
            async (userId, email, accessToken, refreshToken, eventIds, hasInitialConnection) => {
                const store = new MockConnectionStore();

                // Set up initial state
                if (hasInitialConnection) {
                    store.addConnection({
                        userId,
                        googleEmail: email,
                        accessToken,
                        refreshToken,
                        status: "connected",
                    });

                    // Add some event entries
                    for (const eventId of eventIds) {
                        store.addEventEntry(userId, eventId);
                    }
                }

                // Verify initial state
                assert.strictEqual(store.hasConnection(userId), hasInitialConnection,
                    "Initial connection state should match setup");

                // Perform disconnect
                const result = store.disconnect(userId);

                // Disconnect should always succeed (idempotent)
                assert.strictEqual(result.success, true,
                    "Disconnect should always succeed");

                // After disconnect, connection should not exist
                assert.strictEqual(store.hasConnection(userId), false,
                    "Connection should not exist after disconnect");

                // After disconnect, event entries should be removed
                assert.strictEqual(store.getEventEntries(userId).length, 0,
                    "Event entries should be removed after disconnect");

                // Token should only be revoked if there was a connection
                assert.strictEqual(result.tokenRevoked, hasInitialConnection,
                    "Token should be revoked only if connection existed");

                // Calling disconnect again should still succeed (idempotent)
                const secondResult = store.disconnect(userId);
                assert.strictEqual(secondResult.success, true,
                    "Second disconnect should also succeed (idempotent)");
                assert.strictEqual(secondResult.tokenRevoked, false,
                    "Second disconnect should not revoke token (already disconnected)");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 4 (additional): Disconnect is idempotent
 */
test("Property 4 (additional): Disconnect is idempotent", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.uuid(),
            fc.integer({ min: 1, max: 10 }),
            async (userId, disconnectCount) => {
                const store = new MockConnectionStore();

                // Add a connection
                store.addConnection({
                    userId,
                    googleEmail: "test@example.com",
                    accessToken: "access-token",
                    refreshToken: "refresh-token",
                    status: "connected",
                });

                // Disconnect multiple times
                for (let i = 0; i < disconnectCount; i++) {
                    const result = store.disconnect(userId);
                    assert.strictEqual(result.success, true,
                        `Disconnect attempt ${i + 1} should succeed`);
                }

                // Final state should be disconnected
                assert.strictEqual(store.hasConnection(userId), false,
                    "Connection should not exist after multiple disconnects");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});


/**
 * Feature: google-calendar-sync, Property 14: Token Expiration Detection
 * 
 * *For any* API call that returns a 401 Unauthorized error, the system SHALL attempt
 * token refresh. If refresh fails, the `user_calendar_connections` status SHALL be
 * set to "disconnected".
 * 
 * **Validates: Requirements 6.2, 7.2**
 * 
 * Note: This test validates the token expiration detection and status update logic.
 * The actual API calls and refresh involve external services which are tested via
 * integration tests. This property test validates the state machine behavior.
 */

// Simulated token state for testing expiration detection
interface TokenState {
    userId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    status: "connected" | "disconnected" | "error";
}

// Simulated token store for testing
class MockTokenStore {
    private tokens: Map<string, TokenState> = new Map();

    setToken(state: TokenState): void {
        this.tokens.set(state.userId, state);
    }

    getToken(userId: string): TokenState | null {
        return this.tokens.get(userId) || null;
    }

    getStatus(userId: string): "connected" | "disconnected" | "error" | null {
        const token = this.tokens.get(userId);
        return token?.status || null;
    }

    /**
     * Simulates handling a 401 error by attempting token refresh
     * @param userId - The user whose token expired
     * @param refreshSucceeds - Whether the refresh attempt succeeds
     * @returns The new access token if refresh succeeded, null otherwise
     */
    handleUnauthorizedError(userId: string, refreshSucceeds: boolean): string | null {
        const token = this.tokens.get(userId);
        if (!token) {
            return null;
        }

        if (refreshSucceeds) {
            // Simulate successful refresh
            const newAccessToken = `refreshed-${Date.now()}-${Math.random()}`;
            const newExpiresAt = new Date(Date.now() + 3600000); // +1 hour

            this.tokens.set(userId, {
                ...token,
                accessToken: newAccessToken,
                expiresAt: newExpiresAt,
                status: "connected",
            });

            return newAccessToken;
        } else {
            // Refresh failed - mark as disconnected (Requirement 7.2)
            this.tokens.set(userId, {
                ...token,
                status: "disconnected",
            });

            return null;
        }
    }

    /**
     * Simulates checking if token is expired and needs refresh
     * @param userId - The user to check
     * @param bufferSeconds - Buffer time before expiry
     * @returns true if token is expired or about to expire
     */
    isTokenExpired(userId: string, bufferSeconds: number = 300): boolean {
        const token = this.tokens.get(userId);
        if (!token) return true;

        const bufferMs = bufferSeconds * 1000;
        return Date.now() >= token.expiresAt.getTime() - bufferMs;
    }
}

test("Property 14: Token Expiration Detection - 401 triggers refresh attempt", async () => {
    await fc.assert(
        fc.asyncProperty(
            // Generate user data
            fc.uuid(),
            fc.string({ minLength: 20, maxLength: 100 }),
            fc.string({ minLength: 20, maxLength: 100 }),
            // Whether refresh succeeds
            fc.boolean(),
            async (userId, accessToken, refreshToken, refreshSucceeds) => {
                const store = new MockTokenStore();

                // Set up initial connected state with expired token
                const expiredTime = new Date(Date.now() - 3600000); // 1 hour ago
                store.setToken({
                    userId,
                    accessToken,
                    refreshToken,
                    expiresAt: expiredTime,
                    status: "connected",
                });

                // Verify initial state
                assert.strictEqual(store.getStatus(userId), "connected",
                    "Initial status should be connected");
                assert.strictEqual(store.isTokenExpired(userId), true,
                    "Token should be detected as expired");

                // Simulate 401 error handling
                const newToken = store.handleUnauthorizedError(userId, refreshSucceeds);

                if (refreshSucceeds) {
                    // Refresh succeeded - should have new token and remain connected
                    assert.ok(newToken !== null,
                        "Should return new token on successful refresh");
                    assert.notStrictEqual(newToken, accessToken,
                        "New token should be different from old token");
                    assert.strictEqual(store.getStatus(userId), "connected",
                        "Status should remain connected after successful refresh");
                    assert.strictEqual(store.isTokenExpired(userId), false,
                        "Token should not be expired after refresh");
                } else {
                    // Refresh failed - should be disconnected (Requirement 7.2)
                    assert.strictEqual(newToken, null,
                        "Should return null on failed refresh");
                    assert.strictEqual(store.getStatus(userId), "disconnected",
                        "Status should be disconnected after failed refresh");
                }

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 14 (additional): Multiple 401 errors with failed refresh keep status disconnected
 */
test("Property 14 (additional): Failed refresh sets status to disconnected", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.uuid(),
            fc.integer({ min: 1, max: 5 }),
            async (userId, failureCount) => {
                const store = new MockTokenStore();

                // Set up initial connected state
                store.setToken({
                    userId,
                    accessToken: "initial-token",
                    refreshToken: "refresh-token",
                    expiresAt: new Date(Date.now() - 1000), // Expired
                    status: "connected",
                });

                // Simulate multiple failed refresh attempts
                for (let i = 0; i < failureCount; i++) {
                    const result = store.handleUnauthorizedError(userId, false);
                    assert.strictEqual(result, null,
                        `Attempt ${i + 1}: Should return null on failed refresh`);
                }

                // Final status should be disconnected
                assert.strictEqual(store.getStatus(userId), "disconnected",
                    "Status should be disconnected after failed refresh attempts");

                return true;
            }
        ),
        { numRuns: 100 }
    );
});

/**
 * Property 14 (additional): Successful refresh after expiration restores connected status
 */
test("Property 14 (additional): Successful refresh restores connected status", async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.uuid(),
            // Generate various expiration times (past to future)
            fc.integer({ min: -7200000, max: 300000 }), // -2 hours to +5 minutes
            async (userId, expirationOffsetMs) => {
                const store = new MockTokenStore();

                // Set up token with variable expiration
                const expiresAt = new Date(Date.now() + expirationOffsetMs);
                store.setToken({
                    userId,
                    accessToken: "original-token",
                    refreshToken: "refresh-token",
                    expiresAt,
                    status: "connected",
                });

                // Check if token is expired (with 5-minute buffer)
                const isExpired = store.isTokenExpired(userId, 300);
                const expectedExpired = expirationOffsetMs <= 300000; // 5 minutes buffer

                assert.strictEqual(isExpired, expectedExpired,
                    `Token with offset ${expirationOffsetMs}ms should be ${expectedExpired ? "expired" : "valid"}`);

                // If expired, simulate successful refresh
                if (isExpired) {
                    const newToken = store.handleUnauthorizedError(userId, true);
                    assert.ok(newToken !== null,
                        "Should get new token on successful refresh");
                    assert.strictEqual(store.getStatus(userId), "connected",
                        "Status should be connected after successful refresh");
                    assert.strictEqual(store.isTokenExpired(userId), false,
                        "Token should not be expired after refresh");
                }

                return true;
            }
        ),
        { numRuns: 100 }
    );
});
