"""Turns an alert into an HTML email and a plain-text copy.

Every alert uses the same layout: a navy header with the SquadSense name
and the alert's title, an opening sentence, a table of rows (for the
briefs), an optional highlighted note, a lime button to the matching
page, and a footer naming the sync that sent it.

Mail apps ignore style sheets and many ignore modern layout, so the HTML
is built from tables with inline styles. Every piece of text goes through
html.escape, because player names and FPL news are outside data.
"""

from datetime import datetime
from html import escape

from .briefs import UK

NAVY = "#0B1220"
CARD = "#16213A"
LINE = "#26324D"
TEXT = "#E8EDF7"
MUTED = "#9AA6BF"
LIME = "#B7F34A"
ORANGE = "#FFA24C"
TAG_COLORS = {"FIRM": LIME, "MAKE NOW": ORANGE, "CLOSE CALL": MUTED, "DONE": TEXT}
FONT = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
PAGE_NAMES = {"/plan": "Open your plan", "/prices": "Open Price Watch", "/": "Open SquadSense"}


def footer_line(sent_at):
    """'Sent by SquadSense after the 16:17 UK sync.'"""
    return f"Sent by SquadSense after the {sent_at.astimezone(UK):%H:%M} UK sync."


EMAILS_OFF_LINE = "To stop these emails, turn alert emails off in the bell menu on the website."


def page_link(site_url, path):
    """The full link to the alert's page, or the bare path when no site address is set."""
    return f"{site_url}{path}" if site_url else path


def tag_html(tag):
    """A small colored label like FIRM or CLOSE CALL."""
    if not tag:
        return ""
    color = TAG_COLORS.get(tag, MUTED)
    return (f'<span style="display:inline-block;padding:2px 8px;border:1px solid {color};border-radius:4px;'
            f'color:{color};font-size:11px;font-weight:700;letter-spacing:0.04em;white-space:nowrap">{escape(tag)}</span>')


def rows_html(rows):
    """The brief's rows as a three-column table: label, advice, tag."""
    if not rows:
        return ""
    lines = "".join(
        f'<tr><td style="padding:10px 0;border-top:1px solid {LINE};color:{MUTED};font-size:12px;'
        f'text-transform:uppercase;letter-spacing:0.06em;width:90px;vertical-align:top">{escape(row.label)}</td>'
        f'<td style="padding:10px 8px;border-top:1px solid {LINE};color:{TEXT};font-size:15px;vertical-align:top">{escape(row.value)}</td>'
        f'<td style="padding:10px 0;border-top:1px solid {LINE};text-align:right;vertical-align:top">{tag_html(row.tag)}</td></tr>'
        for row in rows
    )
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px">{lines}</table>'


def note_html(note):
    """The highlighted note under the rows, edged in orange."""
    if not note:
        return ""
    return (f'<p style="margin:16px 0 0;padding:10px 12px;border-left:3px solid {ORANGE};background:{NAVY};'
            f'color:{TEXT};font-size:14px">{escape(note)}</p>')


def render_html(alert, link, sent_at):
    """The whole HTML email."""
    intro = alert.intro or alert.body
    button = PAGE_NAMES.get(alert.path, "Open SquadSense")
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{escape(alert.title)}</title></head>
<body style="margin:0;padding:0;background:{NAVY};font-family:{FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{NAVY}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 12px">
<span style="color:{LIME};font-size:13px;font-weight:700;letter-spacing:0.12em">SQUADSENSE</span>
<h1 style="margin:6px 0 0;color:{TEXT};font-size:22px;line-height:1.25">{escape(alert.title)}</h1>
</td></tr>
<tr><td style="background:{CARD};border:1px solid {LINE};border-radius:10px;padding:20px">
<p style="margin:0;color:{TEXT};font-size:15px;line-height:1.5">{escape(intro)}</p>
{rows_html(alert.rows)}{note_html(alert.note)}
<p style="margin:22px 0 0"><a href="{escape(link)}" style="display:inline-block;background:{LIME};color:{NAVY};text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:6px">{button}</a></p>
</td></tr>
<tr><td style="padding:14px 4px 0;color:{MUTED};font-size:12px;line-height:1.5">
{escape(footer_line(sent_at))} You get these because alerts are on for your FPL team. Times are UK time.<br>
{escape(EMAILS_OFF_LINE)}
</td></tr>
</table></td></tr></table>
</body></html>"""


def render_text(alert, link, sent_at):
    """The plain-text copy, for mail apps that don't show HTML."""
    lines = [alert.title, "", alert.intro or alert.body, ""]
    lines += [f"{row.label}: {row.value}" + (f" [{row.tag}]" if row.tag else "") for row in alert.rows]
    if alert.note:
        lines += ["", alert.note]
    lines += ["", f"{PAGE_NAMES.get(alert.path, 'Open SquadSense')}: {link}", "", footer_line(sent_at), EMAILS_OFF_LINE]
    return "\n".join(lines)


def render_email(alert, site_url, sent_at: datetime):
    """(html, text) for one alert. `site_url` may be empty; `sent_at` names the sync."""
    link = page_link(site_url, alert.path)
    return render_html(alert, link, sent_at), render_text(alert, link, sent_at)
