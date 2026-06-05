"""Auto-discover local Rocket Ride URI + auth from the running Cursor pipeline."""

from __future__ import annotations

import glob
import json
import os
import re
import subprocess
from pathlib import Path


def _eaas_pids() -> set[str]:
    try:
        out = subprocess.check_output(
            ["pgrep", "-f", r"RocketRide/engine/engine --autoterm ./ai/eaas.py"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return set()
    return {line.strip() for line in out.splitlines() if line.strip()}


def discover_engine_uris() -> list[str]:
    """Find localhost ports where the main Rocket Ride engine (eaas) is listening."""
    eaas_pids = _eaas_pids()
    if not eaas_pids:
        return []

    try:
        out = subprocess.check_output(
            ["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return []

    ports: list[int] = []
    for line in out.splitlines():
        parts = line.split()
        if len(parts) < 2 or parts[0] != "engine" or parts[1] not in eaas_pids:
            continue
        match = re.search(r":(\d+)\s+\(LISTEN\)", line)
        if match:
            ports.append(int(match.group(1)))

    return [f"http://localhost:{port}" for port in sorted(set(ports))]


def discover_engine_uri() -> str | None:
    uris = discover_engine_uris()
    return uris[0] if uris else None


# First agent instruction line identifies which .pipe session a task file belongs to.
PIPE_FINGERPRINTS: dict[str, str] = {
    "topic-research.pipe": "multi-source research agent",
    "topic-research-check.pipe": "incremental research checker",
}


def _pipeline_fingerprint(data: dict) -> str:
    try:
        components = data["config"]["pipeline"]["components"]
        for comp in components:
            if comp.get("provider") != "agent_deepagent":
                continue
            instructions = comp["config"]["default"]["instructions"]
            if instructions:
                return str(instructions[0])
    except (KeyError, TypeError, IndexError):
        pass
    return ""


def _iter_pipeline_tasks() -> list[tuple[str, dict]]:
    tmpdir = os.environ.get("TMPDIR", "/tmp")
    paths = sorted(
        glob.glob(os.path.join(tmpdir, "task-*.json")),
        key=os.path.getmtime,
        reverse=True,
    )
    tasks: list[tuple[str, dict]] = []
    for path in paths:
        try:
            data = json.loads(Path(path).read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if data.get("type") == "pipeline":
            tasks.append((path, data))
    return tasks


def discover_task_token_for_pipe(pipe_path: str | Path) -> str | None:
    """Read taskId for the running pipeline that matches the given .pipe file."""
    pipe_name = Path(pipe_path).name
    marker = PIPE_FINGERPRINTS.get(pipe_name)
    if not marker:
        return discover_task_token()

    for _path, data in _iter_pipeline_tasks():
        task_id = data.get("taskId")
        if not (isinstance(task_id, str) and task_id.startswith("tk_")):
            continue
        if marker in _pipeline_fingerprint(data):
            return task_id

    return None


def discover_task_token() -> str | None:
    """Read taskId (Private Token) from the newest running pipeline task file."""
    for _path, data in _iter_pipeline_tasks():
        task_id = data.get("taskId")
        if isinstance(task_id, str) and task_id.startswith("tk_"):
            return task_id

    return None


def discover() -> tuple[str | None, str | None]:
    return discover_engine_uri(), discover_task_token()
