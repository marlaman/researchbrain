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

from rocketride_discover import (
    discover,
    discover_engine_uri,
    discover_engine_uris,
    discover_task_token_for_pipe,
)

ROOT = Path(__file__).resolve().parents[1]

load_dotenv(ROOT / ".env", override=False)
load_dotenv(ROOT / ".env.local", override=False)

PIPE = Path(os.environ.get("ROCKETRIDE_PIPE", str(ROOT / "topic-research.pipe"))).resolve()


def resolve_uris() -> list[str]:
    discovered = discover_engine_uris()
    if discovered:
        return discovered
    env_uri = os.environ.get("ROCKETRIDE_URI")
    if env_uri:
        return [env_uri]
    return ["http://127.0.0.1:5565"]


def resolve_auth() -> str | None:
    # Bind auth to the initial-research pipeline, not whichever .pipe ran last.
    return (
        discover_task_token_for_pipe(PIPE)
        or os.environ.get("ROCKETRIDE_PRIVATE_TOKEN")
        or os.environ.get("ROCKETRIDE_TOKEN")
        or os.environ.get("ROCKETRIDE_APIKEY")
        or os.environ.get("ROCKETRIDE_AUTH")
    )


AGENT_ERROR_MARKERS = (
    "deep agent invoke failed",
    "error occurred with the openai api",
    "openai api",
    "authenticationexception",
    "task is terminating",
    "pipeline is already running",
    "bad request",
)


def agent_error_from_text(text: str) -> str | None:
    lower = text.lower()
    if any(marker in lower for marker in AGENT_ERROR_MARKERS):
        return text.strip()[:800]
    return None


def validate_initial_result(result: dict) -> dict:
    if result.get("error"):
        return result

    summary = result.get("summary")
    if isinstance(summary, str):
        agent_err = agent_error_from_text(summary)
        if agent_err:
            if "openai api" in agent_err.lower():
                return {
                    "error": (
                        "Rocket Ride OpenAI call failed. Your key is configured, but the OpenAI "
                        "account likely has no quota/billing credits (insufficient_quota). "
                        "Add credits at https://platform.openai.com/account/billing or switch to "
                        "a key with available quota, then Stop + Run (▶) topic-research.pipe and retry."
                    ),
                    "sources": [],
                }
            return {"error": f"Rocket Ride agent failed: {agent_err}", "sources": []}

    if "has_new_info" in result or "new_sources" in result:
        return {
            "error": (
                "Wrong Rocket Ride pipeline is active. Initial research needs "
                "topic-research.pipe running in Cursor (▶), not topic-research-check.pipe."
            ),
            "sources": [],
        }
    if not result.get("sources"):
        return {
            "error": (
                "Rocket Ride returned no sources. Open topic-research.pipe in Cursor, "
                "click Run (▶) until chat is available, then retry initial research."
            ),
            "sources": [],
        }
    return result


def parse_answer(raw) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    text = str(raw).strip()
    agent_err = agent_error_from_text(text)
    if agent_err:
        return {"summary": agent_err, "sources": []}
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

    auth = resolve_auth()
    if not auth:
        print(
            json.dumps(
                {
                    "error": (
                        "No Rocket Ride token found for topic-research.pipe. Open that file "
                        "in Cursor, click Run (▶) until chat is available, then retry. "
                        "(topic-research-check.pipe is a different pipeline — run both if you "
                        "use Check latest info.)"
                    ),
                    "sources": [],
                }
            )
        )
        return 1

    uris = resolve_uris()

    from rocketride import RocketRideClient
    from rocketride.schema import Question

    client = None
    uri = uris[0]
    started = None
    last_err: Exception | None = None
    for candidate in uris:
        candidate_client = RocketRideClient(uri=candidate, auth=auth)
        try:
            await candidate_client.connect()
            started = await candidate_client.use(filepath=str(PIPE), use_existing=True)
            client = candidate_client
            uri = candidate
            break
        except Exception as exc:
            last_err = exc
            await candidate_client.disconnect()

    if client is None or started is None:
        print(
            json.dumps(
                {
                    "error": (
                        "Cannot connect to Rocket Ride. "
                        "Open topic-research.pipe in Cursor and click Run (▶) "
                        "until chat is available, then retry."
                    ),
                    "sources": [],
                }
            )
        )
        return 1

    try:
        token = started["token"]
        question = Question()
        question.addQuestion(f"Research topic: {topic}")
        response = await client.chat(token=token, question=question)
        answers = response.get("answers") or []
        result = validate_initial_result(parse_answer(answers[0] if answers else response))
        print(json.dumps(result))
        return 0 if not result.get("error") else 1
    except Exception as exc:
        msg = str(exc)
        if exc.__class__.__name__ == "AuthenticationException" or msg == "Bad request":
            msg = (
                "Rocket Ride auth failed. Click Run (▶) on topic-research.pipe in Cursor "
                "until chat is available, then retry. "
                "(Remove stale ROCKETRIDE_URI / ROCKETRIDE_PRIVATE_TOKEN from .env.local — "
                "credentials auto-discover from the running pipeline.)"
            )
        print(json.dumps({"error": msg, "sources": []}))
        return 1
    finally:
        if client is not None:
            await client.disconnect()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
