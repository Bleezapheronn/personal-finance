import {
  AUTHORITY_SESSION_CONTEXT_ENV,
  AUTHORITY_SESSION_ID_ENV,
  AUTHORITY_SESSION_SECRET_ENV,
  type AuthoritySessionContext,
} from "./authorityOpsSession.js";
import type { AuthorityOpsStartPlan } from "./authorityOps.js";

export interface AuthorityApiChildPlanInputs {
  startPlan: Pick<AuthorityOpsStartPlan, "apiCommand" | "apiEnvironment">;
  sessionContext: AuthoritySessionContext;
  sessionSecret: string;
}

export interface AuthorityApiChildPlan {
  sessionContext: AuthoritySessionContext;
  sessionSecret: string;
  environment: NodeJS.ProcessEnv;
  childSpec: { executable: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv };
}

/** Pure composition of a verified start plan and once-generated session evidence. */
export const createAuthorityApiChildPlan = (inputs: AuthorityApiChildPlanInputs): AuthorityApiChildPlan => {
  const environment: NodeJS.ProcessEnv = {
    ...inputs.startPlan.apiEnvironment,
    [AUTHORITY_SESSION_ID_ENV]: inputs.sessionContext.sessionId,
    [AUTHORITY_SESSION_SECRET_ENV]: inputs.sessionSecret,
    [AUTHORITY_SESSION_CONTEXT_ENV]: JSON.stringify(inputs.sessionContext),
  };
  return {
    sessionContext: inputs.sessionContext,
    sessionSecret: inputs.sessionSecret,
    environment,
    childSpec: { ...inputs.startPlan.apiCommand, env: environment },
  };
};
