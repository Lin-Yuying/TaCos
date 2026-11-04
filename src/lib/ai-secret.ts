import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/db/client";
import { TacosError } from "./issues";

const SECRET_FILE = path.join(DATA_DIR, "ai.key");
const SECRET_LABEL = "tacos-ai-v1";

let cachedSecret: Buffer | null = null;

function secret(): Buffer {
  if (cachedSecret) return cachedSecret;
  let raw = process.env.TACOS_AI_SECRET?.trim() ?? "";
  if (!raw) {
    try {
      raw = fs.readFileSync(SECRET_FILE, "utf8").trim();
    } catch {
      // First AI save on this machine: create the secret next to the database.
      raw = crypto.randomBytes(32).toString("hex");
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SECRET_FILE, `${raw}\n`, { mode: 0o600 });
      try {
        fs.chmodSync(SECRET_FILE, 0o600);
      } catch {
        /* best effort on filesystems without POSIX modes */
      }
    }
  }
  if (!raw) throw new TacosError("The AI credential store is unavailable on this server");
  cachedSecret = crypto.scryptSync(raw, SECRET_LABEL, 32);
  return cachedSecret;
}

export function encryptKey(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secret(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${body.toString("base64url")}`;
}

export function decryptKey(stored: string): string | null {
  try {
    const [version, iv, tag, body] = stored.split(":");
    if (version !== "v1" || !iv || !tag || !body) return null;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secret(),
      Buffer.from(iv, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
