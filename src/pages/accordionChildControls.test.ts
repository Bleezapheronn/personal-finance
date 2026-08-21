import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("Accordion child controls", () => {
  const transactions = source("src/pages/Transactions.tsx");
  const buckets = source("src/pages/BucketsManagement.tsx");
  const bucketStyles = source("src/pages/BucketsManagement.css");

  it("keeps applied filter chips independently operable", () => {
    expect(transactions).toContain("onClickCapture={(e) => {");
    expect(transactions).toContain("role=\"button\"");
    expect(transactions).toContain("tabIndex={0}");
    expect(transactions).toContain('e.key === "Enter" || e.key === " "');
    expect(transactions).toContain("clearIndividualFilter(chip.filterName);");
  });

  it("isolates Bucket action clicks and indents only Category labels", () => {
    expect(buckets).toContain('className="bucket-header-actions"');
    expect(buckets).toContain("onClickCapture={(event) => {");
    expect(buckets).toContain("data-bucket-header-action=\"add\"");
    expect(buckets).toContain("data-bucket-header-action=\"edit\"");
    expect(buckets).toContain('action === "toggle-active"');
    expect(buckets).toContain('action === "delete"');
    expect(buckets).toContain("setShowCategoryModal(true);");
    expect(buckets).toContain("setShowBucketModal(true);");
    expect(buckets).toContain("toggleBucketActive(b);");
    expect(buckets).toContain("initiateBucketDelete(b);");
    expect(buckets).toContain('className="bucket-category-list"');
    expect(bucketStyles).toContain(
      ".bucket-category-list > ion-item > ion-label {",
    );
    expect(bucketStyles).toContain("margin-inline-start: 2.5rem;");
    expect(bucketStyles).not.toContain(".bucket-category-list {\n  margin-inline-start");
  });
});
