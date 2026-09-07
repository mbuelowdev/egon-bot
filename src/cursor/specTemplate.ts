import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATE_NAME = "spec-sheet.md";

function specSheetTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates", TEMPLATE_NAME),
    join(here, TEMPLATE_NAME),
    join(process.cwd(), "templates", TEMPLATE_NAME),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      return path;
    }
  }
  throw new Error(`Missing spec sheet template (templates/${TEMPLATE_NAME})`);
}

export const SPEC_SHEET_TEMPLATE = readFileSync(specSheetTemplatePath(), "utf8").trim();
