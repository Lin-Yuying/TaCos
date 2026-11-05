import crypto from "node:crypto";

// Who may open which document on the collaboration socket. The socket and the app share one
// process, so the secret lives only in memory, and a restart just makes clients ask again.
const TTL_MS = 10 * 60_000;

const shared = globalThis as unknown as { __tacosCollabSecret?: Buffer };

function secret(): Buffer {
  shared.__tacosCollabSecret ??= crypto.randomBytes(32);
  return shared.__tacosCollabSecret;
}

function sign(body: string): string {
  return crypto.createHmac("sha256", secret()).update(body).digest("base64url");
}

export type CollabClaim = { workspaceId: string; pageId: string; userId: string; expires: number };

export function issueCollabToken(claim: Omit<CollabClaim, "expires">): string {
  const body = Buffer.from(JSON.stringify({ ...claim, expires: Date.now() + TTL_MS })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readCollabToken(token: string): CollabClaim | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  const claim = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as CollabClaim;
  return claim.expires > Date.now() ? claim : null;
}
