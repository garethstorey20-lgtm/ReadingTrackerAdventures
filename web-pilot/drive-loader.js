/**
 * PILOT — load class-data.json from Google Drive (file id or folder + API key).
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

  async function findFileInFolder(folderId, fileName, apiKey) {
    if (!folderId || !apiKey) return null;
    const q =
      "'" +
      folderId +
      "' in parents and name='" +
      fileName.replace(/'/g, "\\'") +
      "' and trashed=false";
    const url =
      "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(q) +
      "&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true&key=" +
      encodeURIComponent(apiKey);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Drive folder lookup HTTP " + res.status);
    const data = await res.json();
    const files = data.files || [];
    if (!files.length) return null;
    return files[0].id;
  }

  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
      throw new Error("Drive returned a web page, not JSON. Add a Google API key.");
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
        "\n\nAdd a Google API key in drive-config.js (see README)."
    );
  }

  async function resolveClassDataFileId(options) {
    if (options.classDataFileId) return options.classDataFileId;
    if (options.folderId && options.apiKey) {
      const name = options.classDataFileName || "class-data.json";
      const id = await findFileInFolder(options.folderId, name, options.apiKey);
      if (id) return id;
      throw new Error(
        "No " +
          name +
          " found in the Google Drive folder yet. Ask your teacher to save/upload it."
      );
    }
    return null;
  }

  window.DrivePilotLoader = {
    isPilot: true,
    fileIdFromUrl,
    apiKeyFromUrl,
    loadClassDataJson,
    findFileInFolder,
    resolveClassDataFileId,
    exportDownloadUrl,
  };
})();
