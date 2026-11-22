// Text utilities: normalisation, near-duplicate detection, untrusted-content fencing.

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(
  "a an and are as at be by for from how i in is it my of on or our that the this to we what why with you your vs".split(" "),
);

export function tokens(s: string): string[] {
  return normalise(s)
    .split(" ")
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function shingles(s: string, n = 3): Set<string> {
  const t = normalise(s).replace(/ /g, "_");
  const out = new Set<string>();
  if (t.length <= n) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Blend of character-trigram and word-set similarity, 0–1. Robust to small rewordings. */
export function similarity(a: string, b: string): number {
  const c = jaccard(shingles(a), shingles(b));
  const w = jaccard(new Set(tokens(a)), new Set(tokens(b)));
  return Math.round((0.6 * c + 0.4 * w) * 1000) / 1000;
}

export interface DuplicateHit {
  id: string;
  text: string;
  similarity: number;
}

export function findNearDuplicates(
  text: string,
  corpus: { id: string; text: string }[],
  threshold = 0.55,
): DuplicateHit[] {
  return corpus
    .map((c) => ({ id: c.id, text: c.text, similarity: similarity(text, c.text) }))
    .filter((h) => h.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity);
}

/**
 * Wrap untrusted text (web pages, transcripts, comments, uploaded files, connected data) so the model
 * treats it strictly as data. Strips our own fence markers to prevent fence-breaking.
 */
export function fenceUntrusted(label: string, text: string, maxChars = 12000): string {
  const clean = text.replace(/<\/?untrusted[^>]*>/gi, "").slice(0, maxChars);
  return `<untrusted source="${label.replace(/"/g, "'").slice(0, 120)}">\n${clean}\n</untrusted>`;
}

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Split long text into retrieval chunks on paragraph boundaries, carrying the nearest markdown heading. */
export function chunkText(text: string, target = 900): { heading: string; text: string }[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const out: { heading: string; text: string }[] = [];
  let heading = "";
  let buf = "";
  const flush = () => {
    if (buf.trim()) out.push({ heading, text: buf.trim() });
    buf = "";
  };
  for (const p of paras) {
    const h = p.match(/^#{1,6}\s+(.+)$/m);
    if (h && p.trim().startsWith("#")) {
      flush();
      heading = h[1].trim().slice(0, 200);
    }
    if ((buf + "\n\n" + p).length > target && buf) flush();
    if (p.length > target * 2) {
      for (let i = 0; i < p.length; i += target) {
        buf = p.slice(i, i + target);
        flush();
      }
    } else buf = buf ? buf + "\n\n" + p : p;
  }
  flush();
  return out;
}
