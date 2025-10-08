export function getUrl(input: string, fallbackUrl?: URL): URL {
  try {
    // If input is a full URL (absolute)
    if (/^https?:\/\//i.test(input)) return new URL(input);

    // Handle protocol-relative URLs like //example.com
    if (input.startsWith("//")) return new URL("https:" + input);

    // Handle relative URLs, but only if fallbackUrl exists
    if (fallbackUrl) {
      const pathname = input.startsWith("/")
        ? input.substring(1)
        : input;

      const fallbackClone = new URL(fallbackUrl);
      const segments = fallbackClone.pathname.split("/");
      segments.pop(); // remove last file segment
      segments.push(pathname);
      fallbackClone.pathname = segments.join("/");

      return fallbackClone;
    }

    // If no fallback, return dummy base to prevent crash
    return new URL("https://example.com");
  } catch (e) {
    // As a last resort, return a harmless default
    return new URL("https://example.com");
  }
}
