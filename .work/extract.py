# -*- coding: utf-8 -*-
"""只读提取 docx 文本（含表格），用于赛事手册内容分析。"""
import sys, zipfile, re
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def para_text(p):
    parts = []
    for node in p.iter():
        tag = node.tag
        if tag == W + 't':
            parts.append(node.text or '')
        elif tag == W + 'tab':
            parts.append('\t')
        elif tag == W + 'br':
            parts.append('\n')
        elif tag == W + 'drawing':
            parts.append('[图片]')
    return ''.join(parts)

def para_style(p):
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return ''
    st = ppr.find(W + 'pStyle')
    if st is not None:
        return st.get(W + 'val') or ''
    return ''

def walk(body, out, depth=0):
    for child in body:
        if child.tag == W + 'p':
            t = para_text(child).strip()
            s = para_style(child)
            if t:
                if s:
                    out.append(f'<{s}> {t}')
                else:
                    out.append(t)
        elif child.tag == W + 'tbl':
            out.append('--- TABLE ---')
            for tr in child.findall(W + 'tr'):
                cells = []
                for tc in tr.findall(W + 'tc'):
                    txt = ' '.join(para_text(p).strip() for p in tc.findall(W + 'p'))
                    cells.append(txt.strip())
                out.append(' | '.join(cells))
            out.append('--- /TABLE ---')
        elif child.tag == W + 'sdt':
            content = child.find(W + 'sdtContent')
            if content is not None:
                walk(content, out, depth)

def main(path, outpath):
    z = zipfile.ZipFile(path)
    xml = z.read('word/document.xml')
    root = ET.fromstring(xml)
    body = root.find(W + 'body')
    out = []
    walk(body, out)
    txt = '\n'.join(out)
    with open(outpath, 'w', encoding='utf-8') as f:
        f.write(txt)
    print('paras:', len(out), 'chars:', len(txt))
    print('images:', len([n for n in z.namelist() if n.startswith('word/media/')]))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
