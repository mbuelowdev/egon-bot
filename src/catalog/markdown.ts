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

export function renderMarkdown(markdown: string): string {
  const escaped = escapeHtml(markdown);
  const lines = escaped.replaceAll("\r\n", "\n").split("\n");
  const html: string[] = [];
  let inList = false;

  const flushList = (): void => {
    if (inList) {
      html.push("</ol>");
      inList = false;
    }
  };

  const inline = (text: string): string =>
    decorateHexColors(
      text.replaceAll(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replaceAll(/`([^`]+)`/g, "<code>$1</code>"),
    );

  for (const line of lines) {
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading && heading[1] && heading[2]) {
      flushList();
      const level = String(heading[1].length);
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    const numbered = line.match(/^\s*\d+[\.\)]\s+(.+)$/);
    if (numbered && numbered[1]) {
      if (!inList) {
        html.push("<ol>");
        inList = true;
      }
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet && bullet[1]) {
      flushList();
      html.push(`<p>${inline(bullet[1])}</p>`);
      continue;
    }
    flushList();
    if (line.trim() === "") {
      continue;
    }
    html.push(`<p>${inline(line)}</p>`);
  }
  flushList();
  return html.join("\n");
}
