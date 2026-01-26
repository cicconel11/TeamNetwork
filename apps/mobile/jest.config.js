module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(ts|tsx)$": ["babel-jest", { presets: ["babel-preset-expo"] }],
  },
  testMatch: ["**/__tests__/**/*.test.ts?(x)", "**/*.test.ts?(x)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!src/**/*.stories.{ts,tsx}",
  ],
  // Coverage thresholds - set to achievable levels for pure function tests
  // React Native components/hooks require jest-expo preset which conflicts with bun's module hoisting
  // Full component testing requires a different approach (e.g., E2E with Detox/Maestro)
  coverageThreshold: {
    // Only set thresholds for files we can actually test
    "src/lib/theme.ts": {
      statements: 90,
      branches: 85,
      functions: 70,
      lines: 90,
    },
    "src/lib/featureFlags.ts": {
      statements: 100,
      branches: 50,
      functions: 100,
      lines: 100,
    },
    "src/lib/analytics/index.ts": {
      statements: 75,
      branches: 70,
      functions: 80,
      lines: 80,
    },
    "src/lib/chrome.ts": {
      statements: 100,
      lines: 100,
    },
    "src/lib/design-tokens.ts": {
      statements: 100,
      lines: 100,
    },
    "src/lib/typography.ts": {
      statements: 100,
      lines: 100,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@teammeet/core$": "<rootDir>/../../packages/core/src",
    "^@teammeet/core/(.*)$": "<rootDir>/../../packages/core/src/$1",
    "^@teammeet/types$": "<rootDir>/../../packages/types/src",
    "^@teammeet/validation$": "<rootDir>/../../packages/validation/src",
  },
  globals: {
    __DEV__: true,
  },
  clearMocks: true,
  resetMocks: true,
};
