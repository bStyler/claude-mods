#!/usr/bin/env python3
"""Sum every past Explore subagent run from the transcripts on disk. Prints one JSON line."""
import glob, json, os, sys
root = os.path.expanduser('~/.claude/projects')
out = {'runs': 0, 'byModel': {}}
def text_len(c):
    if isinstance(c, str): return len(c)
    if isinstance(c, list): return sum(text_len(b.get('text') or b.get('content') or '') if isinstance(b, dict) else 0 for b in c)
    return 0
for meta in glob.glob(root + '/*/*/subagents/*.meta.json'):
    try:
        if json.load(open(meta)).get('agentType') != 'Explore': continue
        lines = open(meta[:-10] + '.jsonl').read().splitlines()
    except Exception: continue
    usage, model, report, read_chars, tools, last = {}, {}, '', 0, {}, '?'
    for l in lines:
        try: d = json.loads(l)
        except Exception: continue
        m = d.get('message') or {}
        if d.get('type') == 'assistant' and isinstance(m, dict):
            if m.get('usage'): usage[m.get('id')] = m['usage']; last = m.get('model') or last
            c = m.get('content')
            if isinstance(c, list):
                for b in c:
                    if b.get('type') == 'tool_use': tools[b['name']] = tools.get(b['name'], 0) + 1
                    if b.get('type') == 'text': report = b.get('text', '')
        elif d.get('type') == 'user' and isinstance(m.get('content'), list):
            for b in m['content']:
                if b.get('type') == 'tool_result': read_chars += text_len(b.get('content'))
    r = out['byModel'].setdefault(last, {'runs': 0, 'input': 0, 'cacheRead': 0, 'cacheWrite': 0, 'output': 0, 'readChars': 0, 'reportChars': 0, 'tools': {}})
    r['runs'] += 1; r['readChars'] += read_chars; r['reportChars'] += len(report)
    for u in usage.values():
        r['input'] += u.get('input_tokens', 0); r['cacheRead'] += u.get('cache_read_input_tokens', 0)
        r['cacheWrite'] += u.get('cache_creation_input_tokens', 0); r['output'] += u.get('output_tokens', 0)
    for k, v in tools.items(): r['tools'][k] = r['tools'].get(k, 0) + v
    out['runs'] += 1
print(json.dumps(out))
