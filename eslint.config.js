const { FlatCompat } = require("@eslint/eslintrc");

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

module.exports = [
  {
    ignores: [
      "**/.next/**",
      "**/node_modules/**",
      "**/.claude/worktrees/**",
      "**/.worktrees/**",
      "**/.claude/**",
      "scripts/**",
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
      // Next 15 flags intentional full-document/download anchors as internal navigation.
      // Keep this off until those flows can be reviewed route-by-route.
      "@next/next/no-html-link-for-pages": "off",
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
