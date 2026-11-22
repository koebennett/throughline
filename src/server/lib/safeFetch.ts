// SSRF-resistant fetch for user-supplied public URLs (research page import).
// - http/https only, default ports only, no credentials in URL
// - DNS is resolved inside the socket connect via a validating `lookup`, so the IP actually connected to
//   is the one checked (defeats DNS rebinding between check and use)
// - private, loopback, link-local, CGNAT, multicast and metadata ranges are refused
// - redirects followed manually (max 3), each re-validated; size and time capped
import http from "node:http";
import https from "node:https";
import dns from "node:dns";
import net from "node:net";

export class UnsafeUrlError extends Error {}

export function validatePublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new UnsafeUrlError("URLs with embedded credentials are not allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new UnsafeUrlError("Non-standard ports are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal"))
    throw new UnsafeUrlError("Local hostnames are not allowed");
  if (net.isIP(host) && isPrivateIp(host)) throw new UnsafeUrlError("Private or reserved IP addresses are not allowed");
  return u;
}

export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) || a >= 224
    );
  }
  const v = ip.toLowerCase();
  if (v === "::1" || v === "::") return true;
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff") || v.startsWith("64:ff9b");
}

const safeLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { ...(options as dns.LookupOptions), all: true }, (err, addresses) => {
    if (err) return (cb as any)(err);
    const list = addresses as unknown as dns.LookupAddress[];
    const bad = list.find((a) => isPrivateIp(a.address));
    if (bad || !list.length) return (cb as any)(new UnsafeUrlError(`Host resolves to a private address`));
    if ((options as dns.LookupOptions).all) return (cb as any)(null, list);
    (cb as any)(null, list[0].address, list[0].family);
  });
};

export interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

export async function safeFetch(raw: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  let url = validatePublicUrl(raw);
  for (let hop = 0; hop <= 3; hop++) {
    const res = await requestOnce(url, timeoutMs, maxBytes);
    if (res.status >= 300 && res.status < 400 && res.location) {
      url = validatePublicUrl(new URL(res.location, url).toString());
      continue;
    }
    return { finalUrl: url.toString(), status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new UnsafeUrlError("Too many redirects");
}

function requestOnce(url: URL, timeoutMs: number, maxBytes: number) {
  return new Promise<{ status: number; contentType: string; body: string; location?: string }>((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { "user-agent": "Throughline-Research/0.1 (+local content strategy tool)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const contentType = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, contentType, body: "", location: String(res.headers.location ?? "") });
        }
        if (!/text\/|html|xml|json/.test(contentType)) {
          res.destroy();
          return reject(new UnsafeUrlError(`Unsupported content type: ${contentType || "unknown"}`));
        }
        let size = 0;
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new UnsafeUrlError("Response too large"));
          } else chunks.push(c);
        });
        res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
}

/** Extract readable metadata + text from HTML without executing anything. Output is untrusted data. */
export function extractPage(html: string, url: string) {
  const pick = (re: RegExp) => decode(html.match(re)?.[1]?.trim() ?? "");
  const meta = (name: string) =>
    pick(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i")) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"));
  const title = meta("og:title") || pick(/<title[^>]*>([^<]{1,500})<\/title>/i) || url;
  const publisher = meta("og:site_name") || new URL(url).hostname.replace(/^www\./, "");
  const published =
    meta("article:published_time") || meta("datePublished") || pick(/"datePublished"\s*:\s*"([^"]+)"/i) || pick(/<time[^>]+datetime=["']([^"']+)["']/i);
  const description = meta("og:description") || meta("description");
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return { title: title.slice(0, 500), publisher: publisher.slice(0, 300), publishedAt: published.slice(0, 40), description, text: text.slice(0, 60000) };
}

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) % 0x110000));
}
