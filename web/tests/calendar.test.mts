// Checks for the deadline calendar in lib/calendar.ts: which gameweeks get
// an event, the event's times, reminders and id, and the iCalendar
// formatting rules (line ends, escaping, folding).
// Run with: npm test

import { calendarToken, deadlineCalendar, escapeText, foldLine } from "../lib/calendar.ts";

// Prints PASS or FAIL for one check, and makes the run fail if any check fails.
const check = (label: string, cond: boolean) => {
  console.log(cond ? "PASS" : "FAIL", label);
  if (!cond) process.exitCode = 1;
};

const now = new Date("2026-11-24T12:00:00Z");
const events = [
  { id: 11, deadline_time: "2026-11-21T11:00:00Z" }, // already passed
  { id: 12, deadline_time: "2026-11-28T11:00:00Z" },
  { id: 13, deadline_time: "2026-12-02T18:30:00Z" },
];
const feed = deadlineCalendar(events, "https://squadsense.test", now);

check("starts and ends as a calendar", feed.startsWith("BEGIN:VCALENDAR\r\n") && feed.endsWith("END:VCALENDAR\r\n"));
check("one event per future deadline", (feed.match(/BEGIN:VEVENT/g) ?? []).length === 2);
check("past gameweeks are left out", !feed.includes("GW11"));
check("summary names the gameweek", feed.includes("SUMMARY:FPL GW12 deadline"));
check("starts 2 hours before the deadline", feed.includes("DTSTART:20261128T090000Z"));
check("ends at the deadline", feed.includes("DTEND:20261128T110000Z"));
check("fixed id per gameweek", feed.includes("UID:squadsense-deadline-gw13@squadsense"));
check("two reminders per event", (feed.match(/BEGIN:VALARM/g) ?? []).length === 4);
check("reminder at the start and 90 minutes in", feed.includes("TRIGGER:PT0S") && feed.includes("TRIGGER:PT90M"));
check("links to the plan page", feed.includes("URL:https://squadsense.test/plan"));
check("every line ends with CRLF", !feed.replace(/\r\n/g, "").includes("\n"));
check("no line longer than 75 characters", feed.split("\r\n").every((line) => line.length <= 75));

const empty = deadlineCalendar([{ id: 38, deadline_time: "2026-05-24T13:30:00Z" }], "https://squadsense.test", now);
check("season over gives a calendar with no events", empty.includes("BEGIN:VCALENDAR") && !empty.includes("VEVENT"));

check("commas, semicolons and backslashes are escaped", escapeText("a,b;c\\d") === "a\\,b\\;c\\\\d");
check("new lines are escaped", escapeText("one\ntwo") === "one\\ntwo");
const folded = foldLine("DESCRIPTION:" + "x".repeat(150));
check("long lines fold with a leading space", folded.split("\r\n").length === 3 && folded.split("\r\n")[1].startsWith(" "));
check("folded lines are at most 75 characters", folded.split("\r\n").every((line) => line.length <= 75));
check("short lines are left alone", foldLine("SUMMARY:hi") === "SUMMARY:hi");

const token = await calendarToken("s".repeat(40));
check("token is 32 hex characters", /^[0-9a-f]{32}$/.test(token));
check("token is the same every time", token === (await calendarToken("s".repeat(40))));
check("a different secret gives a different token", token !== (await calendarToken("t".repeat(40))));
