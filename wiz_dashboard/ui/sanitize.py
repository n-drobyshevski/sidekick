"""HTML sanitization helpers (uses bleach when available, else strips tags)."""

import re
from html import unescape as html_unescape

try:
    import bleach
except Exception:
    bleach = None

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text):
    if not isinstance(text, str):
        return text
    if "<" not in text:
        return text
    try:
        return html_unescape(_HTML_TAG_RE.sub("", text))
    except Exception:
        return _HTML_TAG_RE.sub("", text)


def sanitize_html(html_text, allow_style=False):
    """Sanitize HTML for safe rendering. Uses bleach if installed; otherwise
    falls back to stripping tags. When allow_style=True the 'style' attribute is
    permitted on div/span so internal widgets (bar widths/markers) still render.
    """
    if not isinstance(html_text, str):
        return ""
    # Remove any <script>...</script> blocks entirely.
    html_text = re.sub(
        r"<\s*script[^>]*>.*?<\s*/\s*script\s*>", "", html_text, flags=re.I | re.S
    )
    if bleach is not None:
        css_sanitizer = None
        try:
            from bleach.css_sanitizer import CSSSanitizer

            css_sanitizer = CSSSanitizer()
        except Exception:
            try:
                from bleach.sanitizer import CSSSanitizer

                css_sanitizer = CSSSanitizer()
            except Exception:
                css_sanitizer = None

        allowed_tags = list(getattr(bleach.sanitizer, "ALLOWED_TAGS", [])) or list(
            getattr(bleach, "ALLOWED_TAGS", [])
        )
        for t in ("div", "span", "br", "strong", "em", "b", "i", "u", "p"):
            if t not in allowed_tags:
                allowed_tags.append(t)
        allowed_attrs = {"*": ["class"]}
        if allow_style and css_sanitizer is not None:
            allowed_attrs.setdefault("div", []).append("style")
            allowed_attrs.setdefault("span", []).append("style")
        try:
            if allow_style and css_sanitizer is not None:
                return bleach.clean(
                    html_text,
                    tags=allowed_tags,
                    attributes=allowed_attrs,
                    strip=True,
                    css_sanitizer=css_sanitizer,
                )
            elif allow_style and css_sanitizer is None:
                return strip_html(html_text)
            else:
                return bleach.clean(
                    html_text, tags=allowed_tags, attributes=allowed_attrs, strip=True
                )
        except Exception:
            return strip_html(html_text)
    else:
        if allow_style:
            return re.sub(
                r"<\s*script[^>]*>.*?<\s*/\s*script\s*>",
                "",
                html_text,
                flags=re.I | re.S,
            )
        return strip_html(html_text)
