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
  getServerHistory: () => ipcRenderer.invoke("tacos:get-server-history"),
  connect: (url) => ipcRenderer.invoke("tacos:connect", url),
  retry: () => ipcRenderer.invoke("tacos:retry"),
  changeServer: () => ipcRenderer.invoke("tacos:change-server"),
  openLogs: () => ipcRenderer.invoke("tacos:open-logs"),
  // Markdown files handed over by Finder/Explorer. The page pulls the queue when it has
  // a workspace to import into, and re-pulls whenever the main process says one arrived.
  takeOpenFiles: () => ipcRenderer.invoke("tacos:take-open-files"),
  onOpenFiles: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("tacos:open-files-queued", listener);
    return () => ipcRenderer.removeListener("tacos:open-files-queued", listener);
  },
  // H-DESKTOP-UPDATE-01: desktop app binary update (not Settings › Harness CLI update).
  appUpdate: {
    getStatus: () => ipcRenderer.invoke("tacos:app-update:status"),
    check: () => ipcRenderer.invoke("tacos:app-update:check"),
    download: () => ipcRenderer.invoke("tacos:app-update:download"),
    install: () => ipcRenderer.invoke("tacos:app-update:install"),
    onStatus: (handler) => {
      const listener = (_event, status) => handler(status);
      ipcRenderer.on("tacos:app-update:status-changed", listener);
      return () => ipcRenderer.removeListener("tacos:app-update:status-changed", listener);
    },
  },
});
