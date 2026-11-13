"""Inline, table-based email layout. All inputs are plain values, never HTML."""
from .runtime_settings import organization
from .brand import BRAND, TOKENS

from html import escape
from unicodedata import category

FOOTER = BRAND["email_footer"]
TABLE = 'role="presentation" cellpadding="0" cellspacing="0" border="0"'
FONT = "font-family:Segoe UI, Arial, sans-serif;"
TEXT_LABELS = {"Assigned by": "By", "Reviewed by": "By", "Updated by": "By"}


def description_excerpt(description, limit=280):
    text = " ".join((description or "").split())
    if len(text) <= limit:
        return text
    excerpt = text[:limit]
    last_space = excerpt.rfind(" ")
    if last_space > limit - 80:
        excerpt = excerpt[:last_space]
    while excerpt and (excerpt[-1].isspace() or category(excerpt[-1]).startswith("P")):
        excerpt = excerpt[:-1]
    return excerpt + "…"


def render_email(*, title, next_step, event="", facts=(), note="", description="",
                 description_label="About this training", url="", button_label="Open training", footer=FOOTER, instruction_first=False):
    """Return matching text/HTML; facts are ordered (label, value) pairs."""
    parts = ([event + ".", "Training: " + title] if event else [title]) + [next_step]
    if instruction_first:
        parts = [next_step] + parts[:-1]
    parts.extend(f"{TEXT_LABELS.get(label, label)}: {value}" for label, value in facts)
    if note:
        parts.append("Note: " + note)
    if description:
        parts.append(description_label + ": " + description)
    if url:
        # Keep this label stable for existing mail filters, regardless of the button.
        parts.append("Open training: " + url)
    text = organization()["title"] + "\n\n" + "\n\n".join(parts) + "\n\n" + footer

    primary = TOKENS["brand-blue"]
    surface = TOKENS["surface"]
    muted_surface = TOKENS["surface-muted"]
    ink = TOKENS["ink"]
    muted_text = TOKENS["text-muted"]
    divider = TOKENS["stroke-subtle"]
    content = []
    if instruction_first:
        content.append('<p style="margin:0 0 24px;font-size:16px;line-height:1.5">' + escape(next_step) + '</p>')
    if event:
        content.append(f'<p style="margin:0 0 8px;font-size:12px;color:{muted_text};'
                       'text-transform:uppercase">' + escape(event) + '</p>')
    content.extend([
        '<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;'
        f'color:{primary};word-break:break-word">' + escape(title) + '</h1>',
        '<p style="margin:0 0 24px;font-size:16px;line-height:1.5">'
        + escape(next_step) + '</p>' if not instruction_first else '',
    ])
    if facts:
        rows = []
        for label, value in facts:
            value_html = escape(value)
            if label == "Meeting link":
                value_html = (f'<a style="color:{primary};word-break:break-word" href="'
                              + escape(value, quote=True) + '">' + value_html + '</a>')
            rows.append(
                '<tr><td width="140" valign="top" style="width:140px;padding:0 12px 12px 0;'
                f'font-size:13px;color:{muted_text};word-break:break-word">' + escape(label) + '</td>'
                '<td valign="top" style="padding:0 0 12px;font-size:15px;word-break:break-word">'
                + value_html + '</td></tr>')
        content.append(f'<table {TABLE} width="100%" style="{FONT}width:100%;table-layout:fixed;'
                       f'line-height:1.5;color:{ink};margin-bottom:12px">'
                       + ''.join(rows) + '</table>')
    if note:
        # Explicit breaks work in Outlook as well as clients that support pre-wrap.
        note_html = escape(note).replace('\r\n', '\n').replace('\r', '\n').replace('\n', '<br>')
        content.append(f'<table {TABLE} width="100%" style="{FONT}width:100%;table-layout:fixed;'
                       f'margin:0 0 24px"><tr><td style="border-left:4px solid {primary};background-color:{muted_surface};'
                       'padding:16px;font-size:15px;line-height:1.5;'
                       'word-break:break-word"><p style="margin:0 0 8px;font-size:12px;'
                       f'color:{muted_text}">Note</p><p style="margin:0;white-space:pre-wrap">'
                       + note_html + '</p></td></tr></table>')
    if description:
        content.append(f'<p style="margin:0 0 8px;font-size:12px;color:{muted_text}">'
                       + escape(description_label) + '</p>'
                       '<p style="margin:0 0 24px;font-size:15px;line-height:1.5;word-break:break-word">'
                       + escape(description) + '</p>')
    if url:
        content.append(
            f'<table {TABLE} style="{FONT}"><tr><td bgcolor="{primary}">'
            '<a href="' + escape(url, quote=True) + f'" style="display:inline-block;background-color:{primary};'
            f'border-top:12px solid {primary};border-bottom:12px solid {primary};'
            f'border-left:22px solid {primary};border-right:22px solid {primary};'
            f'color:{surface};font-size:16px;font-weight:600;line-height:1.5;text-decoration:none">'
            + escape(button_label) + '</a></td></tr></table>'
            f'<p style="margin:16px 0 8px;font-size:12px;line-height:1.5;color:{muted_text}">'
            'If the button does not work, copy this link into your browser:</p>'
            f'<p style="margin:0;font-size:12px;line-height:1.5;color:{muted_text};word-break:break-word">'
            + escape(url) + '</p>')

    html = (
        '<!doctype html><html lang="en"><head><meta name="viewport" '
        'content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:0">'
        f'<table {TABLE} width="100%" bgcolor="{muted_surface}" style="{FONT}width:100%;'
        f'background-color:{muted_surface};color:{ink}"><tr><td align="center" style="padding:16px 8px">'
        f'<table {TABLE} width="600" bgcolor="{surface}" style="width:100%;max-width:600px;'
        f'{FONT}table-layout:fixed;background-color:{surface};border:1px solid {divider};color:{ink}">'
        f'<tr><td bgcolor="{primary}" style="padding:20px 24px;background-color:{primary};'
        f'color:{surface};font-size:16px;font-weight:600">' + escape(organization()["title"]) + '</td></tr>'
        '<tr><td style="padding:24px;word-break:break-word">' + ''.join(content) + '</td></tr>'
        f'<tr><td style="border-top:1px solid {divider};padding:16px 24px;font-size:12px;'
        f'line-height:1.5;color:{muted_text}">' + escape(footer) + '</td></tr>'
        '</table></td></tr></table></body></html>'
    )
    return text, html
