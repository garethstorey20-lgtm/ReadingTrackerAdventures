/**
 * PILOT ONLY — load class-data.json from a public Google Drive file.
 * Not for final production without stronger privacy controls.
 */
(function () {
  const CONFIG = window.DRIVE_PILOT_CONFIG || {};

  function fileIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("dataId") ||
      params.get("driveId") ||
      params.get("id") ||
      CONFIG.fileId ||
      ""
    ).trim();
  }

  function apiKeyFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (params.get("apiKey") || CONFIG.apiKey || "").trim();
  }

  function exportDownloadUrl(fileId) {
    return (
      "https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId)
    );
  }

  function apiMediaUrl(fileId, apiKey) {
    return (
      "https://www.googleapis.com/drive/v3/files/" +
      encodeURIComponent(fileId) +
      "?alt=media&key=" +
      encodeURIComponent(apiKey)
    );
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
      throw new Error("Drive returned a web page, not JSON. Try adding an API key (see README).");
    }
    return text;
  }

  async function loadClassDataJson(fileId, apiKey) {
    const errors = [];

    if (apiKey) {
      try {
        return await fetchText(apiMediaUrl(fileId, apiKey));
      } catch (e) {
        errors.push("Google API: " + e.message);
      }
    }

    try {
      return await fetchText(exportDownloadUrl(fileId));
    } catch (e) {
      errors.push("Drive export link: " + e.message);
    }

    throw new Error(
      "Could not load class data from Google Drive.\n" +
        errors.join("\n") +
        "\n\nBrowsers often block direct Drive links (CORS). " +
        "Add a free Google API key in drive-config.js (see README Step 5)."
    );
  }

  window.DrivePilotLoader = {
    isPilot: true,
    fileIdFromUrl,
    apiKeyFromUrl,
    loadClassDataJson,
    exportDownloadUrl,
  };
})();
