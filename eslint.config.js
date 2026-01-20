const coreWebVitals = require("eslint-config-next/core-web-vitals");
const typescript = require("eslint-config-next/typescript");

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const typescriptOnly = typescript.map((config) => {
  if (config.ignores || config.files) {
    return config;
  }
  return { ...config, files: tsFiles };
});

module.exports = [
  ...coreWebVitals,
  ...typescriptOnly,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
