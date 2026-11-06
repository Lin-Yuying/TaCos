export class RequestError extends Error { constructor(message: string, public status: number) { super(message); } }

export async function readJson<T>(url: string, valid: (data: unknown) => data is T, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  if (!response.ok) throw new RequestError(response.status === 401 ? "Not signed in" : response.status === 403 || response.status === 404 ? "This item is unavailable or you do not have access" : "Could not load. Retry.", response.status);
  const data: unknown = await response.json();
  if (!valid(data)) throw new Error("Unexpected response. Retry.");
  return data;
}
