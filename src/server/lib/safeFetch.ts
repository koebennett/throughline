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

function privateV4(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224
  );
}

/** Expand any IPv6 text form (incl. embedded dotted IPv4) to 8 16-bit groups. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().split("%")[0];
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

/** True for loopback, private, link-local, CGNAT, metadata, multicast, and any IPv6 form embedding them. */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return privateV4(a, b);
  }
  const g = expandV6(ip);
  if (!g) return true; // unparseable → refuse
  const embedded = (hi: number, lo: number) => privateV4(hi >> 8, hi & 0xff) || (hi === 0 && lo <= 1);
  const zeros = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeros(8) || (zeros(7) && g[7] === 1)) return true; // :: and ::1
  if (zeros(5) && g[5] === 0xffff) return embedded(g[6], g[7]); // IPv4-mapped (any notation)
  if (zeros(6)) return true; // IPv4-compatible (deprecated) — refuse outright
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64
  if (g[0] === 0x2002) return embedded(g[1], g[2]) || true; // 6to4 relays can reach arbitrary IPv4 — refuse
  if (g[0] === 0x2001 && g[1] === 0) return true; // Teredo
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0) return true; // link-local, site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
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
    // Total deadline (the socket `timeout` below is only an idle timeout).
    const deadline = setTimeout(() => req.destroy(new Error("Request timed out")), timeoutMs);
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: { "user-agent": "Throughline-Research/0.1 (+local content strategy tool)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
      },
      (res) => {
        // Defence in depth: verify the address actually connected to (covers IP literals and any lookup bypass).
        const remote = res.socket?.remoteAddress;
        if (remote && isPrivateIp(remote)) {
          res.destroy();
          return reject(new UnsafeUrlError("Connected address is private"));
        }
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
    req.on("error", (e) => (clearTimeout(deadline), reject(e)));
    req.on("close", () => clearTimeout(deadline));
    req.end();
  });
}

/** Extract readable metadata + text from HTML without executing anything. Output is untrusted data. */
/** Iterate tags of one name with indexOf (linear), yielding attribute maps. Tags are capped at 2 KB. */
function* tags(html: string, name: string): Generator<Record<string, string>> {
  const lower = html.toLowerCase();
  const open = `<${name}`;
  let i = 0;
  while ((i = lower.indexOf(open, i)) !== -1) {
    const after = lower.charCodeAt(i + open.length);
    const end = lower.indexOf(">", i);
    if (end === -1) return;
    if (!(after === 32 || after === 9 || after === 10 || after === 13 || after === 47 || after === 62) || end - i > 2048) {
      i += open.length;
      continue;
    }
    const attrs: Record<string, string> = {};
    const re = /([a-zA-Z:_-]{1,40})\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    const src = html.slice(i + open.length, end);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
    yield attrs;
    i = end + 1;
  }
}

/** Remove <tag>…</tag> blocks with indexOf scanning (linear; unclosed blocks drop the remainder). */
function stripBlocks(html: string, names: string[]): string {
  let lower = html.toLowerCase();
  for (const n of names) {
    let out = "";
    let i = 0;
    for (;;) {
      const s = lower.indexOf(`<${n}`, i);
      if (s === -1) {
        out += html.slice(i);
        break;
      }
      out += html.slice(i, s) + " ";
      const close = lower.indexOf(`</${n}`, s + n.length + 1);
      if (close === -1) break;
      const gt = lower.indexOf(">", close);
      i = gt === -1 ? html.length : gt + 1;
    }
    html = out;
    lower = html.toLowerCase();
  }
  return html;
}

/** Extract readable metadata + text from HTML without executing anything. Output is untrusted data. */
export function extractPage(fullHtml: string, url: string) {
  const head = fullHtml.slice(0, 131_072);
  const html = fullHtml.slice(0, 1_000_000);
  const metas = [...tags(head, "meta")];
  const meta = (name: string) => decode((metas.find((m) => (m.property ?? m.name ?? m.itemprop ?? "").toLowerCase() === name.toLowerCase())?.content ?? "").trim());
  const lowerHead = head.toLowerCase();
  const ts = lowerHead.indexOf("<title");
  const te = ts === -1 ? -1 : lowerHead.indexOf("</title", ts);
  const titleTag = ts !== -1 && te !== -1 ? decode(head.slice(head.indexOf(">", ts) + 1, te).trim()).slice(0, 500) : "";
  const title = meta("og:title") || titleTag || url;
  const publisher = meta("og:site_name") || new URL(url).hostname.replace(/^www\./, "");
  const jsonLdIdx = html.indexOf('"datePublished"');
  const jsonLdDate = jsonLdIdx === -1 ? "" : (html.slice(jsonLdIdx, jsonLdIdx + 120).match(/"datePublished"\s{0,5}:\s{0,5}"([^"]{1,60})"/)?.[1] ?? "");
  const timeTag = [...tags(html.slice(0, 200_000), "time")].find((t) => t.datetime)?.datetime ?? "";
  const published = meta("article:published_time") || meta("datePublished") || jsonLdDate || timeTag;
  const description = meta("og:description") || meta("description");
  const text = decode(
    stripBlocks(html, ["script", "style", "noscript", "svg", "nav", "footer", "header", "form"])
      .replace(/<br\s*\/?>|<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
      .replace(/<[^<>]{0,4000}>/g, " ") // bounded + excludes "<": linear even without closing ">"
      .replace(/</g, " "),
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
