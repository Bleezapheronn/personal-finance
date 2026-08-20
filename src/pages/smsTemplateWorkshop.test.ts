import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("SMS template workshop boundary", () => {
  const app = source("src/App.tsx");
  const list = source("src/pages/SmsImportTemplatesManagement.tsx");
  const editor = source("src/pages/SmsImportTemplateEditor.tsx");
  const assistant = source("src/components/SmsTemplateAssistantModal.tsx");

  it("uses dedicated new and edit routes from the management list", () => {
    expect(app).toContain('exact path="/sms-import-templates/new"');
    expect(app).toContain('exact path="/sms-import-templates/:id/edit"');
    expect(list).toContain('history.push("/sms-import-templates/new")');
    expect(list).toContain("/sms-import-templates/${template.id}/edit");
  });

  it("keeps sample actions in template management without Transaction import", () => {
    expect(editor).toContain("Test Sample");
    expect(editor).toContain("Build from Sample");
    expect(editor).toContain("evaluateSmsTemplate(sample, draftTemplate)");
    expect(editor).not.toMatch(
      /SmsImportModal|handleSmsImport|onImport=|localStorage|sessionStorage/,
    );
    expect(editor).toContain("useIonViewWillLeave");
    expect(editor).toContain('setSample("")');
    expect(list).not.toContain("Import SMS");
  });

  it("requires an explicit assistant application to change one draft pattern", () => {
    expect(assistant).toContain("Apply to Draft");
    expect(assistant).toContain("onApply(field, suggestion)");
    expect(editor).toContain("updateDraft(field, pattern)");
  });
});
