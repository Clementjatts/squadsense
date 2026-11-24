// The deadline calendar: every FPL deadline left this season as an
// iCalendar file a phone can subscribe to. It's a backup for the alert
// emails, so it reads deadlines straight from FPL and works even when the
// GitHub sync doesn't run.
//
// Each gameweek is one event from 2 hours before the deadline to the
// deadline, with a reminder at its start and another 90 minutes in (30
// minutes before the deadline). The event's id is fixed per gameweek, so
// when FPL moves a deadline the phone updates the event in place.
//
// Format rules (RFC 5545): lines end in CRLF, long lines are folded at 75
// characters with a leading space, and commas, semicolons and backslashes
// in text are escaped.

export interface FplEvent {
  id: number;
  deadline_time: string;
}

const LEAD_HOURS = 2; // the event starts this long before the deadline
const REMINDERS = ["PT0S", "PT90M"]; // after the event starts: 2 hours and 30 minutes before the deadline
const MAX_LINE = 75;

/** Text made safe for an iCalendar value. */
export function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** One content line split into pieces of at most 75 characters, joined by CRLF and a space. */
export function foldLine(line: string): string {
  if (line.length <= MAX_LINE) return line;
  const pieces = [line.slice(0, MAX_LINE)];
  // Later pieces start with a space, which counts towards their 75.
  for (let start = MAX_LINE; start < line.length; start += MAX_LINE - 1) {
    pieces.push(" " + line.slice(start, start + MAX_LINE - 1));
  }
  return pieces.join("\r\n");
}

// A time in iCalendar's UTC form, like 20261128T110000Z.
function icsTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// The lines of one reminder.
function alarmLines(trigger: string, gameweek: number): string[] {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(`FPL GW${gameweek} deadline soon`)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

// The lines of one gameweek's event.
function eventLines(event: FplEvent, siteUrl: string, now: Date): string[] {
  const deadline = new Date(event.deadline_time);
  const start = new Date(deadline.getTime() - LEAD_HOURS * 60 * 60 * 1000);
  const plan = `${siteUrl}/plan`;
  return [
    "BEGIN:VEVENT",
    `UID:squadsense-deadline-gw${event.id}@squadsense`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(start)}`,
    `DTEND:${icsTime(deadline)}`,
    `SUMMARY:${escapeText(`FPL GW${event.id} deadline`)}`,
    `DESCRIPTION:${escapeText(`Make your transfers, lineup and captain on the FPL site before the deadline. Your plan: ${plan}`)}`,
    `URL:${plan}`,
    ...REMINDERS.flatMap((trigger) => alarmLines(trigger, event.id)),
    "END:VEVENT",
  ];
}

/** The whole calendar: one event per gameweek whose deadline is still to come. */
export function deadlineCalendar(events: FplEvent[], siteUrl: string, now: Date): string {
  const upcoming = events.filter((event) => new Date(event.deadline_time) > now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SquadSense//Deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:FPL deadlines",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...upcoming.flatMap((event) => eventLines(event, siteUrl, now)),
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** The secret part of the feed's address: an HMAC of "calendar-feed" with SITE_SECRET, 32 hex characters. */
export async function calendarToken(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode("calendar-feed"));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
