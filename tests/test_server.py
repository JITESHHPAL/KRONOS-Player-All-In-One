"""Basic tests for the KRONOS server. Run:  python -m unittest discover -s tests -v"""
import http.client, json, os, sys, tempfile, threading, unittest
from http.server import ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.data = bytes(range(256)) * 40
        for name, body in (("clip.mp4", cls.data), ("pic.jpg", b"x"), ("song.mp3", b"y")):
            with open(os.path.join(cls.tmp.name, name), "wb") as f:
                f.write(body)
        server.MEDIA = cls.tmp.name
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.H)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close(); cls.tmp.cleanup()

    def get(self, path, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        c.request("GET", path, headers=headers or {})
        r = c.getresponse(); body = r.read(); c.close()
        return r, body

    def test_index_is_served(self):
        r, b = self.get("/")
        self.assertEqual(r.status, 200)
        self.assertIn(b"KRONOS", b)

    def test_library_listing(self):
        r, b = self.get("/api/list")
        self.assertEqual(json.loads(b), {"video": ["clip.mp4"], "image": ["pic.jpg"], "audio": ["song.mp3"]})

    def test_full_download(self):
        r, b = self.get("/media/clip.mp4")
        self.assertEqual((r.status, b), (200, self.data))
        self.assertEqual(r.getheader("Accept-Ranges"), "bytes")

    def test_byte_range(self):
        r, b = self.get("/media/clip.mp4", {"Range": "bytes=10-19"})
        self.assertEqual(r.status, 206)
        self.assertEqual(b, self.data[10:20])
        self.assertEqual(r.getheader("Content-Range"), f"bytes 10-19/{len(self.data)}")

    def test_open_ended_range(self):
        r, b = self.get("/media/clip.mp4", {"Range": f"bytes={len(self.data) - 5}-"})
        self.assertEqual((r.status, b), (206, self.data[-5:]))

    def test_direct_video_link_redirects_to_player(self):
        r, _ = self.get("/media/clip.mp4", {"Accept": "text/html"})
        self.assertEqual(r.status, 302)
        self.assertIn("/?src=", r.getheader("Location"))

    def test_path_traversal_is_blocked(self):
        for p in ("/media/../server.py", "/media/%2e%2e/server.py", "/%2e%2e/server.py", "/../server.py"):
            r, _ = self.get(p)
            self.assertEqual(r.status, 404, p)

    def test_unknown_file_is_404(self):
        for p in ("/media/nope.mp4", "/api/tracks?f=nope.mp4", "/api/prepare?f=nope.mp4&a=0&h=0"):
            r, _ = self.get(p)
            self.assertEqual(r.status, 404, p)


if __name__ == "__main__":
    unittest.main()
