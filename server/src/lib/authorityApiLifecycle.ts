import type { FastifyInstance } from "fastify";
import {
  AuthorityMutationTracker,
  type AuthoritySessionContext,
  type SealedAuthoritySessionReceipt,
} from "./authorityOpsSession.js";
import type { AuthorityMutationProof } from "./authorityMutationExecutor.js";

export type AuthorityShutdownMode = "seal" | "abort";
export type AuthorityApiLifecycleState =
  | "running"
  | "seal-requested"
  | "abort-requested"
  | "draining"
  | "server-closed"
  | "database-closed"
  | "receipt-written"
  | "exited"
  | "failed";

export interface AuthorityApiShutdownResult {
  mode: AuthorityShutdownMode;
  ok: boolean;
  code: "clean_shutdown_complete" | "abort_shutdown_complete" | "api_drain_timeout" |
    "api_close_failed" | "database_close_failed" | "clean_receipt_missing" |
    "shutdown_logical_fingerprint_mismatch" | "mutation_lock_timeout" |
    "mutation_fingerprint_failed";
}

export interface AuthorityApiLifecycleDependencies {
  drainTimeoutMs?: number;
  afterReceiptWritten?: (receipt: SealedAuthoritySessionReceipt) => Promise<void>;
  onComplete?: (result: AuthorityApiShutdownResult) => void;
}

const bounded = async <T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export class AuthorityApiLifecycle {
  private state: AuthorityApiLifecycleState = "running";
  private mode: AuthorityShutdownMode | undefined;
  private started = false;
  private completion: Promise<void> | undefined;

  constructor(
    private readonly server: FastifyInstance,
    private readonly tracker: AuthorityMutationTracker,
    private readonly context: AuthoritySessionContext,
    private readonly secret: string,
    private readonly sqlitePath: string,
    private readonly finalizeMutationProof: () => Promise<AuthorityMutationProof>,
    private readonly closeDatabases: () => void,
    private readonly dependencies: AuthorityApiLifecycleDependencies = {},
  ) {}

  currentState(): AuthorityApiLifecycleState {
    return this.state;
  }

  request(mode: AuthorityShutdownMode): {
    accepted: boolean;
    mode: AuthorityShutdownMode;
    state: AuthorityApiLifecycleState;
  } {
    if (!this.mode) {
      this.mode = mode;
      this.state = mode === "seal" ? "seal-requested" : "abort-requested";
      this.tracker.stopAccepting();
      return { accepted: true, mode, state: this.state };
    }
    return { accepted: false, mode: this.mode, state: this.state };
  }

  start(): Promise<void> {
    if (this.started) return this.completion ?? Promise.resolve();
    this.started = true;
    this.completion = this.run();
    return this.completion;
  }

  private async run(): Promise<void> {
    const mode = this.mode;
    if (!mode) return;
    try {
      this.state = "draining";
      const drainTimeout = this.dependencies.drainTimeoutMs ?? 10_000;
      await bounded(
        Promise.all([
          this.server.close(),
          this.tracker.waitForDrain(drainTimeout),
        ]),
        drainTimeout,
        "api_drain_timeout",
      );
      this.state = "server-closed";
      if (mode === "abort") {
        try {
          this.closeDatabases();
        } catch {
          throw new Error("database_close_failed");
        }
        this.state = "database-closed";
        this.state = "exited";
        this.dependencies.onComplete?.({
          mode,
          ok: false,
          code: "abort_shutdown_complete",
        });
        return;
      }
      let proof: AuthorityMutationProof;
      try {
        proof = await this.finalizeMutationProof();
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (
          message === "shutdown_logical_fingerprint_mismatch" ||
          message === "mutation_lock_timeout" ||
          message === "mutation_fingerprint_failed"
        ) throw error;
        throw new Error("shutdown_logical_fingerprint_mismatch");
      }
      try {
        this.closeDatabases();
      } catch {
        throw new Error("database_close_failed");
      }
      this.state = "database-closed";

      const receipt = this.tracker.writeStoppedReceipt(
        this.context,
        this.secret,
        this.sqlitePath,
        proof,
      );
      this.state = "receipt-written";
      await this.dependencies.afterReceiptWritten?.(receipt);
      this.state = "exited";
      this.dependencies.onComplete?.({
        mode,
        ok: true,
        code: "clean_shutdown_complete",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "api_close_failed";
      const code: AuthorityApiShutdownResult["code"] =
        message === "api_drain_timeout" || message === "database_close_failed" ||
        message === "clean_receipt_missing" ||
        message === "shutdown_logical_fingerprint_mismatch" ||
        message === "mutation_lock_timeout" ||
        message === "mutation_fingerprint_failed"
          ? message
          : "api_close_failed";
      this.state = "failed";
      try {
        this.server.server.closeAllConnections();
        this.closeDatabases();
      } catch {
        // The stable lifecycle result remains fail-closed.
      }
      this.dependencies.onComplete?.({ mode, ok: false, code });
    }
  }
}
