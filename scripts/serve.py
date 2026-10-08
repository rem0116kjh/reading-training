"""Serve the local preview, including parallel browser requests for source assets."""
from argparse import ArgumentParser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

parser = ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=4173)
parser.add_argument('--directory', default=str(Path(__file__).resolve().parent.parent))
options = parser.parse_args()

class PreviewServer(ThreadingHTTPServer):
    # Source mode loads 15 scripts plus CSS at once; the default queue of 5 can reset requests.
    request_queue_size = 128

handler = partial(SimpleHTTPRequestHandler, directory=options.directory)
with PreviewServer(('127.0.0.1', options.port), handler) as server:
    print(f'Preview: http://127.0.0.1:{options.port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
