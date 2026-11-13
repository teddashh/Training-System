#!/usr/bin/env python3
"""Build original editable training courses and example exams; never publish them."""
import argparse
import hashlib
import html
import json
import re
import zipfile
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from training.brand import BRAND, TOKENS

PLAYER = ROOT / 'vendor/scormly/public/scorm-player'
REFERENCES = {
    'Cybersecurity': [('CISA: Secure Our World', 'https://www.cisa.gov/secure-our-world')],
    'AI & data': [('OWASP: AI Agent Security', 'https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html'), ('European Commission: AI Act', 'https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai')],
    'Privacy': [('European Commission: Data protection', 'https://commission.europa.eu/law/law-topic/data-protection_en')],
    'Secure development': [('OWASP: Cheat Sheet Series', 'https://cheatsheetseries.owasp.org/index.html')],
    'Microsoft 365': [('Microsoft 365 training', 'https://support.microsoft.com/en-us/office/o365-itpro/train-your-users-on-office-and-microsoft-365')],
    'Collaboration': [('Microsoft: Share files and folders', 'https://support.microsoft.com/en-us/office/share-onedrive-files-and-folders-9fcc2f7d-de0c-4cec-93b0-a82024800c07')],
    'Governance': [('NIST: Cybersecurity Framework', 'https://www.nist.gov/cyberframework')],
    'Workplace skills': [('Microsoft: Create accessible Office documents', 'https://support.microsoft.com/en-us/office/create-accessible-office-documents')],
}
NOTICE = '''Original training scenario curriculum, authored 2026-11-10.
Lessons, fictional scenarios and questions were independently authored for this private workspace.
RansomLeak public topic directories informed topic coverage only. No RansomLeak lesson bodies,
SCORM files, images, scripts, audio or question banks are included or licensed by this package.
This is an introductory learning resource, not a copy of the RansomLeak simulations.
Company process owners must review drafts before publication, especially legal/privacy topics.
Further-reading links are references, not sources of copied passages or endorsements.
Player: vendored scormly, MIT; see PLAYER-LICENSE.txt. Company logo remains company property.
'''


def slug(value):
    return re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')


def read_groups(name, source=None):
    groups = []
    for line in (source or ROOT / 'content-library' / (name + '.txt')).read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        parts = [v.strip() for v in line.split(' | ')]
        if line.startswith('@ '):
            assert len(parts) == 2
            groups.append({'title': parts[0][2:], 'category': parts[1], 'topics': []})
        else:
            assert len(parts) == 6, line
            groups[-1]['topics'].append(dict(zip(('title', 'scenario', 'action', 'why', 'wrong1', 'wrong2'), parts)))
    return groups


def choices(topic):
    options = [topic['action'], topic['wrong1'], topic['wrong2']]
    offset = int(hashlib.sha256(topic['title'].encode()).hexdigest()[:2], 16) % 3
    options = options[offset:] + options[:offset]
    return options, options.index(topic['action'])


def question(topic, number):
    options, correct = choices(topic)
    return {'id': f'q-{number}', 'type': 'single', 'prompt': topic['scenario'] + ' What is the best next action?',
            'feedback': topic['why'], 'options': [{'id': f'o-{number}-{i}', 'text': text, 'correct': i == correct} for i, text in enumerate(options)]}


def block(kind, data, identifier):
    return {'id': identifier, 'type': kind, 'settings': {}, 'data': data}


def paragraph(text, identifier):
    return block('paragraph', {'html': '<p>' + html.escape(text) + '</p>'}, identifier)


def project(item, cover):
    lessons = []
    for i, topic in enumerate(item['topics']):
        prefix = f't{i}'
        teaching = [block('heading', {'level': 2, 'text': topic['title']}, prefix+'-h'),
                    paragraph(topic['scenario'], prefix+'-s'),
                    block('note', {'variant': 'tip', 'text': topic['action']}, prefix+'-a'),
                    paragraph(topic['why'], prefix+'-w')]
        check = block('quiz', {'questions': [question(topic, i)], 'passingScore': 100, 'showAnswers': True}, prefix+'-q')
        if len(item['topics']) == 1:
            lessons.extend([
                {'id': prefix+'-recognize', 'title': 'Recognize the risk', 'status': 'published', 'blocks': teaching[:2] + [teaching[3]]},
                {'id': prefix+'-respond', 'title': 'Choose a safer approach', 'status': 'published', 'blocks': [teaching[2], paragraph('Apply this to your team: identify the affected component, name the responsible owner, and define a check that would detect this mistake before release. Record the review and any remaining limitations in your normal change process.', prefix+'-apply')]},
                {'id': prefix+'-check', 'title': 'Knowledge check', 'status': 'published', 'blocks': [check]},
            ])
        else:
            lessons.append({'id': prefix, 'title': topic['title'], 'status': 'published', 'blocks': teaching[1:]+[check]})
    links = item.get('references', REFERENCES.get(item['category'], []))
    if item.get('source_note'):
        lessons.insert(0, {'id':'source-review','title':'Source and scope','status':'published','blocks':[paragraph(item['source_note'],'source-note')]})
    if links: lessons[-1]['blocks'].append(block('paragraph', {'html': '<p>Further reading: ' + ' · '.join('<a href="'+html.escape(url, quote=True)+'" target="_blank" rel="noopener noreferrer">'+html.escape(title)+'</a>' for title, url in links) + '</p>'}, 'references'))
    return {'id': BRAND.get('course_id_prefix', 'training-original-')+slug(item['title']), 'title': item['title'], 'description': item['description'],
            'coverImage': 'assets/cover.svg', 'theme': 'company',
            'themeTokens': {'brand': TOKENS['brand-pink'], 'brandDark': TOKENS['brand-burgundy'],
                            'radiusBtn': TOKENS['radius-control'], 'radiusInteractive': TOKENS['radius-panel']},
            'settings': {'completion': 'quiz', 'scored': True, 'passingScore': 80, 'navigation': 'free', 'contentWidth': 'wide', 'contentLanguage': 'en', 'typography': 'modern', 'showProgress': True, 'finishMessage': 'Take one practical action from this course into your daily work.'},
            'intro': {'enabled': True, 'layout': 'split', 'showOutline': True, 'eyebrow': BRAND['organization']+' · '+item['category']}, 'lessons': lessons}


def archive(path, files):
    # Fixed timestamps and sorted entries make re-running the same source reproducible.
    with zipfile.ZipFile(path, 'w') as target:
        for name, value in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 11, 10, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            target.writestr(info, value.encode() if isinstance(value, str) else value)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def manifest(course, files):
    title = html.escape(course['title'])
    objectives = ''.join('<imsss:objective objectiveID="QUIZ_'+b['id']+'" />' for l in course['lessons'] for b in l['blocks'] if b['type'] == 'quiz')
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="{course['id']}" version="1" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3" xmlns:imsss="http://www.imsglobal.org/xsd/imsss" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
<metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
<organizations default="ORG"><organization identifier="ORG"><title>{title}</title><item identifier="ITEM" identifierref="SCO"><title>{title}</title><imsss:sequencing><imsss:objectives><imsss:primaryObjective objectiveID="PRIMARYOBJ" satisfiedByMeasure="true"><imsss:minNormalizedMeasure>0.80</imsss:minNormalizedMeasure></imsss:primaryObjective>{objectives}</imsss:objectives><imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/></imsss:sequencing></item></organization></organizations>
<resources><resource identifier="SCO" type="webcontent" adlcp:scormType="sco" href="index.html">{''.join('<file href="'+html.escape(name, quote=True)+'"/>' for name in sorted(files))}</resource></resources></manifest>'''


def build(output, collection="original", source=None, references=None):
    output.mkdir(parents=True, exist_ok=True)
    notice = NOTICE if collection == 'original' else 'Original operations curriculum, authored 2026-11-10.\nBased on user-supplied SOPs and the official references identified in each course.\nHistorical source limitations are stated in the source-and-scope lesson.\nNew courses and assessments require owner review and remain unpublished on import.\nPlayer: scormly, MIT; see PLAYER-LICENSE.txt. Brand artwork rights remain with its owner.\n'
    awareness, developer, workplace = [read_groups(n) for n in ('awareness', 'developer', 'workplace')]
    items = awareness + [dict(title=t['title'], category=g['category'], topics=[t]) for g in developer for t in g['topics']] + workplace
    assert len(items) == 60 and sum(len(g['topics']) for g in awareness) == 108 and sum(len(g['topics']) for g in developer) == 40
    if collection == 'operations':
        if source is None or references is None:
            raise ValueError('External operations curricula require --source and --references.')
        items = read_groups('operations', source)
        sources = json.loads(references.read_text())
        for item in items:
            item.update(sources.get(item['title'], sources[item['category']]))
    covers = json.loads((ROOT/'shared/brand/covers.json').read_text())
    catalog = []
    for n, item in enumerate(items):
        cover = covers[(n*17) % len(covers)]['id']
        item['description'] = 'Practice ' + ', '.join(t['title'].lower() for t in item['topics'][:3]) + (' and related skills.' if len(item['topics']) > 3 else '.')
        course = project(item, cover)
        assets = {'assets/cover.svg': (ROOT/'frontend/public/covers'/f'{cover}.svg').read_bytes()}
        source_files = {'project.json': json.dumps(course, ensure_ascii=False), **assets, 'NOTICE.txt': notice}
        stem = slug(item['title'])
        source_name = stem+'-source.zip'
        source_hash = archive(output/source_name, source_files)
        files = {name: (PLAYER/name).read_bytes() for name in ('index.html','player.css','player.js','scorm.js')}
        files['index.html'] = files['index.html'].decode().replace('{{COURSE_TITLE}}', html.escape(course['title']))
        files.update(assets)
        files['course-data.js'] = 'window.__SCORMLY_COURSE__ = '+json.dumps(course, ensure_ascii=False).replace('<', '\\u003c')+';\nwindow.__SCORMLY_SCORM__ = "2004";'
        files['NOTICE.txt'] = notice
        files['PLAYER-LICENSE.txt'] = (ROOT/'vendor/scormly/LICENSE').read_bytes()
        files['imsmanifest.xml'] = manifest(course, files)
        ET.fromstring(files['imsmanifest.xml'])
        for schema in (PLAYER/'schemas/scorm2004').rglob('*'):
            if schema.is_file(): files[str(schema.relative_to(PLAYER/'schemas/scorm2004'))] = schema.read_bytes()
        name = stem+'-scorm2004.zip'
        sha = archive(output/name, files)
        catalog.append({k:item[k] for k in ('title','description','category')} | {'key':stem,'cover':cover,'duration_minutes':max(3, len(item['topics'])*2), 'file':name,'sha256':sha,'source_file':source_name,'source_sha256':source_hash,'topics':[t['title'] for t in item['topics']]})
    exams = []
    exam_groups = awareness[:12]+workplace+developer if collection == 'original' else items + [workplace[0]]
    for group in exam_groups:
        topics = list(group['topics'])
        for candidate in (awareness+workplace+developer if collection == 'original' else []):
            if candidate['category'] == group['category']:
                topics.extend(t for t in candidate['topics'] if t not in topics)
        questions = []
        for i, topic in enumerate(topics[:5]):
            options, correct = choices(topic)
            questions.append({'type':'single','description':topic['scenario']+' What is the best next action?', 'options':options,'solution':[correct],'points':20,'position':i,'explanation':topic['why']})
        # A narrow category can have three topics; keep a balanced 100-point total.
        for i, q in enumerate(questions): q['points'] = 100//len(questions)+(i < 100%len(questions))
        exams.append({'key':slug(group['title']), 'title':group['title']+' Assessment', 'description':'Assess practical decisions covered in the course. Two attempts per round; a failed round can be retried after 24 hours.', 'duration_minutes':15,'max_attempts':2,'attempt_reset_minutes':1440,'pass_score':80,'published':False,'questions':questions})
        if collection == 'operations':
            exams[-1]['course_key'] = slug(group['title']) if group in items else 'existing-teams'
            if group not in items: exams[-1]['title'] = 'Teams Collaboration Assessment'
    assert len(exams) == (20 if collection == 'original' else 17)
    (output/'catalog.json').write_text(json.dumps(catalog, indent=2)+'\n')
    (output/'exams.json').write_text(json.dumps(exams, indent=2)+'\n')
    (output/'NOTICE.txt').write_text(notice)
    print(f'Built {len(catalog)} original courses, {sum(len(i["topics"]) for i in catalog)} topics, and {len(exams)} draft exam templates.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--collection', choices=['original','operations'], default='original')
    parser.add_argument('--source', type=Path, help='External curriculum for the operations collection')
    parser.add_argument('--references', type=Path, help='External source references JSON')
    args=parser.parse_args()
    build(args.output,args.collection,args.source,args.references)
