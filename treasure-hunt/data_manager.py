import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import random
import threading

# Protect shared JSON data during read-modify-write operations.
# This is suitable for a single-process server.
data_lock = threading.Lock()


DATA_DIR = Path(__file__).parent / "data"
PHOTO_DIR = DATA_DIR / "photos"

IST = timezone(timedelta(hours=5, minutes=30))

HUNT_START = datetime.fromisoformat(os.getenv("HUNT_START", "2026-10-11T10:15:00+05:30"))
HUNT_END = datetime.fromisoformat(os.getenv("HUNT_END", "2026-10-11T13:30:00+05:30"))

SKIP_PENALTY_MIN = 29
HINT_PENALTY_MIN = 12
MAX_SKIPS = 1


def now():
    return datetime.now(IST)


# Teams that can play outside the hunt window (for trying it out); hidden from the leaderboard.
TEST_TEAMS = {n.strip().lower() for n in os.getenv("HUNT_TEST_TEAMS", "test").split(",") if n.strip()}


def is_test_team(team):
    return bool(team) and team.get("team_name", "").lower() in TEST_TEAMS


def hunt_phase(team=None):
    """Return "before", "live" or "ended"."""
    if is_test_team(team):
        return "live"
    t = now()
    if t < HUNT_START:
        return "before"
    if t >= HUNT_END:
        return "ended"
    return "live"


def load_json(filename, default=None):
    path = DATA_DIR / filename

    if default is not None and not path.exists():
        return default

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_json(filename, data):
    path = DATA_DIR / filename
    temporary_path = path.with_suffix(path.suffix + ".tmp")

    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=4)
        file.flush()

    temporary_path.replace(path)


def load_main_quests():
    return load_json("main_quests.json")


def load_teams():
    return load_json("teams.json", default={})


def save_teams(teams):
    save_json("teams.json", teams)


def new_team(team_name, password_hash):
    return {
        "team_name": team_name,
        "password_hash": password_hash,
        "main_route": generate_main_route(),
        "main_progress": 0,
        "skips": [],
        "hints": [],
        "photos": [],
        "finished_at": None,
    }


def generate_main_route():
    quests = load_main_quests()

    randomized = [
        quest for quest in quests
        if quest["randomize"]
    ]

    fixed = [
        quest for quest in quests
        if not quest["randomize"]
    ]

    randomized.sort(key=lambda quest: quest["original_order"])
    fixed.sort(key=lambda quest: quest["original_order"])

    random.shuffle(randomized)

    route = randomized + fixed

    return [quest["id"] for quest in route]


def get_main_quest_by_id(quest_id):
    for quest in load_main_quests():
        if quest["id"] == quest_id:
            return quest

    return None


def find_qr_quest_by_token(token):
    """Return the main quest whose QR token matches, or None."""
    for quest in load_main_quests():
        if quest.get("qr_token") == token:
            return quest

    return None


def update_teams(update_function):
    """Safely read, modify, and save teams in one process."""
    with data_lock:
        teams = load_teams()
        result = update_function(teams)
        save_teams(teams)
        return result


def _advance(team):
    team["main_progress"] += 1
    completed = team["main_progress"] >= len(team["main_route"])
    if completed and not team.get("finished_at"):
        team["finished_at"] = now().isoformat()
    return completed


def complete_main_quest(team_id, quest_id, photo_filename):
    """Complete the team's current clue via its location QR + photo."""
    with data_lock:
        teams = load_teams()
        team = teams.get(team_id)

        if team is None:
            return {"status": "team_missing"}

        if hunt_phase(team) != "live":
            return {"status": "closed"}

        route = team["main_route"]
        progress = team["main_progress"]

        if progress >= len(route):
            return {"status": "completed"}

        if quest_id != route[progress]:
            return {"status": "not_current"}

        team.setdefault("photos", []).append({
            "quest_id": quest_id,
            "filename": photo_filename,
            "uploaded_at": now().isoformat(),
        })
        completed = _advance(team)
        save_teams(teams)

        return {"status": "completed_quest", "completed": completed}


def admin_pass_quest(team_name, by, photo_filename=None):
    """Admin completes a team's current clue (e.g. QR unreadable / no network). No penalty."""
    with data_lock:
        teams = load_teams()
        team = next((t for t in teams.values() if t["team_name"].lower() == team_name.lower()), None)

        if team is None:
            return {"status": "team_missing"}

        route = team["main_route"]
        progress = team["main_progress"]

        if progress >= len(route):
            return {"status": "completed"}

        team.setdefault("passes", []).append({
            "quest_id": route[progress],
            "by": by,
            "at": now().isoformat(),
            "photo": photo_filename,
        })
        if photo_filename:
            team.setdefault("photos", []).append({
                "quest_id": route[progress],
                "filename": photo_filename,
                "uploaded_at": now().isoformat(),
                "admin_pass_by": by,
            })
        completed = _advance(team)
        save_teams(teams)

        return {"status": "passed", "completed": completed, "quest_id": route[progress]}


def skip_main_quest(team_id):
    with data_lock:
        teams = load_teams()
        team = teams.get(team_id)

        if team is None:
            return {"status": "team_missing"}

        if hunt_phase(team) != "live":
            return {"status": "closed"}

        route = team["main_route"]
        progress = team["main_progress"]

        if progress >= len(route):
            return {"status": "completed"}

        skips = team.setdefault("skips", [])
        if len(skips) >= MAX_SKIPS:
            return {"status": "no_skips"}

        skips.append(route[progress])
        completed = _advance(team)
        save_teams(teams)

        return {"status": "skipped", "completed": completed}


def use_hint(team_id):
    with data_lock:
        teams = load_teams()
        team = teams.get(team_id)

        if team is None:
            return {"status": "team_missing"}

        if hunt_phase(team) != "live":
            return {"status": "closed"}

        route = team["main_route"]
        progress = team["main_progress"]

        if progress >= len(route):
            return {"status": "completed"}

        quest = get_main_quest_by_id(route[progress])
        hints = team.setdefault("hints", [])
        if quest is None or hints.count(quest["id"]) >= len(quest.get("hints", [])):
            return {"status": "no_hints"}

        hints.append(quest["id"])
        save_teams(teams)

        return {"status": "ok"}


def team_score(team):
    skips = len(team.get("skips", []))
    hints = len(team.get("hints", []))
    penalty = skips * SKIP_PENALTY_MIN + hints * HINT_PENALTY_MIN
    finished_at = team.get("finished_at")
    elapsed = None
    final = None
    # Time the team reached its latest clue (photo / admin pass), used to rank unfinished teams.
    times = [p["uploaded_at"] for p in team.get("photos", [])] + [p["at"] for p in team.get("passes", [])]
    last_at = max(times) if times else None
    last_elapsed = max(0, int((datetime.fromisoformat(last_at) - HUNT_START).total_seconds())) if last_at else None
    if finished_at:
        # Test teams can finish before the start; never show a negative time.
        elapsed = max(0, int((datetime.fromisoformat(finished_at) - HUNT_START).total_seconds()))
        final = elapsed + penalty * 60
    return {
        "team_name": team["team_name"],
        "finished": bool(finished_at),
        "finished_at": finished_at,
        "elapsed_seconds": elapsed,
        "skips": skips,
        "hints": hints,
        "penalty_minutes": penalty,
        "hint_minutes": hints * HINT_PENALTY_MIN,
        "skip_minutes": skips * SKIP_PENALTY_MIN,
        "final_seconds": final,
        "last_progress_at": last_at,
        "score_seconds": final if final is not None else (last_elapsed + penalty * 60 if last_elapsed is not None else None),
        "progress": team["main_progress"],
        "total": len(team["main_route"]),
    }


def load_disqualified():
    """{team name (lowercase): label} from disqualified.json."""
    try:
        with (Path(__file__).parent / "disqualified.json").open(encoding="utf-8") as f:
            return {k.strip().lower(): v for k, v in json.load(f).items()}
    except Exception:
        return {}


def leaderboard():
    """Rank: finished first by final time, then by clues done, then by time-to-last-clue + penalties.
    Disqualified teams stay in place, struck through, unranked."""
    dq = load_disqualified()
    rows = []
    for t in load_teams().values():
        if is_test_team(t):
            continue
        row = team_score(t)
        row["test"] = False
        row["disqualified"] = dq.get(t["team_name"].strip().lower())
        rows.append(row)
    big = 10 ** 9
    rows.sort(key=lambda r: (not r["finished"], -r["progress"],
                             r["score_seconds"] if r["score_seconds"] is not None else big, r["team_name"].lower()))
    rank = 0
    for row in rows:
        if row["disqualified"] or row["progress"] == 0:
            row["rank"] = None
        else:
            rank += 1
            row["rank"] = rank
    return rows


def all_photos():
    quests = {q["id"]: q for q in load_main_quests()}
    result = []
    for team in load_teams().values():
        for p in team.get("photos", []):
            q = quests.get(p["quest_id"])
            result.append({
                "team_name": team["team_name"],
                "quest_id": p["quest_id"],
                "quest_title": q.get("location", q["title"]) if q else p["quest_id"],
                "filename": p["filename"],
                "uploaded_at": p["uploaded_at"],
                "admin_pass_by": p.get("admin_pass_by"),
            })
    result.sort(key=lambda p: (p["team_name"].lower(), p["uploaded_at"]))
    return result


def all_progress():
    """Per-team hunt progress for admins (includes test teams, flagged)."""
    quests = {q["id"]: q for q in load_main_quests()}
    rows = []
    for team in load_teams().values():
        score = team_score(team)
        route = team["main_route"]
        progress = team["main_progress"]
        current = quests.get(route[progress]) if progress < len(route) else None
        photos = team.get("photos", [])
        score.update({
            "current_clue": progress + 1 if current else None,
            "current_location": current.get("location", current["title"]) if current else None,
            "last_activity": photos[-1]["uploaded_at"] if photos else None,
            "photos": len(photos),
            "passes": len(team.get("passes", [])),
            "test": is_test_team(team),
        })
        rows.append(score)
    rows.sort(key=lambda r: (not r["finished"], r["final_seconds"] or 0, -r["progress"], r["team_name"].lower()))
    return rows
