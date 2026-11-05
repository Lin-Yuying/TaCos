/**
 * Server mode: this TaCos only stores data. It never starts an agent CLI and never holds a
 * model key; each member's computer runs their Agent through the runner (src/runner).
 */
export function isServerMode(): boolean {
  return process.env.TACOS_SERVER_MODE === "1";
}
