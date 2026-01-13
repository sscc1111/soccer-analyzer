const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;

// Redirect burnt to mock for Expo Go compatibility
// burnt requires native modules not available in Expo Go
const burntMockPath = path.resolve(projectRoot, "lib/burnt-mock.js");
const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Intercept burnt module and redirect to mock
  if (moduleName === "burnt") {
    return {
      filePath: burntMockPath,
      type: "sourceFile",
    };
  }

  // Use React Native specific Firebase Auth build for persistence support
  if (moduleName === "@firebase/auth" || moduleName === "firebase/auth") {
    const firebaseAuthRNPath = require.resolve(
      "@firebase/auth/dist/rn/index.js"
    );
    return {
      filePath: firebaseAuthRNPath,
      type: "sourceFile",
    };
  }

  // Fall back to default resolver
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
