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
  ],
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
};
