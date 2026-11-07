import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/data-dir";

/**
 * The download URL is a capability with a short life. A random server secret signs
 * `{ job, expires }`, so a URL cannot be edited to point at another workspace's
 * archive, and it stops working when it expires even if it leaked.
 */
let cached: Buffer | null = null;

function secret(): Buffer {
  if (cached) return cached;
  const configured = process.env.TACOS_TRANSFER_SECRET;
  if (configured && configured.length >= 32) {
    cached = Buffer.from(configured, "utf8");
    return cached;
  }
  const file = path.join(DATA_DIR, "transfer-secret");
  try {
    cached = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
  } catch {
    const created = crypto.randomBytes(32);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    try {
      fs.writeFileSync(file, created.toString("hex"), { mode: 0o600, flag: "wx" });
      cached = created;
    } catch {
      // Another worker created it first; both must sign with the same key.
      cached = Buffer.from(fs.readFileSync(file, "utf8").trim(), "hex");
    }
  }
  if (!cached || cached.length < 32) throw new Error("Transfer signing secret is unavailable");
  return cached;
}

function mac(payload: string): string {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signTransferToken(jobId: string, expiresAt: number): string {
  const expires = Math.floor(expiresAt / 1000);
  const payload = `${jobId}.${expires}`;
  return `${payload}.${mac(payload)}`;
}

export function verifyTransferToken(
  token: string,
  now = Date.now()
): { jobId: string; expiresAt: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [jobId, expires, signature] = parts;
  const expected = mac(`${jobId}.${expires}`);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !crypto.timingSafeEqual(given, wanted)) return null;
  const seconds = Number(expires);
  if (!Number.isFinite(seconds) || seconds * 1000 <= now) return null;
  return { jobId, expiresAt: seconds * 1000 };
}
