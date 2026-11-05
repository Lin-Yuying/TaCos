/** Wire format and limits for Agent composer attachments (safe for client imports). */

export type AgentAttachmentKind = "image" | "file";

export type AgentAttachmentRef = {
  name: string;
  relPath: string;
  kind: AgentAttachmentKind;
};

export type AgentAttachmentWire = {
  name: string;
  mimeType?: string;
  data: string;
};

export const AGENT_ATTACHMENT_MAX_COUNT = 10;

/** Matches default `TACOS_UPLOAD_MAX_MB` (25) for page uploads. */
export const AGENT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

export function attachmentKindFromMime(mimeType: string | undefined, name: string): AgentAttachmentKind {
  if (mimeType?.startsWith("image/")) return "image";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")).toLowerCase() : "";
  return IMAGE_EXT.has(ext) ? "image" : "file";
}

export function attachmentManifest(refs: AgentAttachmentRef[]): string {
  if (refs.length === 0) return "";
  const lines = refs.map((ref) => `- ${ref.name} (${ref.kind}): ${ref.relPath}`);
  return `\n\nAttached files (paths relative to the turn folder):\n${lines.join("\n")}`;
}

export function applyAttachmentManifest(
  prompt: { system: string; body: string },
  refs: AgentAttachmentRef[]
): { system: string; body: string } {
  const extra = attachmentManifest(refs);
  if (!extra) return prompt;
  return { ...prompt, body: `${prompt.body}${extra}` };
}

export function attachmentMessageLabel(refs: AgentAttachmentRef[]): string {
  return refs.map((ref) => ref.name).join(", ");
}
