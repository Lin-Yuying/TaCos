const form = document.getElementById("form");
const input = document.getElementById("server");
const button = document.getElementById("submit");
const errorEl = document.getElementById("error");

async function init() {
  const saved = await window.tacosDesktop.getServerUrl();
  input.value = saved || "http://localhost:3000";
  input.focus();
  input.select();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  console.log("[setup] submit", event.submitter && event.submitter.id);
  if (button.disabled) return;
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
