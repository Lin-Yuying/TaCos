const { contextBridge, ipcRenderer } = require("electron");

// Tag the document once React has hydrated so desktop-only chrome applies
// without causing a hydration attribute mismatch.
window.addEventListener("load", () => {
  setTimeout(() => {
    document.documentElement.dataset.desktop = "true";
  }, 0);
});

contextBridge.exposeInMainWorld("tacosDesktop", {
  getServerUrl: () => ipcRenderer.invoke("tacos:get-server-url"),
  connect: (url) => ipcRenderer.invoke("tacos:connect", url),
  retry: () => ipcRenderer.invoke("tacos:retry"),
  changeServer: () => ipcRenderer.invoke("tacos:change-server"),
  openLogs: () => ipcRenderer.invoke("tacos:open-logs"),
});
