"""find_restaurants tool — async generator yielding one mocked result at a time."""
from __future__ import annotations
import asyncio
import json
from pathlib import Path

DATA_FILE = Path(__file__).parent / "data" / "restaurants.json"
STREAM_DELAY_SECONDS = 1.2  # Pace card emission for the demo.


async def find_restaurants(min_rating: float, radius_miles: float):
    data = json.loads(DATA_FILE.read_text())
    filtered = [r for r in data if r["rating"] >= min_rating and r["distance_miles"] <= radius_miles]
    for r in filtered[:5]:
        await asyncio.sleep(STREAM_DELAY_SECONDS)
        yield r


def load_restaurant(restaurant_id: str) -> dict | None:
    data = json.loads(DATA_FILE.read_text())
    for r in data:
        if r["id"] == restaurant_id:
            return r
    return None
