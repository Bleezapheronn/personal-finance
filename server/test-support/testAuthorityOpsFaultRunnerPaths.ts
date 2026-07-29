import {
  runFaultRunnerPostValidationRedirection,
  runFaultRunnerRuntimeJunctionRejection,
  runFaultRunnerValidRuntimePathSmoke,
} from "./authorityOpsFaultRunnerPathSmoke.js";

await runFaultRunnerValidRuntimePathSmoke();
await runFaultRunnerRuntimeJunctionRejection();
await runFaultRunnerPostValidationRedirection();
console.log("Authority fault-runner runtime path tests: PASS (3 cases)");
