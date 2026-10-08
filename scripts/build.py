"""Package and minify the app as one portable HTML file."""
from pathlib import Path
import argparse
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--no-minify', action='store_true', help='Build a readable HTML without Node.js dependencies')
options = parser.parse_args()
root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text(encoding='utf-8')
css_pattern = r'<link rel="stylesheet" href="((?!https?://)[^"]+)">'
js_pattern = r'<script src="([^"]+)"></script>'

def combine(pattern):
    sources = []
    for match in re.finditer(pattern, html):
        name = match[1].split('?')[0]
        path = (root / name).resolve()
        if path.parent != root or not path.is_file():
            raise SystemExit(f'Invalid local build input: {name}')
        sources.append(path.read_text(encoding='utf-8'))
    if not sources:
        raise SystemExit('No local assets found to build')
    return '\n;\n'.join(sources) if pattern == js_pattern else '\n'.join(sources)

def minify(source, loader):
    if options.no_minify:
        return source
    executable = root / 'node_modules' / '.bin' / 'esbuild'
    if not executable.exists():
        raise SystemExit('Run npm ci first, or use python3 scripts/build.py --no-minify')
    return subprocess.run([str(executable), f'--loader={loader}', '--minify',
                           '--target=chrome100,firefox100,safari15', '--charset=utf8',
                           '--legal-comments=none'], input=source, text=True,
                          encoding='utf-8', stdout=subprocess.PIPE, check=True).stdout

css = minify(combine(css_pattern), 'css')
js = minify(combine(js_pattern), 'js')

def inline(pattern, tag, source):
    # Escape raw-text end tags so lesson strings cannot close the inline element.
    source = re.sub(r'</' + tag, lambda match: '<\\/' + match[0][2:], source, flags=re.I)
    first = True
    def replace(_):
        nonlocal first
        if not first:
            return ''
        first = False
        return f'<{tag}>\n{source}\n</{tag}>'
    return re.sub(pattern, replace, html)

html = inline(css_pattern, 'style', css)
html = inline(js_pattern, 'script', js)
out = root / 'dist' / 'training.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
(out.parent / 'index.html').write_text(html, encoding='utf-8')
(out.parent / '.nojekyll').touch()
print(f'Built {out} ({out.stat().st_size:,} bytes)')
print('GitHub Pages entry: dist/index.html')
