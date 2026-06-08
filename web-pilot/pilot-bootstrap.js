/**
 * PILOT — start Reading Adventures from Google Drive or ?t=tenant
 */
(function () {
  async function applyClassDataText(text) {
    const data = JSON.parse(text);
    if (!data.classes) throw new Error("Invalid JSON: no classes");
    state.data = data;
    state.classKey = null;
    state.passwords = {};
    state.studentPoints = {};
    state.flashResults = {};
    const keys = Object.keys(data.classes);
    state.view = keys.length === 1 ? "dashboard" : "classSelect";
    if (keys.length === 1) {
      state.classKey = keys[0];
      if (typeof generatePasswords === "function") generatePasswords();
      if (typeof loadPoints === "function") loadPoints();
      if (typeof loadFlashResults === "function") loadFlashResults();
      if (typeof loadGamePlayed === "function") loadGamePlayed();
    }
    window.DrivePilot._loadedFromDrive = true;
    if (typeof render === "function") render();
  }

  async function resolveFileId() {
    const apiKey = window.DrivePilotLoader?.apiKeyFromUrl();
    let fileId = window.DrivePilotLoader?.fileIdFromUrl();

    const tenantSlug = window.TenantRegistry?.tenantFromUrl();
    if (tenantSlug && window.TenantRegistry) {
      const row = await window.TenantRegistry.resolveTenant(tenantSlug);
      if (!row) {
        throw new Error("Unknown school link (?t=" + tenantSlug + "). Check tenants.json.");
      }
      window.DrivePilot._tenantLabel = row.label;
      fileId = await window.DrivePilotLoader.resolveClassDataFileId({
        classDataFileId: row.classDataFileId,
        folderId: row.folderId,
        classDataFileName: row.classDataFileName,
        apiKey,
      });
    }

    return { fileId, apiKey };
  }

  window.DrivePilot = {
    async start() {
      try {
        const { fileId, apiKey } = await resolveFileId();
        if (fileId) {
          const text = await window.DrivePilotLoader.loadClassDataJson(fileId, apiKey);
          await applyClassDataText(text);
          return;
        }
      } catch (err) {
        console.error(err);
        state.view = "upload";
        if (typeof render === "function") render();
        const msg = $("uploadMsg");
        if (msg) {
          msg.textContent = "Could not load class data: " + err.message;
        }
        return;
      }

      if (typeof bootstrapAdventuresCore === "function") {
        await bootstrapAdventuresCore();
        return;
      }
      if (typeof render === "function") render();
    },

    showBanner() {
      const el = document.getElementById("drive-pilot-banner");
      if (!el) return;
      const tenant = window.TenantRegistry?.tenantFromUrl();
      const fileId = window.DrivePilotLoader?.fileIdFromUrl();
      el.style.display = "block";
      let extra = "";
      if (window.DrivePilot._tenantLabel) {
        extra = " — " + window.DrivePilot._tenantLabel;
      } else if (tenant) {
        extra = " — school " + tenant;
      } else if (fileId) {
        extra = " (file " + fileId.slice(0, 8) + "…)";
      }
      el.innerHTML =
        "<strong>PILOT</strong> — Reading Adventures web" + extra;
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    window.DrivePilot.showBanner();
  });
})();
