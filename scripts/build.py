"""Package the existing app as one portable HTML file, without a new framework."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
html = (root / 'index.html').read_text()
for name in ('styles.css', 'redesign.css', 'activity.css'):
    html = html.replace(f'<link rel="stylesheet" href="{name}">', '<style>\n' + (root / name).read_text() + '</style>')
for name in ('training-store.js', 'feedback.js', 'app.js', 'session-ui.js', 'interface.js', 'activity-content.js', 'activity-engine.js', 'activity-ui.js'):
    source = (root / name).read_text().replace('</script', '<\\/script')
    html = html.replace(f'<script src="{name}"></script>', '<script>\n' + source + '\n</script>')
out = root / 'dist' / 'training.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html)
(out.parent / 'index.html').write_text(html)
(out.parent / '.nojekyll').touch()
print(f'Built {out} ({out.stat().st_size:,} bytes)')
print('GitHub Pages entry: dist/index.html')
