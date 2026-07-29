import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "server", "test-support");
const executables = readdirSync(directory).filter((name) => /^(authority.*(?:Child|Holder|Writer|Runner)\.ts)$/.test(name));
const sensitive = /(?:new Database|readFileSync|readFile\(|listen\(|spawn\(|execFile|mkdirSync|acquireCheckpoint)/;
const inspect = (name, source) => {
  const executableSource = source.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("import ")).join("\n");
  const importAt = source.indexOf("./authorityDisposableIdentity.js");
  const validationAt = executableSource.indexOf("requireDisposablePath(");
  const sensitiveAt = executableSource.search(sensitive);
  if (importAt < 0 || validationAt < 0 || (sensitiveAt >= 0 && validationAt > sensitiveAt)) throw new Error(`${name}: validator must precede sensitive work`);
  if (/relative\(path\.resolve\(os\.tmpdir\(\)/.test(source)) throw new Error(`${name}: lexical temp validator remains`);
  if (name === "authorityOpsFaultRunner.ts" || name.startsWith("fault-runner")) {
    for (const required of ["validatedGate", "validatedSync", "requireDisposablePath(`${gatePath}.ready`", "requireDisposablePath(`${gatePath}.resume`", "requireDisposablePath(`${sync}.validated`", "validatedGate(profilePath, gate)"]) {
      if (!source.includes(required)) throw new Error(`${name}: independently supplied or derived path lacks identity validation`);
    }
    if (/path\.dirname\(gate\) !== path\.join\(path\.dirname\(profile\)/.test(source)) throw new Error(`${name}: lexical gate-parent check remains`);
  }
};
for (const name of executables) inspect(name, readFileSync(path.join(directory, name), "utf8"));
let rejected = 0;
const runnerSource = readFileSync(path.join(directory, "authorityOpsFaultRunner.ts"), "utf8");
for (const [name, source] of [["unsafe.ts", 'new Database("x");\nrequireDisposablePath("x");'], ["lexical.ts", 'const x = path.relative(path.resolve(os.tmpdir()), value);\nrequireDisposablePath(value);'], ["fault-runner-gate.ts", 'const validatedGate = () => gate;\nwriteFileSync(gate, "x");'], ["fault-runner-receipt.ts", 'const validatedGate = () => gate;\nconst validatedSync = () => sync;\nreadFileSync(receipt);'], ["fault-runner-unrelated.ts", 'const validatedGate = () => gate;\nconst validatedSync = () => sync;\nconst receipt = path.join(runtime, "receipt");\nwriteFileSync(receipt, "x");']]) {
  try { inspect(name, source); throw new Error("secondary_path_unvalidated"); } catch { rejected += 1; }
}
if (rejected !== 5) throw new Error("validator guard self-test failed");
inspect("fault-runner-corrected.ts", runnerSource);
console.log(`Authority test-support path-validation guard: PASS (${executables.length} executables; 5 unsafe fixtures rejected)`);
