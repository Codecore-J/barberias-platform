// Runtime config: Docker may set API_URL at container startup.
// Static hosting leaves it unset so Angular uses the environment fallback.
window.__env = window.__env || {};