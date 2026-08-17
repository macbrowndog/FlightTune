const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("flightTune", {
  detectHardware: () => ipcRenderer.invoke("hardware:detect"),
  pickConfig: () => ipcRenderer.invoke("config:pick"),
  saveConfig: (payload) => ipcRenderer.invoke("config:save", payload),
  listManualProfiles: () => ipcRenderer.invoke("profiles:list"),
  saveManualProfile: (payload) => ipcRenderer.invoke("profiles:save", payload),
  loadManualProfile: (id) => ipcRenderer.invoke("profiles:load", id),
  deleteManualProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  reviewConfig: (payload) => ipcRenderer.invoke("optimizer:review", payload),
  getApiStatus: () => ipcRenderer.invoke("settings:api-status"),
  saveApiKey: (key) => ipcRenderer.invoke("settings:save-api-key", key),
  clearApiKey: () => ipcRenderer.invoke("settings:clear-api-key"),
  testApiKey: (key) => ipcRenderer.invoke("settings:test-api-key", key),
  getAppVersion: () => ipcRenderer.invoke("app:version"),
});
