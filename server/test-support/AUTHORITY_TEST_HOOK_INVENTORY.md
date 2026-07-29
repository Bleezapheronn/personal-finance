# Authority test-hook inventory

Production entrypoints do not parse scenarios or import this directory. All selectors below exist only in `authorityOpsFaultRunner.ts`, which requires an explicitly supplied profile beneath the operating-system temporary directory and rejects repository and known production-data paths.

| Mechanism | Test-support selector | Explicit dependency boundary | Production behavior when absent |
| --- | --- | --- | --- |
| Valid/missing/malformed receipt interception, fingerprint disagreement, zero-mutation external change | `receipt-gate` | `afterReceiptSeal` | Continue directly to sealed-receipt validation |
| Isolated authenticated API crash | `api-crash` | `createApiChildSpec` | Spawn the fixed production `dist/index.js` API child |
| SQLite quiescence failure | `sqlite-quiescence-failure` | `quiescenceProbe` | Use the real WAL/SHM quiescence result |
| Checkpoint-backup failure | `checkpoint-backup-failure` | `afterSafetyBackup` | Continue to real checkpoint creation |
| Candidate-verification failure | `checkpoint-verification-failure` | `afterCandidateVerification` | Continue after real candidate verification |
| Profile-rotation failure | `profile-rotation-failure` | `afterPreviousProfileBackup` | Atomically replace the active profile |
| Receipt pause/resume markers | `receipt-gate` with explicit disposable gate path | `afterReceiptSeal` closure | No marker path exists or is consulted |
| Crash route extension | `authorityOpsCrashApiChild.ts` | Direct registration on an unstarted disposable API instance | Production builder contains no crash route |
| Held-request / shutdown-exit child | `authorityOpsLifecycleApiChild.ts` | Explicit test-support child behavior argument | Production routes and environment cannot select held requests, drain timing, or receipt-without-exit behavior |
| Exact Vite child observer | `vite-exit-observer` | `onChildrenSpawned` dependency writes a disposable PID marker | Production supervisor writes no child marker and kills no process by image name |
| Separate external SQLite writer | `authorityOpsExternalWriter.ts` | Explicit OS-temp database argument | Refuses non-temp databases and is absent from production imports/scripts |
| Writer-lock hold and rollback/no-op routes | `authorityOpsLifecycleApiChild.ts` | Explicit isolated child behavior | Production API has no held mutation or rollback/no-op test routes |
| Disposable path allowance | Explicit temporary profile supplied to the test runner | Test-runner path validation | Production path validation remains unconditional |

The former Vite-child observer/marker scenario is intentionally not a migrated success mechanism. Production contains no Vite test marker or selector; its future behavior belongs to shutdown remediation.

The production guard scans all `server/src` production TypeScript files, launcher scripts, production package commands, and the production TypeScript configuration. Test files, this directory, and the guard’s own denylist are the only places allowed to name test scenarios or test-support entrypoints.
