// iCalendar (RFC 5545) export for calendar entries.

function esc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function stamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = " " + rest.slice(74);
  }
  out.push(rest);
  return out.join("\r\n");
}

export interface IcsEvent {
  uid: string;
  start: string; // ISO
  durationMinutes?: number;
  summary: string;
  description?: string;
}

export function toIcs(calName: string, events: IcsEvent[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Throughline//Content Calendar//EN", `X-WR-CALNAME:${esc(calName)}`];
  const dtstamp = stamp(new Date().toISOString());
  for (const e of events) {
    const end = new Date(new Date(e.start).getTime() + (e.durationMinutes ?? 30) * 60000).toISOString();
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@throughline.local`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(end)}`,
      fold(`SUMMARY:${esc(e.summary)}`),
      ...(e.description ? [fold(`DESCRIPTION:${esc(e.description)}`)] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
