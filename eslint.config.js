const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

module.exports = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/.worktrees/**",
      "apps/**",
      "packages/**",
      "playwright-report/**",
      "audit/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    files: ["**/*.js", "**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: [
      "src/app/api/blackbaud/**/*.ts",
      "src/lib/blackbaud/**/*.ts",
      "tests/blackbaud-*.test.ts",
      "tests/utils/supabaseIntegration.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["tests/blackbaud-sync-guard.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
];
