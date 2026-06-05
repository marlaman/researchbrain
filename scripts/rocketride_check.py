#!/usr/bin/env python3
"""Run topic-research-check.pipe. Reads full prompt from stdin; prints JSON to stdout."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

from rocketride_discover import discover_engine_uris, discover_task_token_for_pipe

ROOT = Path(__file__).resolve().parents[1]

load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / ".env.local", override=False)

PIPE = Path(
    os.environ.get(
        "ROCKETRIDE_CHECK_PIPE",
        str(ROOT / "topic-research-check.pipe"),
    )
).resolve()


def resolve_uris() -> list[str]:
    discovered = discover_engine_uris()
    if discovered:
        return discovered
    env_uri = os.environ.get("ROCKETRIDE_URI")
    if env_uri:
        return [env_uri]
    return ["http://127.0.0.1:5565"]


def resolve_auth() -> str | None:
    return (
        discover_task_token_for_pipe(PIPE)
        or os.environ.get("ROCKETRIDE_PRIVATE_TOKEN")
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
        return {"has_new_info": False, "reason_no_push": text, "new_sources": []}


def read_prompt() -> str:
    if not sys.stdin.isatty():
        data = sys.stdin.read()
        if data.strip():
            return data.strip()
    if len(sys.argv) >= 2:
        return sys.argv[1].strip()
    return ""


async def main() -> int:
    prompt = read_prompt()
    if not prompt:
        print(
            json.dumps(
                {
                    "error": "No check prompt provided on stdin.",
                    "has_new_info": False,
                    "new_sources": [],
                }
            )
        )
        return 1

    if not PIPE.is_file():
        print(
            json.dumps(
                {
                    "error": f"Check pipeline not found: {PIPE}",
                    "has_new_info": False,
                    "new_sources": [],
                }
            )
        )
        return 1

    auth = resolve_auth()
    if not auth:
        print(
            json.dumps(
                {
                    "error": (
                        "No Rocket Ride token found. Open topic-research-check.pipe "
                        "in Cursor, click Run (▶) until chat is available, then retry."
                    ),
                    "has_new_info": False,
                    "new_sources": [],
                }
            )
        )
        return 1

    uris = resolve_uris()

    from rocketride import RocketRideClient
    from rocketride.schema import Question

    client = None
    started = None
    for candidate in uris:
        candidate_client = RocketRideClient(uri=candidate, auth=auth)
        try:
            await candidate_client.connect()
            started = await candidate_client.use(filepath=str(PIPE), use_existing=True)
            client = candidate_client
            break
        except Exception:
            await candidate_client.disconnect()

    if client is None or started is None:
        print(
            json.dumps(
                {
                    "error": (
                        "Cannot connect to Rocket Ride. Open topic-research-check.pipe "
                        "in Cursor and click Run (▶) until chat is available, then retry."
                    ),
                    "has_new_info": False,
                    "new_sources": [],
                }
            )
        )
        return 1

    try:
        token = started["token"]
        question = Question()
        question.addQuestion(prompt)
        response = await client.chat(token=token, question=question)
        answers = response.get("answers") or []
        result = parse_answer(answers[0] if answers else response)
        print(json.dumps(result))
        return 0
    except Exception as exc:
        msg = str(exc)
        if exc.__class__.__name__ == "AuthenticationException" or msg == "Bad request":
            msg = (
                "Rocket Ride auth failed. Click Run (▶) on topic-research-check.pipe "
                "in Cursor until chat is available, then retry."
            )
        print(json.dumps({"error": msg, "has_new_info": False, "new_sources": []}))
        return 1
    finally:
        if client is not None:
            await client.disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
