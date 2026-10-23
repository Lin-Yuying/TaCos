const params = new URLSearchParams(window.location.search);
const retry = document.getElementById("retry");
const change = document.getElementById("change");
const logs = document.getElementById("logs");

document.getElementById("url").textContent = params.get("url") || "unknown";
document.getElementById("reason").textContent = params.get("reason") || "";
const logPath = params.get("log");
if (logPath) document.getElementById("log").textContent = `Log: ${logPath}`;

retry.addEventListener("click", async () => {
  retry.disabled = true;
  retry.textContent = "Retrying…";
  const result = await window.tacosDesktop.retry();
  if (result && result.ok === false) {
    retry.disabled = false;
    retry.textContent = "Retry";
  }
});

change.addEventListener("click", async () => {
  change.disabled = true;
  await window.tacosDesktop.changeServer();
});

logs.addEventListener("click", async () => {
  await window.tacosDesktop.openLogs();
});
