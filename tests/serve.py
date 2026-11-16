"""Static dev server that also accepts POST /__result (used by tests/e2e.html).
Usage: python3 tests/serve.py [port] [result_file]"""
import http.server, sys
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
OUT = sys.argv[2] if len(sys.argv) > 2 else 'e2e-result.html'
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0))
        open(OUT, 'wb').write(b'<pre id="out">' + self.rfile.read(n) + b'</pre>')
        self.send_response(204); self.end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
