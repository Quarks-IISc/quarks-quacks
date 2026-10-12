from pathlib import Path
import json
import secrets
import os

import qrcode


# Project directories
PROJECT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_DIR / "data"
QR_DIR = PROJECT_DIR / "qr_codes"

# Override this environment variable when generating QR codes
# for a deployed server.
BASE_URL = os.getenv(
    "TREASURE_HUNT_BASE_URL",
    "http://localhost:3001/treasure-hunt"
).rstrip("/")


def load_json(filename):
    path = DATA_DIR / filename

    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def save_json_atomically(filename, data):
    """Write JSON to a temporary file before replacing the original."""
    path = DATA_DIR / filename
    temporary_path = path.with_suffix(path.suffix + ".tmp")

    with temporary_path.open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)
        file.write("\n")

    temporary_path.replace(path)


def is_placeholder(token):
    return (
        not isinstance(token, str)
        or not token
        or token.startswith("CHANGE_THIS_TOKEN")
    )


def generate_unique_token(used_tokens):
    """Generate a unique, cryptographically random token."""
    while True:
        token = secrets.token_urlsafe(32)

        if token not in used_tokens:
            used_tokens.add(token)
            return token


def generate_qr_image(url, output_path):
    """Generate and save a QR code as a PNG image."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )

    qr.add_data(url)
    qr.make(fit=True)

    image = qr.make_image(
        fill_color="black",
        back_color="white"
    )

    image.save(output_path)


def main():
    QR_DIR.mkdir(parents=True, exist_ok=True)

    main_quests = load_json("main_quests.json")

    # Preserve existing valid tokens and avoid duplicates.
    all_quests = main_quests

    # Only QR-answer clues need tokens.
    
    qr_quests = [
        quest for quest in all_quests
        if quest["answer_method"] == "qr"
    ]

    used_tokens = set()

    for quest in qr_quests:
        token = quest.get("qr_token")

        if not is_placeholder(token):
            if token in used_tokens:
                raise ValueError(
                    "Duplicate QR token found. "
                    "Resolve duplicate tokens before continuing."
                )

            used_tokens.add(token)

    # Assign tokens to clues that don't have valid ones.
    for quest in qr_quests:
        if is_placeholder(quest.get("qr_token")):
            quest["qr_token"] = generate_unique_token(used_tokens)

    # Prepare every QR image before modifying the JSON files.
    for quest in qr_quests:
        token = quest["qr_token"]
        url = f"{BASE_URL}/answer/q/{token}"

        # Filenames use clue IDs for convenient administration.
        # The actual URLs contain only opaque tokens.
        output_path = QR_DIR / f"{quest['id']}.png"

        generate_qr_image(url, output_path)

    # Remove obsolete QR images for clues that no longer need them.
    valid_filenames = {
        f"{quest['id']}.png" for quest in qr_quests
    }

    for image_path in QR_DIR.glob("*.png"):
        if image_path.name not in valid_filenames:
            image_path.unlink()


    save_json_atomically("main_quests.json", main_quests)

    print(f"Generated {len(qr_quests)} QR codes.")

    for quest in qr_quests:
        print(f"  {quest['id']}.png")

    print(f"QR images saved in: {QR_DIR}")


if __name__ == "__main__":
    main()