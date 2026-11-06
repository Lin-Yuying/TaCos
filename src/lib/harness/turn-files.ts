import fs from "node:fs";
import path from "node:path";
import { sniffImage } from "../image-sniff";
import type { TurnImage } from "./types";

export type TurnFile = { name: string; path: string };

// Longer text would crowd out the conversation; the model is told where the file is instead.
const TEXT_LIMIT = 200 * 1024;
const NO_IMAGE_INPUT = ["dsh"];

export function fileName(name: string, id: string): string {
  const safe = path.basename(name).replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "");
  return safe || id;
}

function readableText(bytes: Buffer): string | null {
  if (bytes.length > TEXT_LIMIT || bytes.includes(0)) return null;
  const text = bytes.toString("utf8");
  return Buffer.from(text, "utf8").equals(bytes) ? text : null;
}

/** Images go to the harness's own image input, text goes into the prompt, the rest is named. */
export function attachTurnFiles(
  harness: string,
  prompt: { system: string; body: string },
  files: TurnFile[]
): { prompt: { system: string; body: string }; images: TurnImage[] } {
  const images: TurnImage[] = [];
  const parts: string[] = [];
  for (const file of files) {
    const bytes = fs.readFileSync(file.path);
    const label = JSON.stringify(file.name);
    const mime = sniffImage(bytes.subarray(0, 12));
    if (mime) {
      if (NO_IMAGE_INPUT.includes(harness)) {
        parts.push(`The user attached the image ${label}, but this Agent cannot see images. Tell the user so.`);
      } else {
        images.push({ name: file.name, path: file.path, mime });
      }
      continue;
    }
    const text = readableText(bytes);
    if (text !== null) {
      parts.push(`<attached-file name=${label}>\n${text}\n</attached-file>`);
    } else {
      parts.push(`The user attached ${label} at ${file.path}. It is not inlined here. Read it if you have a tool for that; otherwise tell the user you cannot.`);
    }
  }
  if (!parts.length) return { prompt, images };
  return { prompt: { ...prompt, body: `${prompt.body}\n\n${parts.join("\n\n")}` }, images };
}
