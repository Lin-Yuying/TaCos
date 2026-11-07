import { safeEntryName, type ZipSourceEntry } from "@/lib/transfer/zip";

/**
 * Notion and Finder both wrap a folder export in one top-level directory. Strip that
 * single common root so a page titled "Project Plan" does not become
 * "Export-1234abcd > Project Plan". Canonical TaCos exports have workspace.json at the
 * root and are left alone.
 */
export function importEntryMap(entries: ZipSourceEntry[]): Map<string, ZipSourceEntry> {
  const list = entries.filter((entry) => !entry.directory);
  const names = list.map((entry) => safeEntryName(entry.name));
  const first = names[0]?.split("/")[0];
  const strip =
    Boolean(first) &&
    names.length > 0 &&
    names.every((name) => name.split("/").length > 1 && name.split("/")[0] === first);
  const map = new Map<string, ZipSourceEntry>();
  for (let index = 0; index < list.length; index++) {
    const original = names[index];
    const normalized = strip ? original.split("/").slice(1).join("/") : original;
    if (normalized && !map.has(normalized)) map.set(normalized, list[index]);
  }
  return map;
}
