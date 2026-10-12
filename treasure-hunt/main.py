import base64
import os
import re
import time

import cv2
import numpy as np

from fastapi import FastAPI
from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.templating import Jinja2Templates
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from dotenv import load_dotenv

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from auth import generate_team_id, hash_password, verify_password
from data_manager import (
    HINT_PENALTY_MIN,
    HUNT_END,
    HUNT_START,
    MAX_SKIPS,
    PHOTO_DIR,
    SKIP_PENALTY_MIN,
    all_photos,
    all_progress,
    admin_pass_quest,
    complete_main_quest,
    find_qr_quest_by_token,
    get_main_quest_by_id,
    hunt_phase,
    leaderboard,
    load_teams,
    new_team,
    skip_main_quest,
    update_teams,
    use_hint,
)

load_dotenv()

SESSION_SECRET = os.getenv("SESSION_SECRET")

if not SESSION_SECRET:
    raise RuntimeError("SESSION_SECRET is not configured.")

INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "quarks-internal-2026")
QR_SCANNER_URL = os.getenv("QR_SCANNER_URL", "https://quarks.ug.iisc.ac.in/qr-scanner")
MAX_PHOTO_BYTES = 15 * 1024 * 1024

PHOTO_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()

templates = Jinja2Templates(directory="templates")

PREFIX = os.getenv("APP_PREFIX", "")
templates.env.globals["base"] = PREFIX
templates.env.globals["qr_scanner_url"] = QR_SCANNER_URL
templates.env.globals["hunt_start"] = HUNT_START
templates.env.globals["hunt_end"] = HUNT_END


class AutoAuthMiddleware(BaseHTTPMiddleware):
    """Log in the team forwarded by the Quacks server (x-team-name header)."""

    async def dispatch(self, request: Request, call_next):
        team_name = request.headers.get("x-team-name")
        if team_name:
            teams = load_teams()
            current = teams.get(request.session.get("team_id") or "")
            if not current or current["team_name"].lower() != team_name.lower():
                matched_id = None
                for tid, t in teams.items():
                    if t["team_name"].lower() == team_name.lower():
                        matched_id = tid
                        break
                if not matched_id:
                    new_id = generate_team_id()
                    team = new_team(team_name, hash_password(team_name))

                    def add_team(all_teams):
                        all_teams[new_id] = team
                    update_teams(add_team)
                    matched_id = new_id
                request.session["team_id"] = matched_id
        return await call_next(request)


app.add_middleware(AutoAuthMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    https_only=False,
    same_site="lax"
)

app.mount("/static", StaticFiles(directory="static"), name="static")


def current_team(request: Request):
    team_id = request.session.get("team_id")
    if not team_id:
        return None, None
    team = load_teams().get(team_id)
    if not team:
        request.session.clear()
        return None, None
    return team_id, team


def login_redirect(next_path):
    # Behind the Quacks proxy, teams log in on the Quacks page itself.
    if PREFIX:
        return RedirectResponse(url="/#login", status_code=303)
    return RedirectResponse(url=f"{PREFIX}/login?next={PREFIX}{next_path}", status_code=303)


def show_error(request, title, message, status_code=400):
    return templates.TemplateResponse(
        request=request,
        name="qr_error.html",
        context={"title": title, "message": message},
        status_code=status_code,
    )


def require_api_key(request: Request):
    if request.headers.get("x-api-key") != INTERNAL_API_KEY:
        raise HTTPException(status_code=403, detail="Forbidden")


@app.get("/")
def home(request: Request):
    return RedirectResponse(url=f"{PREFIX}/dashboard", status_code=303)


@app.get("/dashboard")
def dashboard(request: Request):
    team_id, team = current_team(request)
    if not team:
        return login_redirect("/dashboard")

    route = team["main_route"]
    progress = team["main_progress"]
    main_completed = progress >= len(route)
    main_quest = None
    if not main_completed:
        main_quest = get_main_quest_by_id(route[progress])

    hints_shown = []
    hints_total = 0
    if main_quest:
        hints_total = len(main_quest.get("hints", []))
        hints_shown = main_quest.get("hints", [])[:team.get("hints", []).count(main_quest["id"])]

    return templates.TemplateResponse(
        request=request,
        name="dashboard.html",
        context={
            "team_name": team["team_name"],
            "phase": hunt_phase(team),
            "main_completed": main_completed,
            "main_quest": main_quest,
            "hints_shown": hints_shown,
            "hints_left": hints_total - len(hints_shown),
            "skips_left": MAX_SKIPS - len(team.get("skips", [])),
            "skip_penalty": SKIP_PENALTY_MIN,
            "hint_penalty": HINT_PENALTY_MIN,
            "main_progress": progress,
            "main_total": len(route),
            "hints_used": len(team.get("hints", [])),
            "skips_used": len(team.get("skips", [])),
            "finished_at": team.get("finished_at"),
        }
    )


@app.post("/hint")
def hint(request: Request):
    team_id, team = current_team(request)
    if not team:
        raise HTTPException(status_code=401, detail="Not logged in.")
    result = use_hint(team_id)
    if result["status"] == "closed":
        raise HTTPException(status_code=400, detail="The hunt is not live.")
    return RedirectResponse(url=f"{PREFIX}/dashboard", status_code=303)


@app.post("/skip")
def skip(request: Request):
    team_id, team = current_team(request)
    if not team:
        raise HTTPException(status_code=401, detail="Not logged in.")
    result = skip_main_quest(team_id)
    if result["status"] == "closed":
        return show_error(request, "Hunt closed", "The hunt is not live.")
    if result["status"] == "no_skips":
        return show_error(request, "No skips left", f"Only {MAX_SKIPS} skip is allowed per team.")
    return RedirectResponse(url=f"{PREFIX}/dashboard", status_code=303)


@app.get("/leaderboard")
def leaderboard_page(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="leaderboard.html",
        context={"rows": leaderboard(), "phase": hunt_phase()},
    )


@app.get("/login")
def login_page(request: Request, next: str = ""):
    if not next or not next.startswith("/") or next.startswith("//"):
        next = f"{PREFIX}/dashboard"

    if request.session.get("team_id"):
        return RedirectResponse(url=next, status_code=303)

    return templates.TemplateResponse(
        request=request,
        name="login.html",
        context={"next": next}
    )


@app.post("/login")
def login(
    request: Request,
    team_name: str = Form(...),
    password: str = Form(...),
    next: str = Form("")
):
    if not next or not next.startswith("/") or next.startswith("//"):
        next = f"{PREFIX}/dashboard"

    team_name = team_name.strip()

    for team_id, team in load_teams().items():
        if team["team_name"].lower() == team_name.lower():
            if not verify_password(password, team["password_hash"]):
                break
            request.session["team_id"] = team_id
            return RedirectResponse(url=next, status_code=303)

    raise HTTPException(status_code=401, detail="Invalid team name or password.")


@app.post("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse(url="/", status_code=303)


def check_qr(request, team, token):
    """Return (quest, error_response)."""
    quest = find_qr_quest_by_token(token)
    if quest is None and PREFIX:
        # Old printed Side Quest QRs point here; Side Quests now live on the Quacks server.
        return None, RedirectResponse(url=f"/sq/{token}", status_code=303)
    if quest is None:
        return None, show_error(request, "Invalid QR code",
                                "This QR code could not be recognized. Please check that you scanned the correct code.", 404)

    phase = hunt_phase(team)
    if phase == "before":
        return None, show_error(request, "Hunt not started", "The treasure hunt starts at 10:15 AM.")
    if phase == "ended":
        return None, show_error(request, "Hunt over", "The treasure hunt ended at 1:30 PM.")

    route = team["main_route"]
    progress = team["main_progress"]
    if progress >= len(route):
        return None, show_error(request, "Hunt completed", "Your team has already finished the hunt.")
    if quest["id"] != route[progress]:
        pos = route.index(quest["id"]) if quest["id"] in route else -1
        if 0 <= pos < progress:
            return None, show_error(request, "Already completed",
                                    f"Your team already completed this clue (clue {pos + 1}). You're on clue {progress + 1} of {len(route)}; check your hunt dashboard for it.")
        return None, show_error(request, "Not your current clue yet",
                                f"Nice find, but this is a later clue for your team. You're on clue {progress + 1} of {len(route)}. "
                                "Every team gets the first 5 clues in its own random order, so solve your current clue first.")
    return quest, None


@app.get("/answer/q/{token}")
def inspect_qr_code(token: str, request: Request):
    team_id, team = current_team(request)
    if not team:
        return login_redirect(f"/answer/q/{token}")

    quest, error = check_qr(request, team, token)
    if error:
        return error

    return templates.TemplateResponse(
        request=request,
        name="qr_scan.html",
        context={
            "team_name": team["team_name"],
            "title": quest["title"],
            "token": token,
        }
    )


@app.post("/answer/q/{token}")
async def submit_qr_answer(token: str, request: Request, photo: UploadFile = File(...)):
    team_id, team = current_team(request)
    if not team:
        return login_redirect(f"/answer/q/{token}")

    quest, error = check_qr(request, team, token)
    if error:
        return error

    return await finish_with_photo(request, team_id, quest, photo)


async def finish_with_photo(request, team_id, quest, photo):
    if not (photo.content_type or "").startswith("image/"):
        return show_error(request, "Photo required", "Please upload a team photo taken at this location.")

    data = await photo.read()
    if not data:
        return show_error(request, "Photo required", "Please upload a team photo taken at this location.")
    if len(data) > MAX_PHOTO_BYTES:
        return show_error(request, "Photo too large", "Please upload a photo smaller than 15 MB.")

    ext = (photo.content_type.split("/")[-1] or "jpg").split(";")[0]
    ext = re.sub(r"[^a-z0-9]", "", ext.lower())[:5] or "jpg"
    filename = f"{team_id[:8]}_{quest['id']}_{int(time.time())}.{ext}"
    (PHOTO_DIR / filename).write_bytes(data)

    result = complete_main_quest(team_id, quest["id"], filename)
    if result["status"] != "completed_quest":
        (PHOTO_DIR / filename).unlink(missing_ok=True)
        return show_error(request, "Could not complete clue", "This clue is no longer active for your team.")

    return templates.TemplateResponse(
        request=request,
        name="qr_result.html",
        context={
            "message": "Clue completed and photo uploaded!",
            "completed": result["completed"],
        }
    )


FAILED_QR_DIR = PHOTO_DIR.parent / "qr_failed"
FAILED_QR_DIR.mkdir(parents=True, exist_ok=True)


def _token_from_text(text):
    m = re.search(r"/answer/q/([\w-]+)", text or "")
    return m.group(1) if m else (text or "").strip() or None


def _load_image_rgb(data):
    """Decode phone photos (JPEG/PNG/HEIC), honouring EXIF rotation. Returns a PIL RGB image or None."""
    try:
        from PIL import Image, ImageOps
        import io
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except Exception:
            pass
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)
        return img.convert("RGB")
    except Exception:
        return None


def decode_qr_token(data):
    """Read a QR code from an uploaded photo; return the clue token or None."""
    pil = _load_image_rgb(data)
    if pil is None:
        arr = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
        if arr is None:
            return None
        from PIL import Image
        pil = Image.fromarray(cv2.cvtColor(arr, cv2.COLOR_BGR2RGB))

    # 1) zxing-cpp: robust to blur, angle, small/large QRs.
    try:
        import zxingcpp
        from PIL import ImageOps
        w, h = pil.size
        tries = [pil]
        for target in (1600, 1000, 2400):
            scale = target / max(w, h)
            if abs(scale - 1) > 0.15:
                tries.append(pil.resize((max(1, int(w * scale)), max(1, int(h * scale)))))
        gray = ImageOps.autocontrast(pil.convert("L"))
        tries.append(gray)
        for im in tries:
            for r in zxingcpp.read_barcodes(im):
                if r.text:
                    return _token_from_text(r.text)
    except Exception:
        pass

    # 2) OpenCV fallback at several scales.
    img = cv2.cvtColor(np.array(pil), cv2.COLOR_RGB2BGR)
    detector = cv2.QRCodeDetector()
    h, w = img.shape[:2]
    candidates = []
    for target in (1000, 1600, 700, 2400):
        scale = target / max(h, w)
        candidates.append(cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_CUBIC))
    candidates.append(img)
    for im in candidates:
        for variant in (im, cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)):
            try:
                text, _, _ = detector.detectAndDecode(variant)
            except cv2.error:
                text = ""
            if text:
                return _token_from_text(text)
    return None


@app.post("/answer/photo")
async def submit_qr_photo(request: Request, qr_photo: UploadFile = File(...), photo: UploadFile = File(...)):
    """Fallback when scanning isn't possible: upload a photo of the QR plus the team photo."""
    team_id, team = current_team(request)
    if not team:
        return login_redirect("/dashboard")

    qr_data = await qr_photo.read()
    token = decode_qr_token(qr_data) if qr_data else None
    if not token and qr_data:
        # Keep failures so admins can see what went wrong / pass the team manually.
        safe = re.sub(r"[^\w]", "", team["team_name"])[:12] or "team"
        (FAILED_QR_DIR / f"{safe}_{int(time.time())}.img").write_bytes(qr_data)
    if not token:
        return show_error(request, "Couldn't read the QR",
                          "We couldn't read a QR code in that photo. Retake it close-up (QR filling most of the frame), in focus, without glare, and try again. Still failing? Send the photo to a Treasure Hunt admin and they can pass you.")

    quest, error = check_qr(request, team, token)
    if error:
        return error

    return await finish_with_photo(request, team_id, quest, photo)


@app.post("/internal/pass")
async def internal_pass(request: Request):
    require_api_key(request)
    body = await request.json()
    team_name = str(body.get("team_name", "")).strip()
    by = str(body.get("by", "admin"))
    if not team_name:
        raise HTTPException(status_code=400, detail="team_name required")
    # Screenshot/photo the team sent as proof of location (base64), kept as the clue photo.
    filename = None
    img_b64 = body.get("image_base64")
    if not img_b64:
        raise HTTPException(status_code=400, detail="A screenshot/photo from the team is required to pass")
    try:
        data = base64.b64decode(img_b64.split(",")[-1], validate=False)
    except Exception:
        raise HTTPException(status_code=400, detail="Bad image")
    if not data or len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=400, detail="Image missing or too large")
    safe_team = re.sub(r"[^\w]", "", team_name)[:12] or "team"
    filename = f"pass_{safe_team}_{int(time.time())}.jpg"
    (PHOTO_DIR / filename).write_bytes(data)
    result = admin_pass_quest(team_name, by, filename)
    if result["status"] != "passed":
        (PHOTO_DIR / filename).unlink(missing_ok=True)
    if result["status"] == "team_missing":
        raise HTTPException(status_code=404, detail="Team has not started the hunt")
    if result["status"] == "completed":
        raise HTTPException(status_code=400, detail="Team already finished the hunt")
    return result


@app.get("/internal/photos")
def internal_photos(request: Request):
    require_api_key(request)
    return all_photos()


@app.get("/internal/photos/{filename}")
def internal_photo_file(filename: str, request: Request):
    require_api_key(request)
    if not re.fullmatch(r"[\w.-]+", filename):
        raise HTTPException(status_code=400, detail="Bad filename")
    path = PHOTO_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path)


@app.get("/internal/leaderboard")
def internal_leaderboard():
    return leaderboard()


@app.get("/internal/progress")
def internal_progress(request: Request):
    require_api_key(request)
    return all_progress()
