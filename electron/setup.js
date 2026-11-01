const form = document.getElementById("form");
const input = document.getElementById("server");
const button = document.getElementById("submit");
const errorEl = document.getElementById("error");
const historyEl = document.getElementById("recent");
const historyList = document.getElementById("recent-list");
const menu = document.getElementById("server-menu");

let history = [];
let suggestions = [];
let activeIndex = -1;

function closeMenu() {
  menu.hidden = true;
  menu.replaceChildren();
  input.setAttribute("aria-expanded", "false");
  activeIndex = -1;
}

function paintActive() {
  const items = menu.querySelectorAll(".item");
  items.forEach((item, i) => item.setAttribute("aria-selected", String(i === activeIndex)));
  if (activeIndex >= 0) items[activeIndex]?.scrollIntoView({ block: "nearest" });
}

// The field already holds a remembered address after launch, so clicking it should show
// everything again rather than filter down to the one value it happens to contain.
function matching() {
  const typed = input.value.trim();
  const query = typed.toLowerCase();
  if (!typed || history.includes(typed)) return history;
  return history.filter((url) => url.toLowerCase().includes(query));
}

function openMenu() {
  suggestions = matching();
  if (suggestions.length === 0) {
    closeMenu();
    return;
  }
  menu.replaceChildren(
    ...suggestions.map((url) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.title = url;
      const label = document.createElement("span");
      label.textContent = url;
      item.append(label);
      // Keep the caret in the field: otherwise blur closes the menu before the click lands.
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => choose(url));
      return item;
    })
  );
  activeIndex = -1;
  menu.hidden = false;
  input.setAttribute("aria-expanded", "true");
}

function choose(url) {
  input.value = url;
  closeMenu();
  input.focus();
  input.setSelectionRange(url.length, url.length);
}

function renderHistory(items) {
  history = Array.isArray(items) ? items.filter((value) => typeof value === "string" && value) : [];
  historyList.replaceChildren(
    ...history.map((url) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = url;
      chip.title = `Use ${url}`;
      chip.addEventListener("click", () => choose(url));
      return chip;
    })
  );
  historyEl.hidden = history.length === 0;
  closeMenu();
}

async function init() {
  const saved = await window.tacosDesktop.getServerUrl();
  input.value = saved || "http://localhost:3000";
  try {
    renderHistory(await window.tacosDesktop.getServerHistory());
  } catch {
    /* an older shell without history support still connects fine */
  }
  input.focus();
  input.select();
}

input.addEventListener("click", openMenu);
input.addEventListener("input", openMenu);
input.addEventListener("blur", closeMenu);

input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!menu.hidden) {
      event.preventDefault();
      closeMenu();
    }
    return;
  }
  if (event.key === "Tab") {
    closeMenu();
    return;
  }
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (menu.hidden) openMenu();
    if (menu.hidden) return;
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    activeIndex = (activeIndex + step + suggestions.length) % suggestions.length;
    paintActive();
    return;
  }
  if (event.key === "Enter" && !menu.hidden && activeIndex >= 0) {
    event.preventDefault();
    choose(suggestions[activeIndex]);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  console.log("[setup] submit", event.submitter && event.submitter.id);
  if (button.disabled) return;
  closeMenu();
  errorEl.textContent = "";
  button.disabled = true;
  button.textContent = "Connecting…";
  try {
    const result = await window.tacosDesktop.connect(input.value);
    if (!result.ok) {
      errorEl.textContent = result.error;
      button.disabled = false;
      button.textContent = "Connect";
    }
  } catch {
    errorEl.textContent = "Something went wrong while connecting.";
    button.disabled = false;
    button.textContent = "Connect";
  }
});

void init();
