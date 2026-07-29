import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";
import os from "node:os";
import { runAuthorityOpsSupervisor } from "../src/lib/authorityOpsRun.js";
import { createAuthorityOpsFaultDependencies } from "./authorityOpsFaultDependencies.js";
import { readAuthorityOpsProfile } from "../src/lib/authorityOpsProfile.js";

const valueFor = (argv: string[], flag: string): string => {
  const index = argv.indexOf(flag); const value = index < 0 ? undefined : argv[index + 1];
  if (!value) throw new Error(`${flag}_required`); return value;
};
const validatedGate = (profilePath: string, supplied: string): string => {
  const profile = requireDisposablePath(profilePath, "disposable_path_validation_failed");
  const runtime = requireDisposablePath(path.join(path.dirname(profile), ".authority-ops-runtime"), "disposable_path_validation_failed");
  const gate = requireDisposablePath(supplied, "disposable_path_validation_failed");
  if (path.dirname(gate) !== runtime) throw new Error("authority_test_gate_path_invalid");
  return gate;
};
const waitForResume = async (profilePath: string, suppliedGate: string) => {
  const gatePath = validatedGate(profilePath, suppliedGate);
  const ready = requireDisposablePath(`${gatePath}.ready`, "disposable_path_validation_failed");
  const resume = requireDisposablePath(`${gatePath}.resume`, "disposable_path_validation_failed");
  writeFileSync(ready, "ready\n", { flag: "wx" });
  const deadline = Date.now() + 10_000;
  while (!existsSync(requireDisposablePath(resume, "disposable_path_identity_changed")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  const resumed = existsSync(resume);
  if (existsSync(requireDisposablePath(resume, "disposable_path_identity_changed"))) unlinkSync(resume); if (existsSync(requireDisposablePath(ready, "disposable_path_identity_changed"))) unlinkSync(ready);
  if (!resumed) throw new Error("authority_session_receipt_gate_timeout");
};
const validatedSync = (profilePath: string, supplied: string): string => {
  const profile = requireDisposablePath(profilePath, "disposable_path_validation_failed");
  const sync = requireDisposablePath(supplied, "disposable_path_validation_failed");
  if (path.dirname(sync) !== path.dirname(profile)) throw new Error("authority_test_sync_path_invalid");
  return sync;
};
const waitForRuntimePathSmokePermit = async (profilePath: string, suppliedGate: string, suppliedSync: string) => {
  const gate = validatedGate(profilePath, suppliedGate);
  const sync = validatedSync(profilePath, suppliedSync);
  const validated = requireDisposablePath(`${sync}.validated`, "disposable_path_identity_changed");
  const permit = requireDisposablePath(`${sync}.resume`, "disposable_path_identity_changed");
  writeFileSync(validated, "validated\n", { flag: "wx" });
  const deadline = Date.now() + 10_000;
  try {
    while (!existsSync(requireDisposablePath(validatedSync(profilePath, sync) + ".resume", "disposable_path_identity_changed")) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    if (!existsSync(requireDisposablePath(validatedSync(profilePath, sync) + ".resume", "disposable_path_identity_changed"))) throw new Error("authority_runtime_path_smoke_permit_timeout");
    unlinkSync(requireDisposablePath(permit, "disposable_path_identity_changed"));
    // This is deliberately after the test-controlled synchronization point.
    // It proves the derived runtime/gate identity has not changed before use.
    validatedGate(profilePath, gate);
  } finally {
    if (existsSync(requireDisposablePath(validated, "disposable_path_identity_changed"))) unlinkSync(validated);
  }
};
const post = (port: number, pathname: string, token: string) => new Promise<void>((resolve, reject) => {
  const request = http.request({ host: "127.0.0.1", port, path: pathname, method: "POST", headers: { "x-personal-finance-token": token, "content-length": "0" } }, (response) => {
    response.resume();
    response.statusCode === 202 ? resolve() : reject(new Error("authority_test_race_trigger_failed"));
  });
  request.on("error", reject);
  request.end();
});
const waitForListenerClose = async (port: number) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const closed = await new Promise<boolean>((resolve) => {
      const request = http.get({ host: "127.0.0.1", port, path: "/health", timeout: 100 }, (response) => { response.resume(); resolve(false); });
      request.on("error", () => resolve(true));
      request.on("timeout", () => { request.destroy(); resolve(false); });
    });
    if (closed) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("authority_test_race_listener_close_timeout");
};
const finalCleanupDependencies = (fault: "control-close" | "descriptor" | "lock-release") => ({
  finalCleanup: {
    ...(fault === "control-close" ? { closeControl: async (control: { close: () => Promise<void> }) => { await control.close(); throw new Error("test_control_close_failure"); } } : {}),
    ...(fault === "descriptor" ? { removeControlDescriptor: () => { throw new Error("test_descriptor_remove_failure"); } } : {}),
    ...(fault === "lock-release" ? { releaseLock: () => { throw new Error("test_lock_release_failure"); } } : {}),
  },
});
let errorMarker: string | undefined;
const main = async () => {
  const argv = process.argv.slice(2); const profile = path.resolve(valueFor(argv, "--profile"));
  requireDisposablePath(profile, "authority_test_profile_not_disposable");
  const scenario = valueFor(argv, "--scenario");
  const pidMarker = argv.includes("--pid-marker") ? validatedSync(profile, path.resolve(valueFor(argv, "--pid-marker"))) : undefined;
  errorMarker = argv.includes("--error-marker") ? validatedSync(profile, path.resolve(valueFor(argv, "--error-marker"))) : undefined;
  if (pidMarker) writeFileSync(pidMarker, `${process.pid}\n`, { flag: "wx" });
  if (scenario === "runtime-path-smoke") {
    const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    const sync = validatedSync(profile, path.resolve(valueFor(argv, "--sync")));
    await waitForRuntimePathSmokePermit(profile, gate, sync);
    await waitForResume(profile, gate);
    return;
  }
  if (scenario === "api-crash") {
    const child = path.join(path.dirname(fileURLToPath(import.meta.url)), "authorityOpsCrashApiChild.ts");
    await runAuthorityOpsSupervisor(profile, {}, { createApiChildSpec: (plan) => ({ executable: process.execPath, args: [path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs"), child, "--port", String(plan.profile.apiPort)], cwd: plan.apiCommand.cwd }) });
    return;
  }
  if (scenario === "api-spawn-failure") {
    await runAuthorityOpsSupervisor(profile, {}, {
      createApiChildSpec: (plan) => ({
        executable: "definitely-not-a-real-authority-api-executable",
        args: [],
        cwd: plan.apiCommand.cwd,
      }),
    });
    return;
  }
  if (scenario === "signal-shutdown" || scenario === "signal-final-cleanup-lock-release-failure") {
    const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    const signal = waitForResume(profile, gate);
    await runAuthorityOpsSupervisor(profile, {}, {
      ...(scenario === "signal-final-cleanup-lock-release-failure" ? finalCleanupDependencies("lock-release") : {}),
      onChildrenSpawned: () => {
        void signal.then(() => process.emit("SIGINT"));
      },
    });
    return;
  }
  if (scenario === "supervised-child-signals") {
    const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    const signal = waitForResume(profile, gate);
    const root = path.dirname(fileURLToPath(import.meta.url));
    const apiChild = path.join(root, "authorityOpsLifecycleApiChild.ts");
    const viteChild = path.join(root, "authorityOpsSupervisedSignalViteChild.ts");
    const tsxLoader = pathToFileURL(path.join(root, "..", "node_modules", "tsx", "dist", "loader.mjs")).href;
    await runAuthorityOpsSupervisor(profile, {}, {
      createApiChildSpec: (plan) => ({
        executable: process.execPath,
        // Node keeps both --import hooks in this child process. The tsx CLI
        // would launch a second process and lose the supervisor bootstrap.
        args: ["--import", tsxLoader, apiChild, "--port", String(plan.profile.apiPort), "--behavior", "supervised-signal"],
        cwd: plan.apiCommand.cwd,
      }),
      createViteChildSpec: (plan) => ({
        executable: process.execPath,
        args: ["--import", tsxLoader, viteChild, "--port", String(plan.profile.vitePort), "--runtime", path.join(path.dirname(profile), ".authority-ops-runtime")],
        cwd: plan.viteCommand.cwd,
        env: plan.viteEnvironment,
      }),
      onChildrenSpawned: () => {
        void signal.then(() => process.emit("SIGINT"));
      },
    });
    return;
  }
  if (scenario === "startup-interrupt-after-api") {
    await runAuthorityOpsSupervisor(profile, {}, {
      createViteChildSpec: (plan) => {
        process.emit("SIGINT");
        return { ...plan.viteCommand, env: plan.viteEnvironment };
      },
    });
    return;
  }
  if (scenario === "duplicate-interrupt-drain" || scenario === "duplicate-interrupt-final-cleanup") {
    const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    const signal = waitForResume(profile, gate);
    await runAuthorityOpsSupervisor(profile, {}, {
      ...(scenario === "duplicate-interrupt-drain" ? {
        beforeApiShutdownRequest: async () => {
          process.emit("SIGINT");
          process.emit("SIGBREAK");
        },
      } : {
        finalCleanup: {
          closeControl: async (control) => {
            process.emit("SIGINT");
            process.emit("SIGBREAK");
            await control.close();
          },
        },
      }),
      onChildrenSpawned: () => {
        void signal.then(() => process.emit("SIGINT"));
      },
    });
    return;
  }
  const finalCleanupMatch = /^(shutdown-request-race-)?final-cleanup-(control-close|descriptor|lock-release)-failure$/.exec(scenario);
  if (finalCleanupMatch) {
    const race = finalCleanupMatch[1] !== undefined;
    const fault = finalCleanupMatch[2] as "control-close" | "descriptor" | "lock-release";
    const child = race ? path.join(path.dirname(fileURLToPath(import.meta.url)), "authorityOpsLifecycleApiChild.ts") : undefined;
    await runAuthorityOpsSupervisor(profile, {}, {
      ...finalCleanupDependencies(fault),
      ...(race ? {
        createApiChildSpec: (plan) => ({
          executable: process.execPath,
          args: [path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs"), child!, "--port", String(plan.profile.apiPort), "--behavior", "shutdown-request-race"],
          cwd: plan.apiCommand.cwd,
        }),
        beforeApiShutdownRequest: async () => {
          const token = readFileSync(readAuthorityOpsProfile(profile).tokenFilePath, "utf8").trim();
          const apiPort = readAuthorityOpsProfile(profile).apiPort;
          await post(apiPort, "/test-support/race/clean-shutdown", token);
          await waitForListenerClose(apiPort);
        },
      } : {}),
    });
    return;
  }
  if (scenario === "vite-spawn-failure") {
    await runAuthorityOpsSupervisor(profile, {}, {
      createViteChildSpec: (plan) => ({
        executable: "definitely-not-a-real-authority-vite-executable",
        args: [],
        cwd: plan.viteCommand.cwd,
        env: plan.viteEnvironment,
      }),
    });
    return;
  }
  if (scenario === "sqlite-quiescence-failure") {
    await runAuthorityOpsSupervisor(profile, {}, { quiescenceProbe: () => { throw new Error("authority_ops_run_sqlite_not_quiescent"); } }); return;
  }
  if (scenario === "checkpoint-backup-failure") {
    await runAuthorityOpsSupervisor(profile, {}, { checkpointDependencies: { afterSafetyBackup: () => { throw new Error("authority_ops_checkpoint_backup_creation_failed"); } } }); return;
  }
  if (scenario === "checkpoint-verification-failure") {
    await runAuthorityOpsSupervisor(profile, {}, { checkpointDependencies: { afterCandidateVerification: () => { throw new Error("authority_ops_checkpoint_verification_failed"); } } }); return;
  }
  if (scenario === "profile-rotation-failure") {
    await runAuthorityOpsSupervisor(profile, {}, { checkpointDependencies: { afterPreviousProfileBackup: () => { throw new Error("authority_profile_rotation_failed"); } } }); return;
  }
  if (scenario === "checkpoint-acceptance-fence") {
    const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    await runAuthorityOpsSupervisor(profile, {}, {
      checkpointDependencies: {
        afterAcceptanceFences: async (paths) => {
          writeFileSync(requireDisposablePath(`${validatedGate(profile, gate)}.paths`, "disposable_path_identity_changed"), `${JSON.stringify(paths)}\n`, { flag: "wx" });
          await waitForResume(profile, gate);
        },
      },
    });
    return;
  }
  if (scenario === "receipt-without-exit" || scenario === "drain-timeout" || scenario === "drain-success" || scenario === "mutation-lock-hold" || scenario === "rollback-route" || scenario === "shutdown-request-race" || scenario === "shutdown-request-race-failure") {
    const child = path.join(path.dirname(fileURLToPath(import.meta.url)), "authorityOpsLifecycleApiChild.ts");
    const gate = argv.includes("--gate") ? validatedGate(profile, path.resolve(valueFor(argv, "--gate"))) : undefined;
    await runAuthorityOpsSupervisor(profile, {}, {
      apiExitTimeoutMs: scenario === "receipt-without-exit" ? 800 : undefined,
      createApiChildSpec: (plan) => ({
        executable: process.execPath,
        args: [
          path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs"),
          child,
          "--port",
          String(plan.profile.apiPort),
          "--behavior",
          scenario,
          ...(gate ? ["--gate", gate] : []),
        ],
        cwd: plan.apiCommand.cwd,
      }),
      ...((scenario === "shutdown-request-race" || scenario === "shutdown-request-race-failure") ? {
        beforeApiShutdownRequest: async () => {
          const token = readFileSync(readAuthorityOpsProfile(profile).tokenFilePath, "utf8").trim();
          const apiPort = readAuthorityOpsProfile(profile).apiPort;
          await post(apiPort, "/test-support/race/clean-shutdown", token);
          await waitForListenerClose(apiPort);
        },
      } : {}),
    });
    return;
  }
  if (scenario === "vite-exit-observer") {
    const marker = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    await runAuthorityOpsSupervisor(profile, {}, {
      onChildrenSpawned: ({ vite }) => {
        writeFileSync(requireDisposablePath(validatedGate(profile, marker), "disposable_path_identity_changed"), `${JSON.stringify({ pid: vite.pid, expectedTestInjected: true })}\n`, { flag: "wx" });
        vite.once("exit", (code, signal) => {
          writeFileSync(requireDisposablePath(`${validatedGate(profile, marker)}.exit`, "disposable_path_identity_changed"), `${JSON.stringify({ pid: vite.pid, code, signal, expectedTestInjected: true })}\n`, { flag: "wx" });
          if (existsSync(requireDisposablePath(validatedGate(profile, marker), "disposable_path_identity_changed"))) unlinkSync(marker);
        });
      },
    });
    return;
  }
  if (scenario === "post-seal-vite-exit") {
    const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
    const child = path.join(path.dirname(fileURLToPath(import.meta.url)), "authorityOpsLifecycleApiChild.ts");
    await runAuthorityOpsSupervisor(profile, {}, {
      createApiChildSpec: (plan) => ({
        executable: process.execPath,
        args: [
          path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "tsx", "dist", "cli.mjs"),
          child,
          "--port", String(plan.profile.apiPort),
          "--behavior", "drain-success",
          "--gate", gate,
        ],
        cwd: plan.apiCommand.cwd,
      }),
      onChildrenSpawned: ({ vite }) => {
        writeFileSync(requireDisposablePath(`${validatedGate(profile, gate)}.vite`, "disposable_path_identity_changed"), `${JSON.stringify({ pid: vite.pid, expectedTestInjected: true })}\n`, { flag: "wx" });
      },
    });
    return;
  }
  if (scenario === "partial-startup-vite-timeout") {
    await runAuthorityOpsSupervisor(profile, {}, createAuthorityOpsFaultDependencies(scenario, profile));
    return;
  }
  if (scenario !== "receipt-gate") throw new Error("authority_test_scenario_invalid");
  const gate = validatedGate(profile, path.resolve(valueFor(argv, "--gate")));
  const counts = { seal: 0, abort: 0, apiTerminations: 0, viteTerminations: 0 };
  await runAuthorityOpsSupervisor(profile, {}, {
    afterReceiptSeal: () => waitForResume(profile, gate),
    onApiShutdownRequest: (mode) => { counts[mode] += 1; },
    onChildTermination: (kind) => { counts[kind === "api" ? "apiTerminations" : "viteTerminations"] += 1; },
  });
  writeFileSync(requireDisposablePath(`${validatedGate(profile, gate)}.counts`, "disposable_path_identity_changed"), `${JSON.stringify(counts)}\n`, { flag: "wx" });
};
main().catch((error) => {
  const message = error instanceof Error ? error.message : "authority_test_runner_failed";
  if (errorMarker) writeFileSync(errorMarker, `${message}\n`, { flag: "wx" });
  console.error(message);
  process.exitCode = 1;
});
