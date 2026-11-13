"""The shared cover library (`shared/brand/covers.json`) and the scene suggestion rule."""
import json
from functools import lru_cache
from pathlib import Path

from django.conf import settings

FALLBACK_THEMES = ('Learning spaces', 'Office spaces')


@lru_cache(maxsize=1)
def catalog():
    return tuple(json.loads((Path(settings.LOCALE_ROOT).parent / 'brand' / 'covers.json').read_text()))


def cover_ids():
    return {item['id'] for item in catalog()}


def scenes():
    return [item for item in catalog() if item['id'].startswith('scene-')]


def keyword_scene(text):
    """The rule of suggestCover in frontend/src/CourseCover.tsx: first scene with a keyword in the text."""
    query = (text or '').lower()
    return next((item['id'] for item in scenes() if any(keyword in query for keyword in item.get('keywords', []))), None)


def scene_for(course_id, title, category=''):
    """Title first, then category; otherwise spread courses over the learning and office scenes by id."""
    found = keyword_scene(title) or keyword_scene(category)
    if found:
        return found
    pool = [item['id'] for theme in FALLBACK_THEMES for item in scenes() if item['category'] == theme]
    return pool[course_id % len(pool)]
