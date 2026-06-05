#!/usr/bin/env python3
"""Run topic-research.pipe locally. Prints JSON answer to stdout."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]

load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / ".env.local", override=False)

PIPE = Path(os.environ.get("ROCKETRIDE_PIPE", str(ROOT / "topic-research.pipe"))).resolve()
URI = os.environ.get("ROCKETRIDE_URI", "http://127.0.0.1:5565")
# Private Token has task.control; pk_ public key is chat-embed only.
AUTH = (
    os.environ.get("ROCKETRIDE_PRIVATE_TOKEN")
    or os.environ.get("ROCKETRIDE_TOKEN")
    or os.environ.get("ROCKETRIDE_APIKEY")
    or os.environ.get("ROCKETRIDE_AUTH")
)


def parse_answer(raw) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    text = str(raw).strip()
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, re.I)
    candidate = fenced.group(1).strip() if fenced else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return {"summary": text, "sources": []}


async def main() -> int:
    if len(sys.argv) < 2:
        print("usage: rocketride_run.py <topic>", file=sys.stderr)
        return 1

    topic = sys.argv[1].strip()
    if not PIPE.is_file():
        print(f"pipeline not found: {PIPE}", file=sys.stderr)
        return 1

    from rocketride import RocketRideClient
    from rocketride.schema import Question

    client = RocketRideClient(uri=URI, auth=AUTH)
    try:
        await client.connect()
        # Reuse pipeline if already Run in Cursor — do not start a second copy.
        started = await client.use(filepath=str(PIPE), use_existing=True)
        token = started["token"]
        question = Question()
        question.addQuestion(topic)
        response = await client.chat(token=token, question=question)
        answers = response.get("answers") or []
        result = parse_answer(answers[0] if answers else response)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc), "sources": []}))
        return 1
    finally:
        # Do not terminate — keeps the editor pipeline running for the next topic.
        await client.disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
