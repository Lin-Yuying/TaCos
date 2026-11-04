import type { HarnessKeys, TurnInput } from "./types";

export type OwnEndpoint = {
  endpoint: HarnessKeys["endpoints"][number];
  // The name the API knows the model by, without the endpoint id the menu puts in front.
  model: string;
  // Only the key this turn spends. The person's other keys stay out of the agent's environment.
  key: string;
};

/** The viewer's own API this turn should run on, or null when it runs on the harness's subscription. */
export function ownEndpoint(input: Pick<TurnInput, "keys" | "model">): OwnEndpoint | null {
  const at = input.model?.indexOf("/") ?? -1;
  if (!input.model || at < 0 || !input.keys) return null;
  const id = input.model.slice(0, at);
  const endpoint = input.keys.endpoints.find((candidate) => candidate.id === id);
  const key = endpoint && input.keys.env[endpoint.envVar];
  return endpoint && key ? { endpoint, model: input.model.slice(at + 1), key } : null;
}
