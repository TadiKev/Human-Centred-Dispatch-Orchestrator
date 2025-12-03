

## File: `backend/core/logging.py`


"""
Structured JSON event logger for ML event capture.

Place this file at: backend/core/logging.py
Usage: from core.logging import ml_logger; ml_logger.log_job_created(job)

This writes to stdout and to logs/ml_events.jsonl (rotating file).
"""

import json
import logging
import logging.handlers
import os
from datetime import datetime

LOG_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "logs")
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, "ml_events.jsonl")

logger = logging.getLogger("ml_events")
logger.setLevel(logging.INFO)

# File handler (rotating)
file_handler = logging.handlers.RotatingFileHandler(LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=5)
file_handler.setLevel(logging.INFO)

# stdout handler
stream_handler = logging.StreamHandler()
stream_handler.setLevel(logging.INFO)

FORMAT = "%(message)s"
file_handler.setFormatter(logging.Formatter(FORMAT))
stream_handler.setFormatter(logging.Formatter(FORMAT))

# Avoid duplicate handlers in long-lived processes
if not logger.handlers:
    logger.addHandler(file_handler)
    logger.addHandler(stream_handler)


def _safe_serialize(obj):
    """Serialize Django model instances (or simple types) to JSON-friendly dicts.
    Avoids following relations — just takes basic attrs we need.
    """
    try:
        # if it's a model instance with _meta
        if hasattr(obj, "_meta"):
            data = {f.name: getattr(obj, f.name, None) for f in obj._meta.fields}
            # try to attach some human-friendly fields
            if hasattr(obj, "id"):
                data["id"] = getattr(obj, "id")
            return data
    except Exception:
        pass
    try:
        return json.loads(json.dumps(obj, default=str))
    except Exception:
        return str(obj)


def _emit(event_type, payload):
    rec = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "event_type": event_type,
        "payload": payload,
    }
    logger.info(json.dumps(rec, default=str))


# Event helpers

def log_job_created(job, extra=None):
    pl = {"job": _safe_serialize(job)}
    if extra:
        pl["extra"] = extra
    _emit("job_created", pl)


def log_assignment_created(assignment, extra=None):
    pl = {"assignment": _safe_serialize(assignment)}
    if extra:
        pl["extra"] = extra
    _emit("assignment_created", pl)


def log_assignment_updated(assignment, changes=None, extra=None):
    pl = {"assignment": _safe_serialize(assignment), "changes": changes or {}}
    if extra:
        pl["extra"] = extra
    _emit("assignment_updated", pl)


def log_job_status_change(job, old_status, new_status, extra=None):
    pl = {"job_id": getattr(job, "id", None), "old_status": old_status, "new_status": new_status}
    if extra:
        pl["extra"] = extra
    _emit("job_status_change", pl)


def log_tech_location_update(technician, extra=None):
    pl = {"technician_id": getattr(technician, "id", None), "last_lat": getattr(technician, "last_lat", None), "last_lon": getattr(technician, "last_lon", None)}
    if extra:
        pl["extra"] = extra
    _emit("tech_location_update", pl)


# Convenience alias
class MLLogger:
    log_job_created = staticmethod(log_job_created)
    log_assignment_created = staticmethod(log_assignment_created)
    log_assignment_updated = staticmethod(log_assignment_updated)
    log_job_status_change = staticmethod(log_job_status_change)
    log_tech_location_update = staticmethod(log_tech_location_update)


ml_logger = MLLogger()






