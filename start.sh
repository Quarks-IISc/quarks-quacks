#!/usr/bin/env bash
set -e

cleanup() {
  echo "Shutting down..."
  kill $PID_POINTS $PID_HUNT 2>/dev/null
  wait $PID_POINTS $PID_HUNT 2>/dev/null
  echo "Done."
}
trap cleanup EXIT INT TERM

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load SMTP_USER / SMTP_PASS etc. from .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; . "$SCRIPT_DIR/.env"; set +a
fi
HUNT_DIR="$SCRIPT_DIR/../quacks_treasure_hunt"

echo "Starting quarks-points on :3001..."
cd "$SCRIPT_DIR" && node --watch server.js &
PID_POINTS=$!

echo "Starting treasure hunt on :8000..."
cd "$HUNT_DIR" && .venv/bin/uvicorn main:app --port 8000 --reload --reload-include "*.html" &
PID_HUNT=$!

echo ""
echo "  Quarks Points:     http://localhost:3001"
echo "  Treasure Hunt:     http://localhost:3001/treasure-hunt"
echo ""
echo "Press Ctrl+C to stop both."

wait
