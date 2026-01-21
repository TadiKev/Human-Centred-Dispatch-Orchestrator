# backend/core/management/commands/sanitize_assignment_reasons.py
import json
import ast
from django.core.management.base import BaseCommand
from django.db import transaction
from core.models import Assignment  # adjust path if different
import logging

logger = logging.getLogger(__name__)

class Command(BaseCommand):
    help = "Sanitize Assignment.reason values: convert python-repr strings to JSON strings when possible."

    def handle(self, *args, **options):
        qs = Assignment.objects.exclude(reason__isnull=True).exclude(reason__exact="")
        total = qs.count()
        self.stdout.write(f"Scanning {total} assignments for sanitization...")
        fixed = 0
        skipped = 0
        for a in qs.iterator():
            raw = a.reason
            # if it's a dict/object already, skip
            if isinstance(raw, dict):
                skipped += 1
                continue
            if not isinstance(raw, str):
                skipped += 1
                continue
            s = raw.strip()
            if not (s.startswith("{") and s.endswith("}")):
                skipped += 1
                continue
            # attempt ast.literal_eval safely
            try:
                parsed = ast.literal_eval(s)
                if isinstance(parsed, dict):
                    # save as JSON string (safe even if field is TextField)
                    a.reason = json.dumps(parsed, default=str)
                    a.save(update_fields=["reason"])
                    fixed += 1
                else:
                    skipped += 1
            except Exception as e:
                # Last attempt: try replace single quotes -> double quotes (heuristic)
                try:
                    attempt = s.replace("'", '"')
                    parsed2 = json.loads(attempt)
                    if isinstance(parsed2, dict):
                        a.reason = json.dumps(parsed2, default=str)
                        a.save(update_fields=["reason"])
                        fixed += 1
                    else:
                        skipped += 1
                except Exception:
                    logger.debug("Could not parse reason for assignment %s", a.id, exc_info=True)
                    skipped += 1

        self.stdout.write(self.style.SUCCESS(f"Done. Fixed: {fixed}. Skipped: {skipped}."))
