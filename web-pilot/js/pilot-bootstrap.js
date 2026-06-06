/**
 * PILOT ONLY — start Reading Adventures from Google Drive class-data.json
 */
(function () {
  window.DrivePilot = {
    async start() {
      const fileId = window.DrivePilotLoader?.fileIdFromUrl();
      const apiKey = window.DrivePilotLoader?.apiKeyFromUrl();

      if (fileId) {
        try {
          const text = await window.DrivePilotLoader.loadClassDataJson(fileId, apiKey);
          if (typeof parseClassDataJson === "function") {
            await loadClassDataFromText(text);
          } else if (typeof loadClassDataFromText === "function") {
            await loadClassDataFromText(text);
          } else {
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
          }
          window.DrivePilot._loadedFromDrive = true;
          if (typeof render === "function") render();
          return;
        } catch (err) {
          console.error(err);
          state.view = "upload";
          if (typeof render === "function") render();
          const msg = $("uploadMsg");
          if (msg) {
            msg.textContent =
              "Could not load class data from Google Drive: " + err.message;
          }
          return;
        }
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
      const fileId = window.DrivePilotLoader?.fileIdFromUrl();
      el.style.display = "block";
      el.innerHTML =
        '<strong>PILOT</strong> — Web version loading class data from Google Drive' +
        (fileId ? ' <span class="opacity-70">(file ' + fileId.slice(0, 8) + "…)</span>" : "") +
        ' — not for final release.';
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    window.DrivePilot.showBanner();
  });
})();
