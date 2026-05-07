const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

/**
 * Bun workspaces often link deps to ../../node_modules/.bun/.../node_modules/pkg.
 * Resolve packages from apps/mobile first so native Expo modules are loaded from
 * the app workspace, then fall back to the monorepo root.
 */
function resolvePackageRealDir(pkgName) {
  const nested = path.join(projectRoot, "node_modules", pkgName);
  if (fs.existsSync(nested)) {
    try {
      return fs.realpathSync(nested);
    } catch {
      return nested;
    }
  }
  try {
    const resolved = require.resolve(`${pkgName}/package.json`, {
      paths: [projectRoot, workspaceRoot],
    });
    return path.dirname(resolved);
  } catch {
    return nested;
  }
}

const config = getDefaultConfig(projectRoot);

// Monorepo support
config.watchFolders = [workspaceRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Ensure React singletons always resolve from the local project (since they are not hoisted).
config.resolver.extraNodeModules = {
  "expo-apple-authentication": path.resolve(projectRoot, "node_modules/expo-apple-authentication"),
  "expo-local-authentication": path.resolve(projectRoot, "node_modules/expo-local-authentication"),
  react: path.resolve(projectRoot, "node_modules/react"),
  "react-dom": path.resolve(projectRoot, "node_modules/react-dom"),
  "react-native": path.resolve(projectRoot, "node_modules/react-native"),
  "react-native-web": path.resolve(projectRoot, "node_modules/react-native-web"),
};

// Stub out native-only modules when bundling for web
const nativeOnlyModules = ["@stripe/stripe-react-native"];
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform, ...args) => {
  if (platform === "web" && nativeOnlyModules.some((m) => moduleName.startsWith(m))) {
    return { type: "empty" };
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform, ...args);
  }
  return context.resolveRequest(context, moduleName, platform, ...args);
};

module.exports = config;
