import os from "node:os";
import path from "node:path";
import { createAuthorityOpsFaultDependencies } from "./authorityOpsFaultDependencies.js";
const profile = path.join(os.tmpdir(), "pf-fault-dependency-test", "authority-profile.json");
const dependency = createAuthorityOpsFaultDependencies("partial-startup-vite-timeout", profile);
const spec = dependency.createViteChildSpec?.({ viteCommand: { cwd: "C:\\temp" } } as never);
if (!spec || spec.executable !== process.execPath || !spec.args.some((value) => value.endsWith("authorityOpsNeverReadyViteChild.ts")) || Object.keys(spec.env).some((key) => key !== "SystemRoot" && key !== "PATH")) throw new Error("fault_dependency_mapping_invalid");
for (const scenario of ["api-crash", "receipt-gate", "sqlite-quiescence-failure"]) if (createAuthorityOpsFaultDependencies(scenario, profile).createViteChildSpec) throw new Error("other_scenario_selected_never_ready_vite");
for (const scenario of ["", " ", "PARTIAL-STARTUP-VITE-TIMEOUT", "partial-startup", "../partial-startup-vite-timeout", "cmd /c test"]) { let rejected = false; try { createAuthorityOpsFaultDependencies(scenario, profile); } catch { rejected = true; } if (!rejected) throw new Error("malformed_scenario_accepted"); }
for (const unsafeProfile of ["", "relative.json", "C:\\dev\\personal-finance\\runtime\\p.json", "C:\\dev\\personal-finance-data\\p.json", "C:\\dev\\personal-finance-data\\activation-20260723-160032\\profiles\\authoritative-profile.json"]) { let rejected = false; try { createAuthorityOpsFaultDependencies("partial-startup-vite-timeout", unsafeProfile); } catch { rejected = true; } if (!rejected) throw new Error("unsafe_profile_accepted"); }
const first = createAuthorityOpsFaultDependencies("partial-startup-vite-timeout", profile); const second = createAuthorityOpsFaultDependencies("partial-startup-vite-timeout", profile);
if (first === second || first.createViteChildSpec === second.createViteChildSpec) throw new Error("dependency_factory_shared_state");
console.log("Authority fault dependency module tests: PASS");
