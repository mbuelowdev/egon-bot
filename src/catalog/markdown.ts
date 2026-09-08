export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;

export function decorateHexColors(html: string): string {
  return html.replaceAll(HEX_COLOR, (hex) => {
    return `${hex}<span class="color-dot" style="background:${hex}" aria-hidden="true"></span>`;
  });
}

function parseFence(line: string): { ticks: number; info: string } | undefined {
  const match = line.match(/^(\s{0,3})(`{3,})([^`]*)$/);
  if (!match || !match[2]) {
    return undefined;
  }
  return { ticks: match[2].length, info: (match[3] ?? "").trim() };
}

function fenceLanguage(info: string): string {
  const match = info.match(/^[A-Za-z0-9_+#-]+/);
  return match?.[0] ?? "";
}

function splitTableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith("|")) {
    text = text.slice(1);
  }
  if (text.endsWith("|")) {
    text = text.slice(0, -1);
  }
  return text.split("|").map((cell) => cell.trim());
}

function isTableRow(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

function delimiterAlignment(cell: string): "left" | "center" | "right" | undefined {
  const compact = cell.replaceAll(" ", "");
  if (!/^:?-{3,}:?$/.test(compact)) {
    return undefined;
  }
  const left = compact.startsWith(":");
  const right = compact.endsWith(":");
  if (left && right) {
    return "center";
  }
  if (right) {
    return "right";
  }
  return "left";
}

function tableAlignments(line: string): Array<"left" | "center" | "right"> | undefined {
  if (!isTableRow(line)) {
    return undefined;
  }
  const cells = splitTableCells(line);
  if (cells.length === 0) {
    return undefined;
  }
  const alignments: Array<"left" | "center" | "right"> = [];
  for (const cell of cells) {
    const align = delimiterAlignment(cell);
    if (align === undefined) {
      return undefined;
    }
    alignments.push(align);
  }
  return alignments;
}

function padCells(row: string[], count: number): string[] {
  const cells = row.slice(0, count);
  while (cells.length < count) {
    cells.push("");
  }
  return cells;
}

function alignAttr(align: "left" | "center" | "right"): string {
  return align === "left" ? "" : ` style="text-align:${align}"`;
}

export type RenderMarkdownOptions = {
  /** Wrap `##` headings in `<details>`; Context & Goal and Acceptance criteria start open. */
  collapsibleSections?: boolean;
  /** Omit the first `#` heading (the spec title already appears as the page heading). */
  skipLeadingH1?: boolean;
};

function isDefaultOpenHeading(title: string): boolean {
  const text = title.replaceAll("&amp;", "&").replaceAll(/\*\*(.+?)\*\*/g, "$1").trim();
  return /^1\.\s+Context\s*&\s*Goal$/i.test(text) || /^\d+\.\s+Acceptance criteria$/i.test(text);
}

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const escaped = escapeHtml(markdown);
  const lines = escaped.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let inList: "ol" | "ul" | false = false;
  let inCode = false;
  let inSection = false;
  let codeFenceLength = 0;
  let codeLang = "";
  let codeLines: string[] = [];
  const collapsible = options.collapsibleSections === true;
  let skippedLeadingH1 = false;

  const flushList = (): void => {
    if (inList) {
      html.push(inList === "ol" ? "</ol>" : "</ul>");
      inList = false;
    }
  };

  const flushCode = (): void => {
    if (!inCode) {
      return;
    }
    const langClass = codeLang !== "" ? ` class="language-${codeLang}"` : "";
    html.push(`<pre><code${langClass}>${codeLines.join("\n")}</code></pre>`);
    inCode = false;
    codeFenceLength = 0;
    codeLang = "";
    codeLines = [];
  };

  const closeBlocks = (): void => {
    flushCode();
    flushList();
  };

  const flushSection = (): void => {
    if (!inSection) {
      return;
    }
    closeBlocks();
    html.push("</div></details>");
    inSection = false;
  };

  const inline = (text: string): string =>
    decorateHexColors(
      text.replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replaceAll(/`([^`]+)`/g, "<code>$1</code>"),
    );

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (inCode) {
      const fence = parseFence(line);
      if (fence && fence.ticks >= codeFenceLength && fence.info === "") {
        flushCode();
        continue;
      }
      codeLines.push(line);
      continue;
    }

    const fence = parseFence(line);
    if (fence) {
      flushList();
      inCode = true;
      codeFenceLength = fence.ticks;
      codeLang = fenceLanguage(fence.info);
      codeLines = [];
      continue;
    }

    const nextLine = lines[i + 1];
    const alignments = nextLine === undefined ? undefined : tableAlignments(nextLine);
    if (isTableRow(line) && alignments !== undefined && tableAlignments(line) === undefined) {
      flushList();
      const header = padCells(splitTableCells(line), alignments.length);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length) {
        const body = lines[i] ?? "";
        if (!isTableRow(body) || tableAlignments(body) !== undefined) {
          break;
        }
        rows.push(padCells(splitTableCells(body), alignments.length));
        i += 1;
      }
      i -= 1;
      const head = header
        .map((cell, index) => `<th${alignAttr(alignments[index] ?? "left")}>${inline(cell)}</th>`)
        .join("");
      const body = rows
        .map((row) => {
          const cells = row
            .map((cell, index) => `<td${alignAttr(alignments[index] ?? "left")}>${inline(cell)}</td>`)
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("");
      html.push(`<div class="md-table-wrap"><table class="md">`);
      html.push(`<thead><tr>${head}</tr></thead>`);
      if (body !== "") {
        html.push(`<tbody>${body}</tbody>`);
      }
      html.push(`</table></div>`);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading && heading[1] && heading[2]) {
      const level = heading[1].length;
      if (options.skipLeadingH1 === true && !skippedLeadingH1 && level === 1) {
        closeBlocks();
        flushSection();
        skippedLeadingH1 = true;
        continue;
      }
      if (collapsible && level === 2) {
        closeBlocks();
        flushSection();
        const open = isDefaultOpenHeading(heading[2]) ? " open" : "";
        html.push(`<details class="spec-section"${open}>`);
        html.push(`<summary><h2>${inline(heading[2])}</h2></summary>`);
        html.push(`<div class="spec-section-body">`);
        inSection = true;
        continue;
      }
      if (collapsible && level === 1) {
        closeBlocks();
        flushSection();
      } else {
        flushList();
      }
      html.push(`<h${String(level)}>${inline(heading[2])}</h${String(level)}>`);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)[\.\)]\s+(.+)$/);
    if (numbered && numbered[1] && numbered[2]) {
      if (inList !== "ol") {
        flushList();
        html.push("<ol>");
        inList = "ol";
      }
      html.push(`<li>${inline(numbered[2])}</li>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet && bullet[1]) {
      if (inList !== "ul") {
        flushList();
        html.push("<ul>");
        inList = "ul";
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      continue;
    }
    html.push(`<p>${inline(line)}</p>`);
  }
  closeBlocks();
  flushSection();
  return html.join("\n");
}
