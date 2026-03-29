const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;

// `firebase/auth` re-exports `@firebase/auth`; Metro can resolve the browser build so
// `registerAuth("ReactNative")` never runs → "Component auth has not been registered yet".
// Apply resolver AFTER NativeWind / css-interop (they wrap resolveRequest).
const baseConfig = getDefaultConfig(projectRoot);
const config = withNativeWind(baseConfig, {
  input: "./global.css",
  inlineRem: 16,
});

const rnAuthPath = path.join(
  projectRoot,
  "node_modules/@firebase/auth/dist/rn/index.js"
);
const firebaseAppEsmPath = path.join(
  projectRoot,
  "node_modules/@firebase/app/dist/esm/index.esm2017.js"
);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@firebase/app": path.join(projectRoot, "node_modules/@firebase/app"),
  "@firebase/component": path.join(projectRoot, "node_modules/@firebase/component"),
};

const upstreamResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Single ESM build for @firebase/app — avoids two JS instances / two component registries.
  if (moduleName === "@firebase/app") {
    return {
      filePath: firebaseAppEsmPath,
      type: "sourceFile",
    };
  }
  // Only the package entry — NOT `@firebase/auth/internal` etc. (those must resolve normally).
  if (moduleName === "@firebase/auth") {
    return {
      filePath: rnAuthPath,
      type: "sourceFile",
    };
  }
  if (upstreamResolveRequest) {
    return upstreamResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
