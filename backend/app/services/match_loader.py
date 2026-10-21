"""
Match frame repository for xT-WhatIf.

Serves the key moments of synthetic matches. Frames are read from the committed JSON
cache (backend/app/data/cache/match_<id>_frames.json); if a cache file is missing it is
regenerated deterministically from the match seed and saved.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.services.synthetic_generator import DEFAULT_MATCH_ID, SYNTHETIC_MATCHES, generate_match

logger = logging.getLogger(__name__)


class SyntheticMatchLoader:
    def __init__(self, cache_dir: Optional[str] = None):
        self.cache_dir = Path(cache_dir or settings.CACHE_DIR)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def get_cache_path(self, match_id: int) -> Path:
        return self.cache_dir / f"match_{match_id}_frames.json"

    def available_match_ids(self) -> List[int]:
        return sorted(SYNTHETIC_MATCHES)

    def fetch_match_360_frames(self, match_id: int = DEFAULT_MATCH_ID) -> List[Dict[str, Any]]:
        """Returns the match's freeze-frames as MatchFramePayload-shaped dicts."""
        cache_file = self.get_cache_path(match_id)
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                logger.info(f"Loaded synthetic match {match_id} from cache ({len(data)} moments).")
                return data
            except (OSError, json.JSONDecodeError) as e:
                logger.warning(f"Unreadable cache {cache_file}: {e}. Regenerating.")

        if match_id not in SYNTHETIC_MATCHES:
            logger.warning(f"Unknown synthetic match id {match_id}.")
            return []

        frames = [f.model_dump(mode="json") for f in generate_match(match_id)]
        try:
            with open(cache_file, "w", encoding="utf-8") as f:
                json.dump(frames, f, ensure_ascii=False, indent=2)
        except OSError as e:
            logger.warning(f"Could not write cache {cache_file}: {e}")
        logger.info(f"Generated synthetic match {match_id} ({len(frames)} moments).")
        return frames


loader = SyntheticMatchLoader()
