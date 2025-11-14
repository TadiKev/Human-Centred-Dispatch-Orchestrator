set -euo pipefail

### Defaults - adjust if you want a different layout
MODEL_DIR_DEFAULT="backend/ml/models"
PROD_SUBDIR="production"

### Args
SRC=""
MODEL_DIR="$MODEL_DIR_DEFAULT"
USE_TIMESTAMP=0
FORCE=0

print_help() {
  cat <<'USAGE'
promote_model.sh - safely promote a model into the production folder and update current_model.txt

Options:
  --src PATH         Path to the model joblib to promote. If omitted, the newest .joblib in MODEL_DIR is used.
  --model-dir PATH   Base models directory (default: backend/ml/models)
  --timestamp        Append UTC timestamp to promoted filenames (recommended for immutability)
  --force            Overwrite existing files in production if present
  --help             Show this help and exit

Behavior:
  - Copies model and any matching .meta.json and .metrics.json (if present) into MODEL_DIR/production/
  - If --timestamp is used the destination filenames will include a UTC timestamp.
  - Updates MODEL_DIR/production/current_model.txt atomically to point at the promoted file basename.
  - Exits non-zero on errors.
USAGE
}

# simple arg parsing
while [ $# -gt 0 ]; do
  case "$1" in
    --src) shift; SRC="$1"; shift ;;
    --model-dir) shift; MODEL_DIR="$1"; shift ;;
    --timestamp) USE_TIMESTAMP=1; shift ;;
    --force) FORCE=1; shift ;;
    --help|-h) print_help; exit 0 ;;
    *) printf "Unknown arg: %s\n" "$1" >&2; print_help; exit 2 ;;
  esac
done

# sanity checks
if [ ! -d "$MODEL_DIR" ]; then
  printf "Model dir not found: %s\n" "$MODEL_DIR" >&2
  exit 2
fi

PROD_DIR="${MODEL_DIR%/}/${PROD_SUBDIR}"
mkdir -p "$PROD_DIR"

# if SRC not provided, pick newest .joblib in MODEL_DIR (excluding production subdir)
if [ -z "$SRC" ]; then
  # list joblibs in MODEL_DIR (not in production), pick newest
  newest="$(ls -1t "${MODEL_DIR%/}"/*.joblib 2>/dev/null | grep -v "/${PROD_SUBDIR}/" | head -n1 || true)"
  if [ -z "$newest" ]; then
    printf "No .joblib files found in %s to promote. Provide --src.\n" "$MODEL_DIR" >&2
    exit 2
  fi
  SRC="$newest"
fi

# resolve src absolute path if possible
if command -v realpath >/dev/null 2>&1; then
  SRC="$(realpath "$SRC")"
fi

if [ ! -f "$SRC" ]; then
  printf "Source file not found: %s\n" "$SRC" >&2
  exit 2
fi

BASE="$(basename "$SRC")"
TIMESTAMP=""
if [ "$USE_TIMESTAMP" -eq 1 ]; then
  TIMESTAMP=".$(date -u +%Y%m%dT%H%M%SZ)"
fi

DEST_BASENAME="${BASE%.*}${TIMESTAMP}.${BASE##*.}"   # preserves extension, e.g. model.joblib -> model.<ts>.joblib if timestamped
DEST_PATH="${PROD_DIR%/}/${DEST_BASENAME}"

# copy flags: -v for verbosity; -n to avoid overwrite unless --force used
CP_OPTS="-v"
if [ "$FORCE" -eq 0 ]; then
  CP_OPTS="$CP_OPTS -n"
else
  CP_OPTS="$CP_OPTS -f"
fi

printf "Promoting model %s -> %s\n" "$SRC" "$DEST_PATH"
# copy model file
if cp $CP_OPTS "$SRC" "$DEST_PATH"; then
  printf "Copied model -> %s\n" "$DEST_PATH"
else
  printf "Failed to copy model %s -> %s\n" "$SRC" "$DEST_PATH" >&2
  exit 3
fi

# helper to copy companion metadata/metrics if they exist
copy_if_exists() {
  srcbase="$1"   # full path to source model, e.g. /path/to/model.joblib
  dest_dir="$2"
  ts="$3"        # timestamp string beginning with dot or empty
  # common companion filenames:
  # model.joblib.meta.json or model.meta.json or model.joblib.metrics.json etc.
  local candidates=(
    "${srcbase}.meta.json"
    "${srcbase}.metrics.json"
    "$(dirname "$srcbase")/$(basename "${srcbase%.*}").meta.json"
    "$(dirname "$srcbase")/$(basename "${srcbase%.*}").metrics.json"
  )
  for cand in "${candidates[@]}"; do
    if [ -f "$cand" ]; then
      basecand="$(basename "$cand")"
      # Build destination name: if timestamping, insert timestamp before final extension
      if [ -n "$ts" ]; then
        # split name and extension, append ts before ext
        name_noext="${basecand%.*}"
        ext="${basecand##*.}"
        destname="${name_noext}${ts}.${ext}"
      else
        destname="${basecand}"
      fi
      destpath="${dest_dir%/}/${destname}"
      if cp $CP_OPTS "$cand" "$destpath"; then
        printf "Copied companion file %s -> %s\n" "$cand" "$destpath"
      else
        printf "Warning: failed to copy companion %s\n" "$cand" >&2
      fi
    fi
  done
}

# copy companion meta/metrics
copy_if_exists "$SRC" "$PROD_DIR" "$TIMESTAMP"

# atomic update of pointer file
CURRENT_PTR="${PROD_DIR%/}/current_model.txt"
TMP="$(mktemp "${PROD_DIR%/}/current_model.XXXXXX")"
# Write the basename that the service expects (the file name in production dir)
echo "${DEST_BASENAME}" > "$TMP"
# move into place atomically (works on same filesystem)
mv -f "$TMP" "$CURRENT_PTR"
printf "Updated current pointer -> %s (value: %s)\n" "$CURRENT_PTR" "${DEST_BASENAME}"

printf "Promotion complete: production model is %s\n" "${DEST_BASENAME}"
exit 0
