# -*- coding: utf-8 -*-
"""只读扫描 .learnbuddy/projects 下的会话 jsonl，提取每轮的 时间 + 用户提问摘要。"""
import json, re, sys, os, datetime

SR = re.compile(r'<system-reminder[\s\S]*?</system-reminder>')

def clean(t):
    t = SR.sub('', t)
    t = re.sub(r'<[^>]{1,40}>', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    return t

def scan(path):
    print('=' * 100)
    print('FILE:', os.path.basename(path))
    with open(path, 'r', encoding='utf-8', errors='replace') as f:
        for i, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                o = json.loads(line)
            except Exception:
                continue
            if o.get('role') != 'user' or o.get('type') != 'message':
                continue
            ts = o.get('timestamp')
            when = ''
            if ts:
                when = datetime.datetime.fromtimestamp(ts / 1000).strftime('%m-%d %H:%M:%S')
            parts = o.get('content') or []
            txts = [p.get('text', '') for p in parts if isinstance(p, dict) and p.get('type') == 'input_text']
            t = clean(' '.join(txts))
            if not t:
                continue
            print(f'  L{i:>4} {when}  {t[:170]}')

for p in sys.argv[1:]:
    scan(p)
