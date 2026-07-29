import { runRegisteredChecks } from "./lib/authorityTestChecks.js";

const twoChecks = runRegisteredChecks([
  () => { if (1 + 1 !== 2) throw new Error("first_registered_check_failed"); },
  () => { if ("authority".length === 0) throw new Error("second_registered_check_failed"); },
]);
const threeChecks = runRegisteredChecks([
  () => { if (1 + 1 !== 2) throw new Error("first_registered_check_failed"); },
  () => { if ("authority".length === 0) throw new Error("second_registered_check_failed"); },
  () => { if ("runtime".length !== 7) throw new Error("added_registered_check_failed"); },
]);
if (Number(twoChecks) !== 2 || Number(threeChecks) !== 3 || Number(twoChecks) === Number(threeChecks)) {
  throw new Error("registered_check_count_not_derived");
}
console.log(`Authority registered-check count test: ${twoChecks} then ${threeChecks} passed, 0 failed`);
