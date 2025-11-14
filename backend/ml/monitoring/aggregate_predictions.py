#!/usr/bin/env python3
"""
aggregate_predictions.py

Usage:
  python aggregate_predictions.py --input ./backend/ml/predictions.jsonl --out ./backend/ml/monitoring/weekly_report.md --days 7
"""
import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

def load_jsonl(path):
    out = []
    p = Path(path)
    if not p.exists():
        return out
    with open(p, "r", encoding="utf-8") as fh:
        for line in fh:
            try:
                out.append(json.loads(line))
            except Exception:
                continue
    return out

def summarize(records, days=7):
    now = datetime.utcnow()
    cutoff = now.timestamp() - days * 86400
    recs = [r for r in records if r.get("ts", 0) >= cutoff]
    summary = {
        "period_days": days,
        "total_calls": len(recs),
        "by_task": {},
        "fallback_count": 0,
        "ml_count": 0,
    }
    tasks = defaultdict(list)
    for r in recs:
        task = r.get("task", "unknown")
        tasks[task].append(r)
        if r.get("fallback"):
            summary["fallback_count"] += 1
        else:
            summary["ml_count"] += 1
    for task, rs in tasks.items():
        stats = {"count": len(rs)}
        if task == "duration":
            durations = []
            for r in rs:
                out = r.get("output", {})
                pdur = out.get("predicted_duration") or out.get("predicted_duration")
                if isinstance(pdur, list) and pdur:
                    try:
                        durations.append(float(pdur[0]))
                    except Exception:
                        pass
            stats["mean_predicted_duration"] = sum(durations) / len(durations) if durations else None
        if task == "no_show":
            probs = []
            for r in rs:
                out = r.get("output", {})
                p = out.get("probabilities")
                if isinstance(p, list) and p:
                    try:
                        probs.append(float(p[0]))
                    except Exception:
                        pass
            stats["mean_no_show_prob"] = sum(probs) / len(probs) if probs else None
        stats["fallbacks"] = sum(1 for r in rs if r.get("fallback"))
        stats["ml"] = sum(1 for r in rs if not r.get("fallback"))
        summary["by_task"][task] = stats
    return summary, recs

def write_report(summary, recs, outpath):
    p = Path(outpath)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        fh.write(f"# ML Predictions Weekly Report\n\n")
        fh.write(f"Generated: {datetime.utcnow().isoformat()}Z\n\n")
        fh.write(f"- Period (days): {summary['period_days']}\n")
        fh.write(f"- Total calls: {summary['total_calls']}\n")
        fh.write(f"- ML calls: {summary['ml_count']}\n")
        fh.write(f"- Fallback calls: {summary['fallback_count']}\n\n")
        fh.write("## By task\n\n")
        for task, stats in summary["by_task"].items():
            fh.write(f"### {task}\n\n")
            for k, v in stats.items():
                fh.write(f"- {k}: {v}\n")
            fh.write("\n")
        fh.write("## Latest raw entries (most recent 20)\n\n")
        for r in sorted(recs, key=lambda x: x.get("ts", 0), reverse=True)[:20]:
            ts = datetime.utcfromtimestamp(r.get("ts", 0)).isoformat() + "Z"
            fh.write(f"- {ts} | task={r.get('task')} | model_version={r.get('model_version')} | fallback={r.get('fallback')}\n")
    return p

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="./backend/ml/predictions.jsonl", help="predictions.jsonl path")
    ap.add_argument("--out", default="./backend/ml/monitoring/weekly_report.md", help="output report markdown")
    ap.add_argument("--days", type=int, default=7, help="period in days to summarise")
    args = ap.parse_args()
    records = load_jsonl(args.input)
    summary, recs = summarize(records, days=args.days)
    outpath = write_report(summary, recs, args.out)
    print("Wrote report to", outpath)
