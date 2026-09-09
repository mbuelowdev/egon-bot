/**
 * One parser for SPEC sections, shared by the schema gate and by the code that hands
 * criteria to the implementer and tester. They used to disagree — the gate counted only
 * numbered items while the parser also accepted bare bullets — so a spec with an
 * explanatory sub-bullet under Acceptance criteria validated cleanly, then shipped a shifted checklist
 * (and shifted criterion-N.png numbering) to the tester.
 */

export const ACCEPTANCE_HEADING_RE = /^#{1,3}\s*(?:\d+[.)]\s*)?acceptance criteria\s*$/i;
export const VERIFICATION_HEADING_RE = /^#{1,3}\s*(?:\d+[.)]\s*)?verification hooks\s*$/i;
export const TEST_SCENARIOS_HEADING_RE = /^#{1,3}\s*(?:\d+[.)]\s*)?test scenarios\s*$/i;
export const ASSETS_HEADING_RE = /^#{1,3}\s*(?:\d+[.)]\s*)?assets\s*$/i;

/** Assets are declared as list items; the first backticked `name.ext` on the line is the id. */
const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+\S/;
const ASSET_ID_RE = /`([A-Za-z0-9][A-Za-z0-9._-]*\.[A-Za-z0-9]{2,5})`/;

/** A numbered Acceptance criteria item. Bare bullets are prose, never criteria. */
const NUMBERED_CRITERION_RE = /^\s*(?:\d+[.)]\s+|[-*]\s+\d+[.)]\s+)(\S.*?)\s*$/;

/** Body under the first heading matching `headingRe`, up to the next heading of the same or higher level. */
export function markdownSection(markdown: string, headingRe: RegExp): string | undefined {
  const lines = markdown.replace(/^﻿/, "").split("\n");
  let start = -1;
  let level = 2;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!headingRe.test(trimmed)) {
      continue;
    }
    start = i + 1;
    level = (trimmed.match(/^#+/)?.[0] ?? "##").length;
    break;
  }
  if (start < 0) {
    return undefined;
  }
  const body: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    const hashes = trimmed.match(/^#+/)?.[0];
    if (hashes && hashes.length <= level && /\s+\S/.test(trimmed.slice(hashes.length))) {
      break;
    }
    body.push(line);
  }
  return body.join("\n");
}

export function acceptanceCriteriaSection(markdown: string): string | undefined {
  return markdownSection(markdown, ACCEPTANCE_HEADING_RE);
}

export function verificationHooksSection(markdown: string): string | undefined {
  return markdownSection(markdown, VERIFICATION_HEADING_RE);
}

export function testScenariosSection(markdown: string): string | undefined {
  return markdownSection(markdown, TEST_SCENARIOS_HEADING_RE);
}

export function assetsSection(markdown: string): string | undefined {
  return markdownSection(markdown, ASSETS_HEADING_RE);
}

/**
 * Library asset ids the Assets section names, read only off list items: the section's
 * prose mentions `assets/images/{id}` and `ColorRect`, and neither is a
 * declaration. `None.` yields nothing, which is a valid answer.
 */
export function declaredAssetIds(markdown: string): string[] {
  const section = assetsSection(markdown);
  if (section === undefined) {
    return [];
  }
  const ids: string[] = [];
  for (const line of section.split("\n")) {
    if (!LIST_ITEM_RE.test(line)) {
      continue;
    }
    const match = ASSET_ID_RE.exec(line);
    if (match?.[1] !== undefined && !ids.includes(match[1])) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/**
 * Every numbered Acceptance criteria item, uncapped. Returns nothing when that section is
 * absent rather than falling back to scanning the whole document, which would ship Scope's
 * bullets as criteria.
 */
export function numberedCriteria(markdown: string): string[] {
  const section = acceptanceCriteriaSection(markdown);
  if (section === undefined) {
    return [];
  }
  const items: string[] = [];
  for (const line of section.split("\n")) {
    const match = NUMBERED_CRITERION_RE.exec(line);
    if (match?.[1] === undefined) {
      continue;
    }
    items.push(match[1].trim());
  }
  return items;
}
