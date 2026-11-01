// Built-in avatars. Values live in users.avatar as "builtin:<id>", next to uploaded
// data: URLs, so every renderer only has to look at one column. The set is a taco
// pantry drawn in the same line style as the brand otter.
export const BUILTIN_AVATARS = [
  "tortilla",
  "shell",
  "lime",
  "beef",
  "cheese",
  "tomato",
  "avocado",
  "cilantro",
  "onion",
  "chili",
  "sour-cream",
  "corn",
  "lettuce",
  "salsa",
  "shrimp",
  "fish",
] as const;

export type BuiltinAvatarId = (typeof BUILTIN_AVATARS)[number];

export const BUILTIN_AVATAR_PREFIX = "builtin:";

export const BUILTIN_AVATAR_LABELS: Record<BuiltinAvatarId, string> = {
  tortilla: "Tortilla",
  shell: "Taco shell",
  lime: "Lime",
  beef: "Beef",
  cheese: "Cheese",
  tomato: "Tomato",
  avocado: "Avocado",
  cilantro: "Cilantro",
  onion: "Onion",
  chili: "Chili",
  "sour-cream": "Sour cream",
  corn: "Corn",
  lettuce: "Lettuce",
  salsa: "Salsa",
  shrimp: "Shrimp",
  fish: "Fish",
};

export function builtinAvatarId(value: string | null | undefined): BuiltinAvatarId | null {
  if (!value || !value.startsWith(BUILTIN_AVATAR_PREFIX)) return null;
  const id = value.slice(BUILTIN_AVATAR_PREFIX.length);
  return (BUILTIN_AVATARS as readonly string[]).includes(id) ? (id as BuiltinAvatarId) : null;
}

export function builtinAvatarSrc(id: BuiltinAvatarId): string {
  return `/avatars/${id}.svg`;
}

// Initial avatars are handed out from the start of the list while the server has
// fewer users than ingredients, so a team never sees the same face twice. Only after
// every ingredient is taken does the list wrap around.
export function nextFreeAvatar(
  used: Iterable<string | null | undefined>,
  start = 0
): string {
  const taken = new Set<string>();
  for (const value of used) {
    if (value) taken.add(value);
  }
  for (let i = 0; i < BUILTIN_AVATARS.length; i += 1) {
    const id = BUILTIN_AVATARS[(start + i) % BUILTIN_AVATARS.length];
    const value = `${BUILTIN_AVATAR_PREFIX}${id}`;
    if (!taken.has(value)) return value;
  }
  return `${BUILTIN_AVATAR_PREFIX}${BUILTIN_AVATARS[start % BUILTIN_AVATARS.length]}`;
}
