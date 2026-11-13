#!/usr/bin/env python3
"""Idempotently import generated original courses and exams as unpublished drafts.

Uses a protected Playwright storage-state file from an existing administrator
session. The record file stores created IDs after each operation; never match or
overwrite an unrelated course by title. No assignments or notifications are sent.
"""
import argparse
import hashlib
import json
import os
import secrets
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Application URL including /training when mounted')
    parser.add_argument('--auth', required=True, type=Path)
    parser.add_argument('--packages', required=True, type=Path)
    parser.add_argument('--record', required=True, type=Path)
    parser.add_argument('--expected-admin', required=True, type=int)
    parser.add_argument('--expected-courses', type=int, default=60)
    parser.add_argument('--expected-exams', type=int, default=20)
    parser.add_argument('--teams-course', type=int)
    args = parser.parse_args()
    assert args.auth.stat().st_mode & 0o077 == 0, 'Authentication file must be private'
    base = args.url.rstrip('/')
    parsed = urlsplit(base)
    assert parsed.scheme in ('https', 'http') and not parsed.username and not parsed.query
    cookies = json.loads(args.auth.read_text())['cookies']
    csrf = next(c['value'] for c in cookies if c['name'] in ('training_csrf', '__Host-training_csrf'))
    headers = {'Cookie': '; '.join(c['name']+'='+c['value'] for c in cookies), 'X-CSRFToken': csrf,
               'Origin': parsed.scheme+'://'+parsed.netloc, 'Referer': base+'/'}
    # Internal deployment endpoint: do not forward authenticated requests to a proxy.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **kw): return None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    def request(path, method='GET', data=None, content_type='application/json'):
        body = data if isinstance(data, bytes) else json.dumps(data).encode() if data is not None else None
        req = urllib.request.Request(base+'/api/'+path, data=body, method=method, headers={**headers, 'Content-Type':content_type})
        with opener.open(req, timeout=120) as response: return json.load(response)
    assert request('auth/session/')['user']['id'] == args.expected_admin
    catalog = json.loads((args.packages/'catalog.json').read_text())
    exams = json.loads((args.packages/'exams.json').read_text())
    assert len(catalog) == args.expected_courses and len(exams) == args.expected_exams
    if args.teams_course:
        teams=request(f"courses/{args.teams_course}/")
        assert teams["can_manage"] and "teams" in teams["title"].lower()
    digest = hashlib.sha256((args.packages/'catalog.json').read_bytes()+(args.packages/'exams.json').read_bytes()).hexdigest()
    record = json.loads(args.record.read_text()) if args.record.exists() else {'catalog_sha256':digest, 'url':base, 'courses':[], 'exams':[]}
    assert record['catalog_sha256'] == digest and record['url'] == base
    def save():
        temp = args.record.with_suffix('.tmp')
        temp.write_text(json.dumps(record, indent=2)+'\n'); temp.chmod(0o600); temp.replace(args.record)
    for item in catalog:
        payloads = []
        for field, hashfield, formfield in [('file','sha256','file'),('source_file','source_sha256','source')]:
            path = args.packages/item[field]
            assert path.parent == args.packages and path.name == item[field]
            body = path.read_bytes()
            assert hashlib.sha256(body).hexdigest() == item[hashfield]
            payloads.append((formfield,path.name,body))
        found = next((r for r in record['courses'] if r['key'] == item['key']), None)
        if found is None:
            course = request('courses/','POST',{k:item[k] for k in ('title','description','category','cover','duration_minutes')} | {'published':False,'blocks':[]})
            found = {'key':item['key'],'id':course['id'],'package_id':None,'sha256':item['sha256']}
            record['courses'].append(found);save()
        current = request(f"courses/{found['id']}/")
        assert current['title'] == item['title'] and current['can_manage']
        if found['package_id']:
            assert current['package']['id'] == found['package_id'] and current['package']['has_source']
            continue
        assert not current['published'], 'An unfinished import was published; review before replacing its content'
        boundary = 'training-upload-'+secrets.token_hex(16)
        body = b''
        for field, name, content in payloads:
            body += (f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"; filename="{name}"\r\nContent-Type: application/zip\r\n\r\n'.encode()+content+b'\r\n')
        body += f'--{boundary}--\r\n'.encode()
        package = request(f"courses/{found['id']}/upload/",'POST',body,'multipart/form-data; boundary='+boundary)
        found['package_id'] = package['id'];save()
        print('Imported course:',item['title'],flush=True)
    for item in exams:
        found = next((r for r in record['exams'] if r['key'] == item['key']), None)
        if found:
            assert request(f"exams/{found['id']}/")['title'] == item['title']
            continue
        data = {k:v for k,v in item.items() if k not in ('key','course_key')}
        if item.get('course_key'):
            data['course'] = args.teams_course if item['course_key'] == 'existing-teams' else next(r['id'] for r in record['courses'] if r['key']==item['course_key'])
            assert data['course']
        data['shuffle_questions'] = True; data['shuffle_options'] = True
        # Explanations remain in the authored curriculum; the exam API stores answer keys.
        data['questions'] = [{k:v for k,v in q.items() if k != 'explanation'} for q in item['questions']]
        exam = request('exams/','POST',data)
        record['exams'].append({'key':item['key'],'id':exam['id']});save()
        print('Imported exam:',item['title'],flush=True)
    print(f"Verified {len(record['courses'])} courses and {len(record['exams'])} exams. New records remain drafts; no assignments sent.")


if __name__ == '__main__': main()
