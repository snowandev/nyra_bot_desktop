// Addresses that never leave this computer, where plain http exposes nothing on the network
function isLoopback(hostname: string) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host);
}

// True when requests to this address cross the network unencrypted, readable by anyone on the way
export function isUnencryptedRemote(baseUrl: string) {
  try {
    const url = new URL(baseUrl.trim());
    return url.protocol === "http:" && !isLoopback(url.hostname);
  } catch {
    // Not a valid URL yet (still being typed); connecting will report it
    return false;
  }
}

// The other computer a service runs on, or null when it is this one (or the address isn't valid yet)
export function remoteHostOf(baseUrl: string) {
  try {
    const { hostname } = new URL(baseUrl.trim());
    return isLoopback(hostname) ? null : hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}
