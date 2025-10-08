import { getUrl } from "../utils";

const m3u8ContentTypes: string[] = [
  "application/vnd.",
  "video/mp2t",
  "application/x-mpegurl",
  "application/mpegurl",
  "application/x-mpegurl",
  "application/vnd.apple.mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "video/x-mpegurl",
  "application/vnd.apple.mpegurl.audio",
  "application/vnd.apple.mpegurl.video",
];

type ScrapeHeaders =
  | string
  | null
  | {
      [key: string]: string;
    };

export const M3u8ProxyV2 = async (
  request: Request<unknown>
): Promise<Response> => {
  const url = new URL(request.url);

  const scrapeUrlString = url.searchParams.get("url");
  const scrapeHeadersString = url.searchParams.get("headers");

  // ✅ FIXED: Check before using new URL() to avoid "Invalid URL"
  if (!scrapeUrlString) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "no scrape url provided",
      }),
      { status: 400 }
    );
  }

  // Safe to construct the target URL now
  let scrapeUrl: URL;
  try {
    scrapeUrl = new URL(scrapeUrlString);
  } catch {
    return new Response(
      JSON.stringify({
        success: false,
        message: "malformed scrape url",
      }),
      { status: 400 }
    );
  }

  // Parse optional headers
  let scrapeHeadersObject: ScrapeHeaders = null;
  if (scrapeHeadersString) {
    try {
      scrapeHeadersObject = JSON.parse(scrapeHeadersString);
    } catch (e) {
      console.log("[M3u8 Proxy V2] Malformed scrape headers, using default");
      scrapeHeadersObject = null;
    }
  }

  // Prepare headers for the outgoing request
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...(typeof scrapeHeadersObject === "object" ? scrapeHeadersObject : {}),
  };

  // Include range if present
  const rangeHeader = request.headers.get("Range");
  if (rangeHeader) {
    headers["Range"] = rangeHeader;
  }

  // Fetch the target URL
  const response = await fetch(scrapeUrlString, {
    headers,
    method: request.method,
  });

  // Inspect response content type
  const responseContentType = response.headers.get("Content-Type")?.toLowerCase();
  let responseBody: BodyInit | null = response.body;

  const isM3u8 =
    scrapeUrl.pathname.endsWith(".m3u8") ||
    (responseContentType &&
      m3u8ContentTypes.some((name) => responseContentType.includes(name)));

  // ✅ Adjust m3u8 playlist contents if necessary
  if (isM3u8) {
    const m3u8File = await response.text();
    const m3u8FileChunks = m3u8File.split("\n");
    const m3u8AdjustedChunks: string[] = [];

    for (const line of m3u8FileChunks) {
      // Comments / metadata lines
      if (line.startsWith("#") || !line.trim()) {
        if (line.startsWith('#EXT-X-MAP:URI="')) {
          const uri = line.replace('#EXT-X-MAP:URI="', "").replace('"', "");
          const segmentUrl = getUrl(uri, scrapeUrl);
          const searchParams = new URLSearchParams();
          searchParams.set("url", segmentUrl.toString());
          if (scrapeHeadersString) searchParams.set("headers", scrapeHeadersString);
          m3u8AdjustedChunks.push(`#EXT-X-MAP:URI="/v2?${searchParams.toString()}"`);
        } else if (line.toLowerCase().includes("uri") || line.toLowerCase().includes("url")) {
          const topKey = line.split(":")[0];
          const values = line.split(":")[1].split(",");
          const m3u8LineObject: Record<string, string> = {};

          for (const value of values) {
            const [key, val] = value.split("=");
            if (!key || !val) continue;
            m3u8LineObject[key.trim()] = val.trim().replace(/"/g, "");
          }

          if (m3u8LineObject["URI"]) {
            const segmentUrl = getUrl(m3u8LineObject["URI"], scrapeUrl);
            const searchParams = new URLSearchParams();
            searchParams.set("url", segmentUrl.toString());
            if (scrapeHeadersString) searchParams.set("headers", scrapeHeadersString);
            m3u8LineObject["URI"] = `/v2?${searchParams.toString()}`;
          }

          if (m3u8LineObject["URL"]) {
            const segmentUrl = getUrl(m3u8LineObject["URL"], scrapeUrl);
            const searchParams = new URLSearchParams();
            searchParams.set("url", segmentUrl.toString());
            if (scrapeHeadersString) searchParams.set("headers", scrapeHeadersString);
            m3u8LineObject["URL"] = `/v2?${searchParams.toString()}`;
          }

          const reconstructedLine = `${topKey}:${Object.keys(m3u8LineObject)
            .map((key) => `${key}="${m3u8LineObject[key]}"`)
            .join(",")}`;

          m3u8AdjustedChunks.push(reconstructedLine);
        } else {
          m3u8AdjustedChunks.push(line);
        }
        continue;
      }

      // Direct segment line
      const segmentUrl = getUrl(line, scrapeUrl);
      const searchParams = new URLSearchParams();
      searchParams.set("url", segmentUrl.toString());
      if (scrapeHeadersString) searchParams.set("headers", scrapeHeadersString);

      m3u8AdjustedChunks.push(`/v2?${searchParams.toString()}`);
    }

    responseBody = m3u8AdjustedChunks.join("\n");
  }

  // Ensure proper CORS headers
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Access-Control-Allow-Origin", "*");

  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
