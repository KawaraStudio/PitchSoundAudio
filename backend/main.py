"""
NADA STUDIO — Backend API
Flask + yt-dlp + FFmpeg
"""

import os, uuid, time, json, threading, subprocess, shutil
from pathlib import Path
from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS
import yt_dlp

app = Flask(__name__)
CORS(app, origins=os.getenv("ALLOWED_ORIGINS", "*").split(","))

# ─── CONFIG ───────────────────────────────────────────────
WORK_DIR   = Path(os.getenv("WORK_DIR", "/tmp/nada"))
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
MAX_JOBS   = int(os.getenv("MAX_JOBS", "20"))
JOB_TTL    = int(os.getenv("JOB_TTL", "3600"))  # seconds to keep job files

WORK_DIR.mkdir(parents=True, exist_ok=True)

# ─── IN-MEMORY JOB STORE ─────────────────────────────────
jobs: dict[str, dict] = {}
jobs_lock = threading.Lock()

def new_job(job_id: str, url: str):
    with jobs_lock:
        jobs[job_id] = {
            "id": job_id, "url": url, "status": "queued",
            "progress": 0, "title": None, "duration": None,
            "error": None, "created_at": time.time(),
            "output_path": None,
        }

def update_job(job_id: str, **kwargs):
    with jobs_lock:
        if job_id in jobs:
            jobs[job_id].update(kwargs)

def get_job(job_id: str):
    with jobs_lock:
        return dict(jobs.get(job_id, {}))

def cleanup_old_jobs():
    """Remove jobs older than JOB_TTL seconds."""
    now = time.time()
    to_del = []
    with jobs_lock:
        for jid, job in jobs.items():
            if now - job["created_at"] > JOB_TTL:
                to_del.append(jid)
        for jid in to_del:
            path = jobs[jid].get("output_path")
            if path and Path(path).exists():
                try: Path(path).unlink()
                except: pass
            del jobs[jid]

# ─── yt-dlp HELPERS ──────────────────────────────────────
def get_ytdlp_opts(out_path: str, job_id: str) -> dict:
    def progress_hook(d):
        if d["status"] == "downloading":
            pct_raw = d.get("_percent_str", "0%").strip().replace("%","")
            try:
                pct = float(pct_raw) * 0.5  # download = 0–50%
                update_job(job_id, progress=round(pct), status="downloading")
            except: pass
        elif d["status"] == "finished":
            update_job(job_id, progress=50, status="converting")

    return {
        "format": "bestaudio/best",
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
        "outtmpl": out_path,
        "progress_hooks": [progress_hook],
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "cookiefile": os.getenv("COOKIES_FILE", None),
    }

def run_download(job_id: str, url: str, target_secs: int, speed_ratio: float, amp: float):
    try:
        update_job(job_id, status="downloading", progress=5)
        tmp_dir = WORK_DIR / job_id
        tmp_dir.mkdir(parents=True, exist_ok=True)
        raw_path = str(tmp_dir / "raw")

        # ── 1. Download via yt-dlp ──
        opts = get_ytdlp_opts(raw_path, job_id)
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get("title", "audio")
            duration = info.get("duration", 0)
            update_job(job_id, title=title, duration=duration)

        # yt-dlp adds .mp3 extension automatically
        downloaded = list(tmp_dir.glob("raw.mp3"))
        if not downloaded:
            # fallback: any mp3
            downloaded = list(tmp_dir.glob("*.mp3"))
        if not downloaded:
            raise FileNotFoundError("yt-dlp didn't produce an MP3 file")

        src_file = str(downloaded[0])
        update_job(job_id, progress=55, status="processing")

        # ── 2. FFmpeg: tempo + amplification ──
        safe_title = "".join(c for c in title if c.isalnum() or c in " -_").strip()[:60]
        out_file = str(tmp_dir / f"{safe_title}.mp3")

        atempo_chain = build_atempo_chain(speed_ratio)
        volume_filter = f"volume={amp:.2f}"
        af_filter = ",".join(atempo_chain + [volume_filter])

        cmd = [
            "ffmpeg", "-y", "-i", src_file,
            "-af", af_filter,
            "-codec:a", "libmp3lame", "-b:a", "192k",
            "-ar", "44100",
            out_file
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            raise RuntimeError(f"FFmpeg error: {result.stderr[-500:]}")

        # Remove raw file to save space
        Path(src_file).unlink(missing_ok=True)

        update_job(job_id, status="done", progress=100, output_path=out_file, title=safe_title)

    except Exception as e:
        update_job(job_id, status="error", error=str(e), progress=0)
        # Cleanup
        try: shutil.rmtree(WORK_DIR / job_id, ignore_errors=True)
        except: pass

def build_atempo_chain(speed: float) -> list[str]:
    """
    FFmpeg atempo only supports 0.5–100.0.
    Chain multiple atempo filters for extreme values.
    """
    filters = []
    remaining = speed
    while remaining > 100.0:
        filters.append("atempo=100.0")
        remaining /= 100.0
    while remaining < 0.5:
        filters.append("atempo=0.5")
        remaining /= 0.5
    filters.append(f"atempo={remaining:.6f}")
    return filters

# ─── ROUTES ──────────────────────────────────────────────
@app.route("/health")
def health():
    return jsonify({"ok": True, "jobs": len(jobs)})

@app.route("/api/info", methods=["POST"])
def get_info():
    """Fetch metadata (title, duration, thumbnail) without downloading."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url required"}), 400
    try:
        opts = {"quiet": True, "no_warnings": True, "noplaylist": True,
                "cookiefile": os.getenv("COOKIES_FILE", None)}
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        return jsonify({
            "title": info.get("title"),
            "duration": info.get("duration"),
            "thumbnail": info.get("thumbnail"),
            "uploader": info.get("uploader"),
            "platform": info.get("extractor_key"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.route("/api/process", methods=["POST"])
def process():
    """Start an async processing job."""
    cleanup_old_jobs()
    if len(jobs) >= MAX_JOBS:
        return jsonify({"error": "Server busy, coba lagi sebentar"}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "url required"}), 400

    target_secs = max(30, min(int(data.get("target_secs", 420)), 3600))
    amp         = max(0.1, min(float(data.get("amp", 1.0)), 5.0))
    duration    = float(data.get("duration", 0) or 0)
    speed_ratio = (duration / target_secs) if duration > 0 else 1.0
    speed_ratio = max(0.01, min(speed_ratio, 200.0))

    job_id = str(uuid.uuid4())
    new_job(job_id, url)

    thread = threading.Thread(
        target=run_download,
        args=(job_id, url, target_secs, speed_ratio, amp),
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job_id, "status": "queued"})

@app.route("/api/status/<job_id>")
def status(job_id):
    job = get_job(job_id)
    if not job:
        return jsonify({"error": "job not found"}), 404
    # Don't expose full path
    safe = {k: v for k, v in job.items() if k != "output_path"}
    safe["has_file"] = bool(job.get("output_path") and Path(job["output_path"]).exists())
    return jsonify(safe)

@app.route("/api/download/<job_id>")
def download(job_id):
    job = get_job(job_id)
    if not job:
        abort(404)
    if job.get("status") != "done":
        abort(400)
    path = job.get("output_path")
    if not path or not Path(path).exists():
        abort(404)
    title = job.get("title", "audio")
    return send_file(path, as_attachment=True, download_name=f"{title}.mp3",
                     mimetype="audio/mpeg")

@app.route("/api/roblox/upload", methods=["POST"])
def roblox_upload():
    """
    Upload audio to Roblox Creator.
    Requires: job_id, roblox_cookie (ROBLOSECURITY), creator_id
    """
    data = request.get_json(silent=True) or {}
    job_id        = data.get("job_id", "")
    roblo_cookie  = data.get("roblox_cookie", "").strip()
    creator_id    = data.get("creator_id", "").strip()
    asset_name    = data.get("asset_name", "NADA Audio")

    if not all([job_id, roblo_cookie, creator_id]):
        return jsonify({"error": "job_id, roblox_cookie, creator_id required"}), 400

    job = get_job(job_id)
    if not job or job.get("status") != "done":
        return jsonify({"error": "Job belum selesai atau tidak ditemukan"}), 400

    path = job.get("output_path")
    if not path or not Path(path).exists():
        return jsonify({"error": "File tidak ditemukan"}), 404

    # ── Get CSRF token ──
    import urllib.request, urllib.error
    csrf_token = _get_roblox_csrf(roblo_cookie)
    if not csrf_token:
        return jsonify({"error": "Gagal mendapatkan CSRF token Roblox. Cookie mungkin expired."}), 400

    # ── Upload audio ──
    try:
        result = _upload_to_roblox(path, roblo_cookie, csrf_token, creator_id, asset_name)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def _get_roblox_csrf(cookie: str) -> str | None:
    import urllib.request, urllib.error
    req = urllib.request.Request(
        "https://auth.roblox.com/v2/logout",
        data=b"{}",
        headers={"Content-Type": "application/json", "Cookie": f".ROBLOSECURITY={cookie}"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        return e.headers.get("x-csrf-token")
    return None

def _upload_to_roblox(file_path: str, cookie: str, csrf: str, creator_id: str, name: str) -> dict:
    import urllib.request, urllib.parse
    with open(file_path, "rb") as f:
        audio_data = f.read()

    boundary = "----NadaStudioBoundary"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="request"\r\n\r\n'
        + json.dumps({
            "displayName": name,
            "description": "Uploaded via NADA STUDIO",
            "creatorType": "User",
            "creatorTargetId": int(creator_id),
            "paymentSourceType": "User",
            "assetType": "Audio",
        }) +
        f"\r\n--{boundary}\r\n"
        f'Content-Disposition: form-data; name="fileContent"; filename="audio.mp3"\r\n'
        f"Content-Type: audio/mpeg\r\n\r\n"
    ).encode() + audio_data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        "https://apis.roblox.com/assets/v1/assets",
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Cookie": f".ROBLOSECURITY={cookie}",
            "x-csrf-token": csrf,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read())
        return {"success": True, "asset_id": result.get("assetId"), "operation_id": result.get("operationId")}

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
