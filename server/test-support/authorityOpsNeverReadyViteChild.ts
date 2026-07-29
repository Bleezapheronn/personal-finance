import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireDisposablePath } from "./authorityDisposableIdentity.js";

const value = (flag: string) => {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
};
const runtime = value("--runtime");
if (!runtime || !path.isAbsolute(runtime)) process.exit(2);
try { requireDisposablePath(runtime ?? "", "authority_test_runtime_not_disposable"); } catch { process.exit(2); }
if (existsSync(path.join(runtime, "authority-profile.json"))) process.exit(2);
setInterval(() => undefined, 1_000);
