import fs from "node:fs";
import path from "node:path";
import { maxUploadBytes } from "./attachments";
import { TacosError } from "./issues";
import type { TurnPayload } from "./runner/protocol";
import type { TurnInput } from "./harness/types";
import {
  AGENT_ATTACHMENT_MAX_COUNT,
  applyAttachmentManifest,
  attachmentKindFromMime,
  attachmentMessageLabel,
  type AgentAttachmentRef,
  type AgentAttachmentWire,
} from "./agent-composer-attachments.shared";

export type {
  AgentAttachmentKind,
  AgentAttachmentRef,
  AgentAttachmentWire,
} from "./agent-composer-attachments.shared";
export {
  AGENT_ATTACHMENT_MAX_BYTES,
  AGENT_ATTACHMENT_MAX_COUNT,
  attachmentKindFromMime,
  attachmentManifest,
  applyAttachmentManifest,
  attachmentMessageLabel,
} from "./agent-composer-attachments.shared";

export type TurnAttachmentPayload = AgentAttachmentRef & { base64: string };

const ATTACHMENTS_DIR = "attachments";

function safeFileName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-()+ ]+/g, "_").trim().slice(0, 120);
  return base || "file";
}

function decodeWire(upload: AgentAttachmentWire): Buffer {
  let data = upload.data.trim();
  const prefix = /^data:[^;]+;base64,/;
  if (prefix.test(data)) data = data.replace(prefix, "");
  let buf: Buffer;
  try {
    buf = Buffer.from(data, "base64");
  } catch {
    throw new TacosError("Could not read an attachment", 400);
  }
  if (buf.length === 0) throw new TacosError("An attachment was empty", 400);
  const limit = maxUploadBytes();
  if (buf.length > limit) {
    throw new TacosError("An attachment is too large", 400, `Each file can be at most ${Math.round(limit / (1024 * 1024))} MB.`);
  }
  return buf;
}

function planRefs(uploads: AgentAttachmentWire[]): AgentAttachmentRef[] {
  const used = new Set<string>();
  const refs: AgentAttachmentRef[] = [];
  for (const upload of uploads) {
    let name = safeFileName(upload.name);
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      const ext = path.extname(name);
      const stem = path.basename(name, ext);
      candidate = `${stem}-${n}${ext}`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    const relPath = path.join(ATTACHMENTS_DIR, candidate);
    refs.push({
      name: candidate,
      relPath,
      kind: attachmentKindFromMime(upload.mimeType, candidate),
    });
  }
  return refs;
}

export function parseWireAttachments(raw: unknown): AgentAttachmentWire[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new TacosError("Attachments must be a list", 400);
  if (raw.length > AGENT_ATTACHMENT_MAX_COUNT) {
    throw new TacosError("Too many attachments", 400, `Send at most ${AGENT_ATTACHMENT_MAX_COUNT} files per message.`);
  }
  const out: AgentAttachmentWire[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new TacosError("Each attachment needs a name and data", 400);
    const row = item as { name?: unknown; mimeType?: unknown; data?: unknown };
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const data = typeof row.data === "string" ? row.data : "";
    if (!name || !data) throw new TacosError("Each attachment needs a name and data", 400);
    decodeWire({ name, data });
    out.push({
      name,
      data,
      mimeType: typeof row.mimeType === "string" && row.mimeType.trim() ? row.mimeType.trim() : undefined,
    });
  }
  return out;
}

/** Writes attachment bytes under `cwd` and returns their paths for the harness. */
export function materializeTurnAttachments(cwd: string, uploads: AgentAttachmentWire[]): AgentAttachmentRef[] {
  if (uploads.length === 0) return [];
  fs.mkdirSync(path.join(cwd, ATTACHMENTS_DIR), { recursive: true });
  const refs = planRefs(uploads);
  uploads.forEach((upload, index) => {
    const ref = refs[index];
    const abs = path.join(cwd, ref.relPath);
    fs.writeFileSync(abs, decodeWire(upload));
  });
  return refs;
}

export function turnAttachmentPayloads(
  uploads: AgentAttachmentWire[],
  refs: AgentAttachmentRef[]
): TurnAttachmentPayload[] {
  return uploads.map((upload, index) => ({
    ...refs[index],
    base64: upload.data.replace(/^data:[^;]+;base64,/, ""),
  }));
}

export type AgentTurnAttachmentBundle = {
  refs: AgentAttachmentRef[];
  prompt: { system: string; body: string };
  payloadAttachments: TurnAttachmentPayload[];
};

/** Local turns: materialize on this machine, then enrich the prompt. */
export function buildLocalAgentTurnAttachments(
  cwd: string,
  prompt: { system: string; body: string },
  uploads: AgentAttachmentWire[]
): AgentTurnAttachmentBundle {
  const refs = materializeTurnAttachments(cwd, uploads);
  return {
    refs,
    prompt: applyAttachmentManifest(prompt, refs),
    payloadAttachments: turnAttachmentPayloads(uploads, refs),
  };
}

/** Server mode: paths and bytes travel to the member runner; nothing is written on the server. */
export function buildRemoteAgentTurnAttachments(
  prompt: { system: string; body: string },
  uploads: AgentAttachmentWire[]
): AgentTurnAttachmentBundle {
  const refs = planRefs(uploads);
  return {
    refs,
    prompt: applyAttachmentManifest(prompt, refs),
    payloadAttachments: turnAttachmentPayloads(uploads, refs),
  };
}

/** Runner: write payload bytes into the turn cwd before `openTurn`. */
export function materializePayloadAttachments(cwd: string, payloads: TurnAttachmentPayload[]): AgentAttachmentRef[] {
  if (payloads.length === 0) return [];
  fs.mkdirSync(path.join(cwd, ATTACHMENTS_DIR), { recursive: true });
  for (const file of payloads) {
    const abs = path.join(cwd, file.relPath);
    fs.writeFileSync(abs, Buffer.from(file.base64, "base64"));
  }
  return payloads.map(({ name, relPath, kind }) => ({ name, relPath, kind }));
}

export function turnInputAttachments(refs: AgentAttachmentRef[]): Pick<TurnInput, "attachments"> {
  return refs.length ? { attachments: refs } : {};
}

export function turnPayloadAttachments(payloads: TurnAttachmentPayload[]): Pick<TurnPayload, "attachments"> {
  return payloads.length ? { attachments: payloads } : {};
}

/** Used by the check script: wire → TurnPayload + TurnInput fields. */
export function buildAgentTurnPayload(input: {
  cwd: string;
  prompt: { system: string; body: string };
  wires: AgentAttachmentWire[];
  remote?: boolean;
}): {
  refs: AgentAttachmentRef[];
  prompt: { system: string; body: string };
  payload: TurnAttachmentPayload[];
  turnInput: Pick<TurnInput, "prompt" | "attachments" | "cwd">;
} {
  const bundle = input.remote
    ? buildRemoteAgentTurnAttachments(input.prompt, input.wires)
    : buildLocalAgentTurnAttachments(input.cwd, input.prompt, input.wires);
  return {
    refs: bundle.refs,
    prompt: bundle.prompt,
    payload: bundle.payloadAttachments,
    turnInput: {
      cwd: input.cwd,
      prompt: bundle.prompt,
      attachments: bundle.refs.length ? bundle.refs : undefined,
    },
  };
}
