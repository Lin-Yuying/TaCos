import path from "node:path";

// A packaged desktop install cannot write next to its read-only app bundle, so the
// data directory comes from the environment and only falls back to the repo checkout.
export const DATA_DIR = process.env.TACOS_DATA_DIR
  ? path.resolve(process.env.TACOS_DATA_DIR)
  : path.join(process.cwd(), "data");
