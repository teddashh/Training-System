"""Deployment identity. Runtime organization/logo overrides belong here."""
import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

logger = logging.getLogger(__name__)


def load_brand(root=None, name=None):
    name = os.getenv('BRAND', 'default') if name is None else name
    root = Path(root) if root is not None else Path(os.getenv(
        'LOCALE_ROOT', Path(__file__).resolve().parents[2] / 'shared' / 'locales')).parent / 'brand'
    if not re.fullmatch(r'[a-z0-9-]+', name):
        raise ValueError('BRAND must contain only lowercase letters, digits and hyphens.')
    path = root / name
    if not all((path / file).is_file() for file in ('brand.json', 'tokens.css', 'logo.svg', 'logo-horizontal.svg')):
        raise ValueError(f'Unknown or incomplete BRAND pack: {name}')
    data = json.loads((path / 'brand.json').read_text())
    for key in ('organization', 'title', 'logo_alt', 'email_footer'):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError(f'BRAND {name}: {key} must be a nonempty string.')
    return path, data


BRAND_PATH, BRAND = load_brand()
TOKENS = dict(re.findall(r'--([\w-]+):\s*([^;]+);', (BRAND_PATH / 'tokens.css').read_text()))


def brand_context(request):
    return {'brand': BRAND}


@lru_cache(maxsize=1)
def _pdf_artwork():
    """Decode the pack's horizontal logo once: ('png', bytes, width, height) or ('svg', root)."""
    import base64
    from io import BytesIO
    from defusedxml import ElementTree as ET
    from PIL import Image

    svg = (BRAND_PATH / 'logo-horizontal.svg').read_text()
    embedded = re.findall(r'<image([^>]*?)xlink:href="data:image/png;base64,([^"]+)"', svg)
    if not embedded:
        return ('svg', ET.fromstring(svg))
    colour = next(data for attrs, data in embedded if 'mask=' in attrs)
    mask = next(data for attrs, data in embedded if 'mask=' not in attrs)
    w, h = (float(value) for value in re.search(r'<image width="([\d.]+)" height="([\d.]+)" mask=', svg).groups())
    mask = Image.open(BytesIO(base64.b64decode(mask))).convert('L')
    image = Image.open(BytesIO(base64.b64decode(colour))).convert('RGB').resize(mask.size)
    image.putalpha(mask)
    output = BytesIO()
    image.save(output, format='PNG')
    return ('png', output.getvalue(), w, h)


def pdf_logo(width):
    """The pack artwork for PDFs, or None when it cannot be drawn (the PDF is then made without it).

    Supported artwork: an embedded colour PNG with a luminance mask (kept for existing company artwork) or
    plain SVG paths and text, so a new pack needs no other native image dependency.
    """
    try:
        return _pdf_drawing(width)
    except Exception:
        logger.exception('The brand logo cannot be drawn in a PDF; continuing without it.')
        return None


def _pdf_drawing(width):
    from io import BytesIO
    from reportlab.lib.colors import HexColor
    from reportlab.graphics.shapes import Drawing, Group, String
    from reportlab.graphics.svgpath import SvgPath
    from reportlab.platypus import Image as PdfImage

    from .runtime_settings import stored
    row = stored()
    if row.logo:
        scale = min(width / row.logo_width, width * 0.6 / row.logo_height)
        return PdfImage(BytesIO(bytes(row.logo)), width=row.logo_width * scale,
                        height=row.logo_height * scale, mask='auto')
    art = _pdf_artwork()
    if art[0] == 'png':
        _, data, w, h = art
        return PdfImage(BytesIO(data), width=width, height=width * h / w, mask='auto')
    root = art[1]
    x, y, w, h = map(float, root.attrib['viewBox'].split())
    scale = width / w
    drawing = Drawing(width, h * scale)
    paths = Group()
    paths.transform = (scale, 0, 0, -scale, -x * scale, (y + h) * scale)
    for node in root:
        tag = node.tag.rsplit('}', 1)[-1]
        fill = HexColor(node.get('fill', '#000000'))
        if tag == 'path':
            paths.add(SvgPath(node.attrib['d'], fillColor=fill, strokeColor=None))
        elif tag == 'text':
            drawing.add(String((float(node.get('x', 0)) - x) * scale,
                (y + h - float(node.get('y', 0))) * scale, ''.join(node.itertext()),
                fontName='Helvetica', fontSize=float(node.get('font-size', 16)) * scale,
                fillColor=fill, textAnchor=node.get('text-anchor', 'start')))
        elif tag not in ('title', 'desc'):
            raise ValueError(f'Unsupported PDF logo SVG element: {tag}; use plain paths and text.')
    drawing.add(paths)
    return drawing
