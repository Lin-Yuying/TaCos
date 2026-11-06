/** Files sent with an Agent message, in the form the browser may import. */

export type AgentAttachment = { id: string; name: string; image: boolean };

export const AGENT_ATTACHMENT_MAX_COUNT = 10;

// Where a file waits between the composer and the turn it is sent with.
export const AGENT_DRAFT_PAGE = "agent-draft";

const LINE = /^(!?)\[(.*)\]\(\/api\/files\/([0-9a-f-]{36})\)$/;

function attachmentLine(file: AgentAttachment): string {
  const name = file.name.replace(/[[\]\n]/g, " ");
  return `${file.image ? "!" : ""}[${name}](/api/files/${file.id})`;
}

/** The chat keeps its record of a message's files as Markdown links under the text. */
export function messageWithAttachments(text: string, files: AgentAttachment[]): string {
  return [text, ...files.map(attachmentLine)].filter(Boolean).join("\n");
}

export function splitAttachments(content: string): { text: string; files: AgentAttachment[] } {
  const lines = content.split("\n");
  const files: AgentAttachment[] = [];
  while (lines.length) {
    const match = LINE.exec(lines[lines.length - 1]!);
    if (!match) break;
    files.unshift({ id: match[3]!, name: match[2]!, image: match[1] === "!" });
    lines.pop();
  }
  return { text: lines.join("\n"), files };
}
