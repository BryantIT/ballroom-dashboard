const IPV4_PATTERN = /^\d+\.\d+\.\d+\.\d+$/;

/**
 * Extracts a studio slug candidate from an HTTP host header value.
 * Returns the leftmost label (lowercased) when the host has a subdomain,
 * or null for apex domains, localhost, and bare IPv4 hosts.
 */
export function extractSubdomainSlug(host: string): string | null {
  const hostname = host.replace(/:\d+$/, "");

  if (hostname === "localhost" || IPV4_PATTERN.test(hostname)) {
    return null;
  }

  const labels = hostname.split(".");
  if (labels.length <= 2) {
    return null;
  }

  return labels[0].toLowerCase();
}
