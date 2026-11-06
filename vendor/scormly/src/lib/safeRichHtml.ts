import DOMPurify from 'dompurify'

// Imported projects share the LMS author's origin. Rich text must never create
// executable elements, event handlers, forms or navigation containers there.
export function safeRichHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
      'del', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
      'pre', 'code', 'ul', 'ol', 'li', 'a', 'img', 'hr', 'table', 'caption',
      'colgroup', 'col', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
    ],
    ALLOWED_ATTR: [
      'class', 'style', 'href', 'title', 'src', 'alt', 'width', 'height',
      'colspan', 'rowspan', 'scope', 'start', 'reversed', 'type',
    ],
    ALLOW_DATA_ATTR: true,
    ALLOW_ARIA_ATTR: false,
  })
}
