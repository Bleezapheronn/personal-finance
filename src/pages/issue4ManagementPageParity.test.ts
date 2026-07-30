import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Issue #4 management-page presentation", () => {
  const accounts = source("src/pages/AccountsManagement.tsx");
  const buckets = source("src/pages/BucketsManagement.tsx");
  const recipients = source("src/pages/RecipientsManagement.tsx");
  const templates = source("src/pages/SmsImportTemplatesManagement.tsx");

  it("keeps migration-era presentation out of the normal management pages", () => {
    for (const page of [accounts, buckets, recipients, templates]) {
      expect(page).not.toMatch(/verified SQLite|selected-read preview|read-only experiment/i);
      expect(page).not.toMatch(/rotate the (authority )?checkpoint/i);
    }
  });

  it("keeps ordinary account and bucket/category controls without merge UI", () => {
    expect(accounts).toContain("title=\"Edit Account\"");
    expect(accounts).toContain("title=\"Delete unused Account\"");
    expect(accounts).not.toContain("Merge Account");
    expect(buckets).toContain("title=\"Add Category\"");
    expect(buckets).toContain("onIonItemReorder={handleReorderBuckets}");
    expect(buckets).not.toContain("Merge Bucket");
    expect(buckets).not.toContain("Merge Category");
  });

  it("retains recipient batch duplicate consolidation but no manual row merge", () => {
    expect(recipients).toContain("Duplicate Recipient Pair");
    expect(recipients).toContain("<MergeRecipientsModal");
    expect(recipients).not.toContain("Merge Recipient");
    expect(recipients).not.toContain("openSqliteMerge");
  });

  it("shows the deliberately deferred product actions without enabling workflows", () => {
    const accountForm = source("src/components/AddAccountModal.tsx");
    expect(accountForm).toContain("Change image unavailable");
    expect(accountForm).toContain("Account image editing is not available yet.");
    expect(accountForm).not.toContain("db.accounts.");
    expect(templates).toContain("Test parse unavailable");
    expect(templates).toContain("Import SMS unavailable");
    expect(templates).toContain("Test parsing and SMS import are not available yet.");
  });
});
