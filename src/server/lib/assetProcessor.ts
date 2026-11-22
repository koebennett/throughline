// AssetProcessor: ingest user-owned files. Text formats are extracted; media files are recorded as metadata only
// (bytes are not stored — edit from your original local file). No remote media is ever downloaded.
export const TEXT_EXT = ["txt", "md", "markdown", "srt", "vtt", "csv", "json"];
export const MEDIA_EXT = ["mp4", "mov", "m4v", "webm", "mp3", "wav", "m4a", "png", "jpg", "jpeg", "gif", "webp", "pdf"];
export const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export interface Ingested {
  kind: "transcript" | "document" | "video" | "audio" | "image";
  text: string;
  note: string;
}

export function safeFilename(name: string): string {
  return (name.split(/[\\/]/).pop() ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 200) || "file";
}

export function ingestFile(filename: string, bytes: Uint8Array): Ingested {
  const name = safeFilename(filename);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXT.includes(ext)) {
    if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error("Text files must be 5 MB or smaller.");
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes).split("\u0000").join("");
    if (ext === "srt" || ext === "vtt") return { kind: "transcript", text: subtitlesToText(raw), note: "Subtitle cues converted to timestamped text." };
    return { kind: /transcript|captions?/i.test(name) ? "transcript" : "document", text: raw, note: "" };
  }
  if (MEDIA_EXT.includes(ext)) {
    const kind = ["mp4", "mov", "m4v", "webm"].includes(ext) ? "video" : ["mp3", "wav", "m4a"].includes(ext) ? "audio" : "image";
    return { kind, text: "", note: "Metadata only — file bytes are not stored. Paste or upload a transcript to repurpose it." };
  }
  throw new Error(`Unsupported file type ".${ext}". Text: ${TEXT_EXT.join(", ")}; media (metadata only): ${MEDIA_EXT.join(", ")}.`);
}

/** SRT/VTT → "[mm:ss] text" lines, merging cues into ~sentence blocks. */
export function subtitlesToText(raw: string): string {
  const lines = raw.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let ts = "";
  for (const line of lines) {
    const m = line.match(/^(\d{2}):(\d{2}):(\d{2})[.,]\d{3}\s+-->/);
    if (m) {
      const h = Number(m[1]);
      ts = h ? `${h}:${m[2]}:${m[3]}` : `${m[2]}:${m[3]}`;
      continue;
    }
    if (!line.trim() || /^\d+$/.test(line.trim()) || /^WEBVTT/.test(line) || /^NOTE/.test(line)) continue;
    const text = line.replace(/<[^<>]{0,500}>/g, "").trim();
    if (ts) {
      out.push(`[${ts}] ${text}`);
      ts = "";
    } else if (out.length) out[out.length - 1] += ` ${text}`;
  }
  return out.join("\n");
}
