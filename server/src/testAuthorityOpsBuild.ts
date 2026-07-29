import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runConditionalAuthorityBuild } from "./lib/authorityOpsBuild.js";

const root = mkdtempSync(path.join(os.tmpdir(), "pf-authority-build-"));
const receiptPath = path.join(root, "runtime", "build-receipt.json");
let testLinkEntries: Record<string, string> = {};
let testAfterLinkResolved: ((logicalPath: string) => void) | undefined;
let assertions = 0;
const check = (condition: unknown, code: string) => {
  assertions += 1;
  if (!condition) throw new Error(code);
};
const write = (relative: string, contents: string) => {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf8");
};
const run = (calls: string[], fail?: "server" | "root") => (target: "server" | "root") => {
  calls.push(target);
  if (target === fail) throw new Error(`simulated_${target}_build_failure`);
};
const execute = (calls: string[], fail?: "server" | "root") =>
  runConditionalAuthorityBuild(receiptPath, {
    repositoryRoot: root,
    testLinkEntries,
    testAfterLinkResolved,
    npmVersion: "test",
    run: run(calls, fail),
  });
const expectFailure = (action: () => unknown, code: string) => {
  let observed = "";
  try { action(); } catch (error) { observed = error instanceof Error ? error.message : ""; }
  check(observed === code, `${code}_not_observed`);
};

try {
  write("src/main.tsx", "export const app = 1;\n");
  write("index.html", "<div id=\"root\"></div>\n");
  write(".browserslistrc", "defaults\n");
  write("public/manifest.json", "{\"name\":\"Personal Finance\"}\n");
  write("package.json", "{\"name\":\"fixture\"}\n");
  write("package-lock.json", "{\"lockfileVersion\":3}\n");
  write("tsconfig.json", "{}\n");
  write("tsconfig.node.json", "{}\n");
  write("vite.config.ts", "export default {};\n");
  write("server/src/index.ts", "export {};\n");
  write("server/package.json", "{\"name\":\"fixture-server\"}\n");
  write("server/package-lock.json", "{\"lockfileVersion\":3}\n");
  write("server/tsconfig.json", "{}\n");

  const first: string[] = [];
  const initial = execute(first);
  check(initial.serverBuilt && initial.rootBuilt && first.join(",") === "server,root", "first_build_gate_failed");
  const unchanged: string[] = [];
  const skip = execute(unchanged);
  check(!skip.serverBuilt && !skip.rootBuilt && unchanged.length === 0, "unchanged_build_not_skipped");

  write(".browserslistrc", "last 1 Chrome version\n");
  const browserslistModified: string[] = [];
  check(execute(browserslistModified).rootBuilt && browserslistModified.join(",") === "root", "browserslist_modify_not_fingerprinted");
  unlinkSync(path.join(root, ".browserslistrc"));
  const browserslistDeleted: string[] = [];
  check(execute(browserslistDeleted).rootBuilt && browserslistDeleted.join(",") === "root", "browserslist_delete_not_fingerprinted");
  write(".browserslistrc", "defaults\n");
  const browserslistRecreated: string[] = [];
  check(execute(browserslistRecreated).rootBuilt && browserslistRecreated.join(",") === "root", "browserslist_recreate_not_fingerprinted");

  write("index.html", "<main id=\"root\"></main>\n");
  const indexChanged: string[] = [];
  const indexBuild = execute(indexChanged);
  check(!indexBuild.serverBuilt && indexBuild.rootBuilt && indexChanged.join(",") === "root", "index_html_not_fingerprinted");

  write("public/new-static.json", "{\"version\":1}\n");
  const publicAdded: string[] = [];
  check(execute(publicAdded).rootBuilt && publicAdded.join(",") === "root", "public_add_not_fingerprinted");
  write("public/new-static.json", "{\"version\":2}\n");
  const publicModified: string[] = [];
  check(execute(publicModified).rootBuilt && publicModified.join(",") === "root", "public_modify_not_fingerprinted");
  unlinkSync(path.join(root, "public", "new-static.json"));
  const publicDeleted: string[] = [];
  check(execute(publicDeleted).rootBuilt && publicDeleted.join(",") === "root", "public_delete_not_fingerprinted");

  write("server/src/index.ts", "export const server = 2;\n");
  const serverOnly: string[] = [];
  const serverBuild = execute(serverOnly);
  check(serverBuild.serverBuilt && !serverBuild.rootBuilt && serverOnly.join(",") === "server", "server_only_ran_root_build");

  write("runtime/financial-data.json", "{\"rows\":[1]}\n");
  const financialData: string[] = [];
  const financialBuild = execute(financialData);
  check(!financialBuild.serverBuilt && !financialBuild.rootBuilt && financialData.length === 0, "financial_data_triggered_build");

  write("src/link-target.ts", "export const linked = 1;\n");
  write("src/linked.ts", "virtual link placeholder\n");
  testLinkEntries = { "src/linked.ts": "link-target.ts" };
  const linkedFileCreated: string[] = [];
  check(execute(linkedFileCreated).rootBuilt && linkedFileCreated.join(",") === "root", "linked_file_create_not_fingerprinted");
  write("src/link-target.ts", "export const linked = 2;\n");
  const linkedFileChanged: string[] = [];
  check(execute(linkedFileChanged).rootBuilt && linkedFileChanged.join(",") === "root", "linked_target_change_not_fingerprinted");
  write("src/link-target-alternate.ts", "export const linked = 2;\n");
  testLinkEntries = { "src/linked.ts": "link-target-alternate.ts" };
  const linkedFileRetargeted: string[] = [];
  check(execute(linkedFileRetargeted).rootBuilt && linkedFileRetargeted.join(",") === "root", "linked_file_retarget_not_fingerprinted");
  unlinkSync(path.join(root, "src", "linked.ts"));
  testLinkEntries = {};
  const linkedFileDeleted: string[] = [];
  check(execute(linkedFileDeleted).rootBuilt && linkedFileDeleted.join(",") === "root", "linked_file_delete_not_fingerprinted");

  write("src/type-target", "file\n");
  write("src/type-link", "virtual type link placeholder\n");
  testLinkEntries = { "src/type-link": "type-target" };
  const typeFile: string[] = [];
  check(execute(typeFile).rootBuilt && typeFile.join(",") === "root", "linked_target_file_not_fingerprinted");
  unlinkSync(path.join(root, "src", "type-target"));
  write("src/type-target/nested.txt", "directory\n");
  const typeDirectory: string[] = [];
  check(execute(typeDirectory).rootBuilt && typeDirectory.join(",") === "root", "linked_target_type_change_not_fingerprinted");
  unlinkSync(path.join(root, "src", "type-link"));
  testLinkEntries = {};

  write("src/duplicate-target.ts", "duplicate\n");
  write("src/duplicate-one.ts", "virtual duplicate placeholder\n");
  write("src/duplicate-two.ts", "virtual duplicate placeholder\n");
  testLinkEntries = { "src/duplicate-one.ts": "duplicate-target.ts", "src/duplicate-two.ts": "duplicate-target.ts" };
  const duplicateLinks: string[] = [];
  check(execute(duplicateLinks).rootBuilt && duplicateLinks.join(",") === "root", "duplicate_logical_links_not_fingerprinted");
  unlinkSync(path.join(root, "src", "duplicate-one.ts"));
  unlinkSync(path.join(root, "src", "duplicate-two.ts"));
  testLinkEntries = {};

  write("public/assets-source/one.txt", "one\n");
  write("public/linked-assets", "virtual linked directory placeholder\n");
  testLinkEntries = { "public/linked-assets": "assets-source" };
  const linkedDirectoryCreated: string[] = [];
  check(execute(linkedDirectoryCreated).rootBuilt && linkedDirectoryCreated.join(",") === "root", "linked_directory_create_not_fingerprinted");
  write("public/assets-source/two.txt", "two\n");
  const linkedDirectoryAdded: string[] = [];
  check(execute(linkedDirectoryAdded).rootBuilt && linkedDirectoryAdded.join(",") === "root", "linked_directory_add_not_fingerprinted");
  unlinkSync(path.join(root, "public", "assets-source", "two.txt"));
  const linkedDirectoryDeleted: string[] = [];
  check(execute(linkedDirectoryDeleted).rootBuilt && linkedDirectoryDeleted.join(",") === "root", "linked_directory_delete_not_fingerprinted");
  unlinkSync(path.join(root, "public", "linked-assets"));
  testLinkEntries = {};

  write("public/junction-source/one.txt", "one\n");
  const junction = path.join(root, "public", "linked-junction");
  symlinkSync(path.join(root, "public", "junction-source"), junction, "junction");
  const junctionCreated: string[] = [];
  check(execute(junctionCreated).rootBuilt && junctionCreated.join(",") === "root", "junction_create_not_fingerprinted");
  write("public/junction-source/one.txt", "changed\n");
  const junctionChanged: string[] = [];
  check(execute(junctionChanged).rootBuilt && junctionChanged.join(",") === "root", "junction_target_change_not_fingerprinted");
  write("public/junction-alternate/two.txt", "two\n");
  rmSync(junction, { recursive: true, force: true });
  symlinkSync(path.join(root, "public", "junction-alternate"), junction, "junction");
  const junctionRetargeted: string[] = [];
  check(execute(junctionRetargeted).rootBuilt && junctionRetargeted.join(",") === "root", "junction_retarget_not_fingerprinted");
  rmSync(junction, { recursive: true, force: true });
  const junctionDeleted: string[] = [];
  check(execute(junctionDeleted).rootBuilt && junctionDeleted.join(",") === "root", "junction_delete_not_fingerprinted");

  const receiptBeforeUnsafeLink = readFileSync(receiptPath, "utf8");
  const external = mkdtempSync(path.join(os.tmpdir(), "pf-authority-build-external-"));
  try {
    writeFileSync(path.join(external, "external.ts"), "export const outside = true;\n", "utf8");
    write("src/external.ts", "virtual external link placeholder\n");
    testLinkEntries = { "src/external.ts": path.join(external, "external.ts") };
    expectFailure(() => execute([]), "build_input_link_outside_root");
    check(readFileSync(receiptPath, "utf8") === receiptBeforeUnsafeLink, "external_link_replaced_receipt");
    unlinkSync(path.join(root, "src", "external.ts"));
    testLinkEntries = {};
    const externalDirectory = path.join(root, "public", "external-directory");
    symlinkSync(external, externalDirectory, "junction");
    expectFailure(() => execute([]), "build_input_link_outside_root");
    check(readFileSync(receiptPath, "utf8") === receiptBeforeUnsafeLink, "external_directory_link_replaced_receipt");
    rmSync(externalDirectory, { recursive: true, force: true });
  } finally { rmSync(external, { recursive: true, force: true }); }
  write("dist/not-an-input.ts", "output\n");
  write("src/output-link.ts", "virtual output link placeholder\n");
  testLinkEntries = { "src/output-link.ts": "../dist/not-an-input.ts" };
  expectFailure(() => execute([]), "build_input_link_outside_root");
  unlinkSync(path.join(root, "src", "output-link.ts"));
  testLinkEntries = {};
  write("src/dangling.ts", "virtual dangling link placeholder\n");
  testLinkEntries = { "src/dangling.ts": "missing-target.ts" };
  expectFailure(() => execute([]), "build_input_link_dangling");
  check(readFileSync(receiptPath, "utf8") === receiptBeforeUnsafeLink, "dangling_link_replaced_receipt");
  unlinkSync(path.join(root, "src", "dangling.ts"));
  testLinkEntries = {};
  write("src/cycle", "virtual cycle link placeholder\n");
  testLinkEntries = { "src/cycle": "." };
  expectFailure(() => execute([]), "build_input_link_cycle");
  check(readFileSync(receiptPath, "utf8") === receiptBeforeUnsafeLink, "cycle_link_replaced_receipt");
  unlinkSync(path.join(root, "src", "cycle"));
  testLinkEntries = {};

  write("src/race-target.ts", "one\n");
  write("src/race-alternate.ts", "two\n");
  write("src/race-link.ts", "virtual race link placeholder\n");
  testLinkEntries = { "src/race-link.ts": "race-target.ts" };
  const raceBaseline: string[] = [];
  check(execute(raceBaseline).rootBuilt && raceBaseline.join(",") === "root", "race_link_baseline_not_fingerprinted");
  const receiptBeforeRace = readFileSync(receiptPath, "utf8");
  testAfterLinkResolved = (logicalPath) => { if (logicalPath === "src/race-link.ts") testLinkEntries["src/race-link.ts"] = "race-alternate.ts"; };
  expectFailure(() => execute([]), "build_input_identity_failed");
  check(readFileSync(receiptPath, "utf8") === receiptBeforeRace, "race_link_replaced_receipt");
  testAfterLinkResolved = undefined;
  unlinkSync(path.join(root, "src", "race-link.ts"));
  testLinkEntries = {};

  write("index.html", "<section id=\"root\"></section>\n");
  const beforeFailure = readFileSync(receiptPath, "utf8");
  try { execute([], "root"); } catch { /* expected */ }
  check(readFileSync(receiptPath, "utf8") === beforeFailure, "failed_root_build_replaced_receipt");
  const requiredAgain: string[] = [];
  check(execute(requiredAgain).rootBuilt && requiredAgain.join(",") === "root", "failed_root_build_allowed_startup_receipt");

  console.log(`Authority conditional build receipt test: ${assertions} passed, 0 failed`);
} finally { rmSync(root, { recursive: true, force: true }); }
