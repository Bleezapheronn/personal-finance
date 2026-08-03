import {
  applyRuntimeConfigToApiEnvironment,
  readRuntimeConfig,
  runtimeConfigPathFromArgs,
} from "./runtimeConfig.js";

const config = readRuntimeConfig(runtimeConfigPathFromArgs(process.argv.slice(2)));
applyRuntimeConfigToApiEnvironment(runtimeConfigPathFromArgs(process.argv.slice(2)), config);

await import("./index.js");
