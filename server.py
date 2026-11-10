#!/usr/bin/env python3
"""KRONOS - a local media server and web player for videos, photos and music.

Run on your laptop:   python server.py [folder] [port]
Phones on the same Wi-Fi open the printed link and get KRONOS.
Optional: install ffmpeg to list/switch audio languages, change video quality and read embedded subtitles.
"""
import os, sys, json, socket, mimetypes, subprocess, threading, hashlib, argparse
from urllib.parse import unquote, urlparse, quote, parse_qs
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

__version__ = "1.0.0"
ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, "web")              # the web player (static files)
MEDIA = os.path.join(ROOT, "videos")         # your library (set from the command line)
CACHE = os.path.join(ROOT, "cache")          # converted files + thumbnails
JOBS = {}
VEXT = (".mp4", ".m4v", ".webm", ".ogv", ".mov", ".mkv")
AEXT = (".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus")
IEXT = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif")
THUMBS = threading.Semaphore(3)
mimetypes.add_type("text/vtt", ".vtt"); mimetypes.add_type("audio/flac", ".flac"); mimetypes.add_type("audio/opus", ".opus"); mimetypes.add_type("image/avif", ".avif")
LANG = {"eng":"English","hin":"Hindi","pan":"Punjabi","spa":"Spanish","fre":"French","fra":"French","ger":"German","deu":"German",
        "jpn":"Japanese","kor":"Korean","chi":"Chinese","zho":"Chinese","tam":"Tamil","tel":"Telugu","mal":"Malayalam","kan":"Kannada",
        "ben":"Bengali","mar":"Marathi","urd":"Urdu","ara":"Arabic","rus":"Russian","ita":"Italian","por":"Portuguese","tur":"Turkish","und":"Unknown"}

def probe(full):
    try:
        r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", full],
                           capture_output=True, text=True, timeout=30)
        j = json.loads(r.stdout)
    except FileNotFoundError:
        return {"error": "noffmpeg"}
    except Exception:
        return {"error": "probe"}
    audio, subs, default = [], [], 0
    for s in j.get("streams", []):
        t = s.get("tags", {}); lang = t.get("language", "und")
        name = LANG.get(lang, lang.upper()); title = t.get("title", "")
        if s.get("codec_type") == "audio":
            ch = s.get("channels"); 
            label = f"{name}" + (f" - {title}" if title and title.lower() != name.lower() else "") + f" ({s.get('codec_name','').upper()}{' ' + str(ch) + 'ch' if ch else ''})"
            if s.get("disposition", {}).get("default"): default = len(audio)
            audio.append({"label": label, "lang": lang, "codec": s.get("codec_name")})
        elif s.get("codec_type") == "subtitle":
            subs.append({"label": name + (f" - {title}" if title else ""), "codec": s.get("codec_name")})
    vs = next((x for x in j.get("streams", []) if x.get("codec_type") == "video"), {})
    dur = float(j.get("format", {}).get("duration", 0) or 0)
    return {"audio": audio, "subs": subs, "default": default, "duration": dur, "height": vs.get("height", 0), "vcodec": vs.get("codec_name", "")}

def run_job(full, a, h, key, out):
    j = JOBS[key]; tmp = out + ".part"
    try:
        pr = probe(full); dur = pr.get("duration") or 0
        codec = pr["audio"][a]["codec"]
        vc = ["-c:v", "copy"] if h == 0 else ["-vf", f"scale=-2:min({h}\\,ih)", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-threads", "0"]
        ac = ["-c:a", "copy"] if codec == "aac" else ["-c:a", "aac", "-b:a", "192k", "-ac", "2", "-af", "aresample=async=1:first_pts=0"]
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", full, "-map", "0:v:0", "-map", f"0:a:{a}", *vc, *ac,
               "-sn", "-dn", "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", "-f", "mp4", tmp]
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        for line in p.stdout:
            k, _, val = line.strip().partition("=")
            if k in ("out_time_us", "out_time_ms") and dur and val.lstrip("-").isdigit():
                j["progress"] = max(0, min(99, int(int(val) / 1e6 / dur * 100)))
        p.wait()
        if p.returncode == 0: os.replace(tmp, out); j["state"] = "ready"
        else: j["state"] = "error"
    except Exception:
        j["state"] = "error"
    if j["state"] == "error" and os.path.exists(tmp): os.remove(tmp)

def prepare(full, a, h):
    """Build a normal, seekable MP4 with the chosen audio track and (optionally) a lower resolution."""
    st = os.stat(full)
    key = hashlib.sha1(f"{full}|{st.st_mtime}|{st.st_size}|{a}|{h}".encode()).hexdigest()[:16]
    out = os.path.join(CACHE, key + ".mp4")
    if os.path.exists(out): return {"state": "ready", "url": "/cache/" + key + ".mp4"}
    j = JOBS.get(key)
    if j and j["state"] == "working": return {"state": "working", "progress": j["progress"]}
    if j and j["state"] == "error": del JOBS[key]; return {"state": "error"}
    JOBS[key] = {"state": "working", "progress": 0}
    threading.Thread(target=run_job, args=(full, a, h, key, out), daemon=True).start()
    return {"state": "working", "progress": 0}

class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"   # keep-alive: smoother seeking
    def log_message(self, *a): pass

    def safe(self, rel):
        full = os.path.realpath(os.path.join(MEDIA, rel))
        return full if full.startswith(os.path.realpath(MEDIA) + os.sep) and os.path.isfile(full) else None

    def do_GET(self):
        u = urlparse(self.path); path = unquote(u.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if path == "/api/list":
            out = {"video": [], "image": [], "audio": []}
            for r, _, fs in os.walk(MEDIA):
                for f in fs:
                    k = "video" if f.lower().endswith(VEXT) else "image" if f.lower().endswith(IEXT) else "audio" if f.lower().endswith(AEXT) else None
                    if k: out[k].append(os.path.relpath(os.path.join(r, f), MEDIA).replace(os.sep, "/"))
            return self.send_bytes(json.dumps({k: sorted(v) for k, v in out.items()}).encode(), "application/json")
        if path.startswith("/cache/"):
            return self.file(CACHE, path[7:])
        if path in ("/api/tracks", "/api/sub", "/api/prepare", "/api/thumb"):
            full = self.safe(q.get("f", ""))
            if not full: return self.send_error(404)
            if path == "/api/tracks": return self.send_bytes(json.dumps(probe(full)).encode(), "application/json")
            if path == "/api/prepare":
                try: return self.send_bytes(json.dumps(prepare(full, int(q.get("a", 0)), int(q.get("h", 0)))).encode(), "application/json")
                except FileNotFoundError: return self.send_bytes(b'{"state":"error"}', "application/json")
            if path == "/api/thumb": return self.thumb(full)
            if path == "/api/sub": return self.sub(full, int(q.get("s", 0)))
        if path.startswith("/media/"):
            return self.file(MEDIA, path[7:], media=True)
        return self.file(APP, "index.html" if path == "/" else path.lstrip("/"))

    def send_bytes(self, data, ctype):
        self.send_response(200)
        self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def thumb(self, full):
        """Small cached JPEG preview so the photo grid loads fast."""
        key = hashlib.sha1(f"{full}|{os.path.getmtime(full)}".encode()).hexdigest()[:16]
        out = os.path.join(CACHE, "thumbs", key + ".jpg")
        if not os.path.exists(out):
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with THUMBS:
                try:
                    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", full, "-vf", "scale=min(360\\,iw):-2", "-frames:v", "1", "-q:v", "5", out + ".tmp.jpg"], capture_output=True, timeout=40)
                except Exception:
                    return self.send_error(501)
            if r.returncode != 0: return self.send_error(501)
            os.replace(out + ".tmp.jpg", out)
        data = open(out, "rb").read()
        self.send_response(200); self.send_header("Content-Type", "image/jpeg"); self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400"); self.end_headers(); self.wfile.write(data)

    def setup(self):
        super().setup()
        try: self.request.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, 1 << 20)   # bigger send buffer = smoother streaming
        except Exception: pass

    def sub(self, full, n):
        try:
            r = subprocess.run(["ffmpeg", "-v", "error", "-i", full, "-map", f"0:s:{n}", "-f", "webvtt", "pipe:1"], capture_output=True, timeout=120)
            if not r.stdout: return self.send_error(415)
            self.send_bytes(r.stdout, "text/vtt")
        except Exception:
            self.send_error(500)

    def file(self, root, rel, media=False):
        full = os.path.realpath(os.path.join(root, rel))
        if not full.startswith(os.path.realpath(root) + os.sep) or not os.path.isfile(full):
            self.send_error(404); return
        if media and full.lower().endswith(VEXT) and "text/html" in self.headers.get("Accept", ""):
            self.send_response(302); self.send_header("Location", "/?src=" + quote("/media/" + rel)); self.send_header("Content-Length", "0"); self.end_headers(); return
        size = os.path.getsize(full)
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        start, end, code = 0, size - 1, 200
        rng = self.headers.get("Range")
        if rng and rng.startswith("bytes="):
            a, _, b = rng[6:].partition("-")
            start = int(a) if a else max(0, size - int(b))
            end = min(int(b) if (a and b) else size - 1, size - 1); code = 206
        length = end - start + 1
        try:
            self.send_response(code)
            self.send_header("Content-Type", ctype); self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Length", str(length))
            if code == 206: self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            if not media and root == APP: self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            with open(full, "rb") as f:
                self.connection.sendfile(f, start, length)      # zero-copy send = smoother, lighter on the laptop
        except (BrokenPipeError, ConnectionResetError): self.close_connection = True

def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try: s.connect(("10.255.255.255", 1)); return s.getsockname()[0]
    except Exception: return "127.0.0.1"
    finally: s.close()

def main(argv=None):
    global MEDIA
    ap = argparse.ArgumentParser(prog="kronos", description="KRONOS - local media server and web player.")
    ap.add_argument("folder", nargs="?", default=MEDIA, help="folder with your videos, photos and music (default: ./videos)")
    ap.add_argument("port", nargs="?", type=int, default=8000, help="port to listen on (default: 8000)")
    ap.add_argument("--host", default="0.0.0.0", help="address to bind (default: 0.0.0.0 = whole local network; use 127.0.0.1 for this computer only)")
    ap.add_argument("--version", action="version", version=f"KRONOS {__version__}")
    a = ap.parse_args(argv)
    MEDIA = os.path.abspath(a.folder)
    os.makedirs(MEDIA, exist_ok=True); os.makedirs(CACHE, exist_ok=True)
    print(f"KRONOS {__version__}")
    print(f"Library folder: {MEDIA}")
    print(f"On this computer:           http://localhost:{a.port}")
    if a.host == "0.0.0.0": print(f"On your phone (same Wi-Fi): http://{lan_ip()}:{a.port}")
    print("Press Ctrl+C to stop.")
    try: ThreadingHTTPServer((a.host, a.port), H).serve_forever()
    except KeyboardInterrupt: print("\nStopped.")

if __name__ == "__main__":
    main()
