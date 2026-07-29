import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { serverRoot } from "./paths.js";
import { AUTHORITY_SUPERVISED_CHILD_ENV } from "./authoritySupervisedChildSignal.js";

export interface AuthoritySupervisedChildSpec {
  executable: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

const supervisedSignalBootstrapPath = () =>
  path.join(serverRoot, "dist", "lib", "authoritySupervisedChildSignal.js");

/** Adds signal ownership only to children started by the unified supervisor. */
export const superviseAuthorityChildSpec = (
  spec: AuthoritySupervisedChildSpec,
): AuthoritySupervisedChildSpec => {
  const bootstrapPath = supervisedSignalBootstrapPath();
  if (!existsSync(bootstrapPath)) {
    throw new Error("authority_ops_supervised_child_bootstrap_missing");
  }
  return {
    ...spec,
    args: ["--import", pathToFileURL(bootstrapPath).href, ...spec.args],
    env: {
      ...spec.env,
      [AUTHORITY_SUPERVISED_CHILD_ENV]: "true",
    },
  };
};
