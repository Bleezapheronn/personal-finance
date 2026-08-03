import Database from "better-sqlite3";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLocalApiServer } from "./createLocalApiServer.js";

const expect = (condition: unknown, code: string): void => {
  if (!condition) throw new Error(code);
};

const root = mkdtempSync(path.join(os.tmpdir(), "pf-account-image-api-"));
const sqlitePath = path.join(root, "fixture.sqlite");
const imageBytes = Buffer.from("account-image-api-fixture");
const imageBlob = {
  __type: "Blob",
  mimeType: "image/png",
  size: imageBytes.length,
  base64: imageBytes.toString("base64"),
};

try {
  const db = new Database(sqlitePath);
  try {
    db.exec(readFileSync(path.resolve("schema", "prototype-schema.sql"), "utf8"));
    db.prepare(
      `INSERT INTO accounts (
        id, name, description, currency, imageBlob, imageMimeType, isActive,
        isCredit, creditLimit, createdAt, updatedAt
      ) VALUES (1, 'API Fixture', NULL, 'KES', NULL, NULL, 1, 0, NULL, ?, ?)`,
    ).run("2026-07-01T00:00:00.000Z", "2026-07-01T00:00:00.000Z");
  } finally {
    db.close();
  }

  const server = createLocalApiServer({
    apiVersion: "test",
    serviceName: "test",
    serviceMode: "prototype",
    getSqlitePath: () => sqlitePath,
    registerAuthentication: () => undefined,
    registerAutomaticBackups: () => undefined,
  });
  await server.ready();
  try {
    const emptyDry = await server.inject({
      method: "POST",
      url: "/prototype/repositories/accounts/images/dry-run/set",
      payload: {
        accountId: 1,
        imageBlob: {
          __type: "Blob",
          mimeType: "image/png",
          size: 0,
          base64: "",
        },
      },
    });
    expect(emptyDry.statusCode === 400 && emptyDry.json().code === "account_image_empty", "image_api_empty_dry_run_accepted");

    const dry = await server.inject({
      method: "POST",
      url: "/prototype/repositories/accounts/images/dry-run/set",
      payload: { accountId: 1, imageBlob },
    });
    const dryJson = dry.json() as { planFingerprint?: unknown };
    expect(dry.statusCode === 200 && typeof dryJson.planFingerprint === "string", "image_api_dry_run_failed");
    expect(!dry.body.includes(imageBlob.base64), "image_api_dry_run_leaked_bytes");
    const stale = await server.inject({
      method: "POST",
      url: "/prototype/repositories/accounts/images/write/set",
      payload: {
        accountId: 1,
        imageBlob,
        dryRunReviewed: true,
        confirmation: "set account image in local sqlite",
        expectedPlanFingerprint: "0".repeat(64),
      },
    });
    expect(stale.statusCode === 409 && stale.json().code === "account_image_plan_stale", "image_api_stale_plan_not_refused");
    const write = await server.inject({
      method: "POST",
      url: "/prototype/repositories/accounts/images/write/set",
      payload: {
        accountId: 1,
        imageBlob,
        dryRunReviewed: true,
        confirmation: "set account image in local sqlite",
        expectedPlanFingerprint: dryJson.planFingerprint,
      },
    });
    expect(write.statusCode === 200 && write.json().sqliteMutated === true, "image_api_write_failed");
    const read = await server.inject({ method: "GET", url: "/prototype/repositories/accounts/1/image" });
    expect(read.statusCode === 200 && read.headers["content-type"] === "image/png" && read.headers["cache-control"] === "no-store" && read.rawPayload.equals(imageBytes), "image_api_readback_failed");
    const removeDry = await server.inject({
      method: "POST",
      url: "/prototype/repositories/accounts/images/dry-run/remove",
      payload: { accountId: 1 },
    });
    const removeDryJson = removeDry.json() as { planFingerprint?: unknown };
    expect(removeDry.statusCode === 200 && typeof removeDryJson.planFingerprint === "string", "image_api_remove_dry_run_failed");
    const remove = await server.inject({
      method: "POST",
      url: "/prototype/repositories/accounts/images/write/remove",
      payload: {
        accountId: 1,
        dryRunReviewed: true,
        confirmation: "remove account image in local sqlite",
        expectedPlanFingerprint: removeDryJson.planFingerprint,
      },
    });
    expect(remove.statusCode === 200 && remove.json().sqliteMutated === true, "image_api_remove_failed");
    const missing = await server.inject({ method: "GET", url: "/prototype/repositories/accounts/1/image" });
    expect(missing.statusCode === 404 && missing.json().code === "account_image_not_found", "image_api_missing_read_invalid");
  } finally {
    await server.close();
  }
  console.log("Account image mutation API tests: PASS");
} finally {
  rmSync(root, { recursive: true, force: true });
}
