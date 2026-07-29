import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = () => readdirSync(os.tmpdir()).filter((name) => name.startsWith("pf-api-child-fixture-")).sort().join("\n");
const before = fixtures();
const imported = await import("./authorityApiChildFixture.js");
const after = fixtures();
if (before !== after || typeof imported.createDisposableAuthorityApiChildFixture !== "function") throw new Error("authority_api_child_fixture_import_side_effect");
const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "authorityApiChildFixture.ts"), "utf8");
const factoryAt = source.indexOf("createDisposableAuthorityApiChildFixture");
if (factoryAt < 0 || /(?:mkdtempSync|availablePort|new Database)\s*\(/.test(source.slice(0, factoryAt))) throw new Error("authority_api_child_fixture_top_level_side_effect");
const smokeSource = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "testAuthorityExecutablePathSmokes.ts"), "utf8");
if (!smokeSource.includes("createDisposableAuthorityApiChildFixture") || /prepareSqliteAuthorityCutover|startingCheckpointId|PERSONAL_FINANCE_SQLITE_CUTOVER_MANIFEST_PATH/.test(smokeSource)) throw new Error("authority_api_child_fixture_duplicate_construction");
console.log("Authority API child fixture import-safety test: PASS");
