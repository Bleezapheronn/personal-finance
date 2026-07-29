/**
 * Loaded only through Node's --import option for children owned by the unified
 * authority supervisor.  Those children share the foreground Windows console,
 * so they must not apply the default Ctrl+C exit while the supervisor performs
 * the authenticated lifecycle shutdown.
 */
export const AUTHORITY_SUPERVISED_CHILD_ENV =
  "PERSONAL_FINANCE_AUTHORITY_SUPERVISED_CHILD" as const;

if (process.env[AUTHORITY_SUPERVISED_CHILD_ENV] === "true") {
  const ignoreInheritedConsoleSignal = () => undefined;
  process.on("SIGINT", ignoreInheritedConsoleSignal);
  process.on("SIGBREAK", ignoreInheritedConsoleSignal);
}
