/**
 * PILOT — map ?t=tenant-slug to Google Drive folder / class-data.json
 */
(function () {
  const CONFIG = window.DRIVE_PILOT_CONFIG || {};

  function tenantFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("t") ||
      params.get("tenant") ||
      params.get("school") ||
      ""
    )
      .trim()
      .toLowerCase();
  }

  function tenantsJsonUrl() {
    const base = CONFIG.tenantsJsonUrl || "tenants.json";
    if (base.startsWith("http")) return base;
    return new URL(base, window.location.href).href;
  }

  let cache = null;
  let cacheAt = 0;
  const CACHE_MS = 60 * 1000;

  async function loadTenantsMap() {
    const now = Date.now();
    if (cache && now - cacheAt < CACHE_MS) return cache;
    const url = tenantsJsonUrl() + (tenantsJsonUrl().includes("?") ? "&" : "?") + "_=" + now;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Could not load tenants.json (HTTP " + res.status + ")");
    cache = await res.json();
    cacheAt = now;
    return cache;
  }

  async function resolveTenant(slug) {
    const key = String(slug || "").trim().toLowerCase();
    if (!key) return null;
    const map = await loadTenantsMap();
    const row = map[key];
    if (!row) return null;
    return {
      tenantId: key,
      label: row.label || key,
      provider: row.provider || "google-drive",
      folderId: (row.folderId || "").trim(),
      classDataFileId: (row.classDataFileId || row.fileId || "").trim(),
      classDataFileName: row.classDataFileName || "class-data.json",
    };
  }

  window.TenantRegistry = {
    tenantFromUrl,
    resolveTenant,
    loadTenantsMap,
  };
})();
