export const runRegisteredChecks = (checks: readonly (() => void)[]): number => {
  let passed = 0;
  for (const check of checks) {
    check();
    passed += 1;
  }
  return passed;
};
