#!/usr/bin/env python3
"""Build route data for all NJ Transit bus routes plus Princeton transit routes.

Outputs:
- data/manifest.json (route index + source metadata)
- data/routes/*.json (per-route geometry + stops)
- data/schedules/*.json (optional per-route stop schedules in external mode)

Official data sources:
- NJ Transit GTFS: https://www.njtransit.com/bus_data.zip
- Princeton/TripShot GTFS: https://princeton.tripshot.com/v1/gtfs.zip
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import math
import pathlib
import re
import shutil
import urllib.request
import zipfile
from collections import defaultdict

DAY_KEYS = (
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
)

FEEDS = (
    {
        "id": "njt",
        "label": "NJ Transit",
        "description": "Official NJ Transit bus routes",
        "gtfs_url": "https://www.njtransit.com/bus_data.zip",
        "zip_path": "data/bus_data.zip",
    },
    {
        "id": "princeton",
        "label": "Princeton Transit",
        "description": "TigerTransit, Princeton Loop, Weekend Shopper, and related Princeton shuttles",
        "gtfs_url": "https://princeton.tripshot.com/v1/gtfs.zip",
        "zip_path": "data/princeton_gtfs.zip",
    },
)


def iter_csv(zf: zipfile.ZipFile, member_name: str):
    with zf.open(member_name) as fh:
        reader = csv.DictReader((line.decode("utf-8-sig") for line in fh))
        for row in reader:
            yield row


def has_member(zf: zipfile.ZipFile, member_name: str) -> bool:
    try:
        zf.getinfo(member_name)
        return True
    except KeyError:
        return False


def parse_gtfs_date(value: str) -> dt.date:
    return dt.datetime.strptime(value, "%Y%m%d").date()


def parse_time_to_seconds(value: str) -> int:
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds)


def normalize_gtfs_time(value: str) -> str | None:
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 3:
        return None
    try:
        hours = int(parts[0])
        minutes = int(parts[1])
        seconds = int(parts[2])
    except ValueError:
        return None
    if hours < 0 or minutes < 0 or minutes > 59 or seconds < 0 or seconds > 59:
        return None
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def normalize_trip_headsign(raw: str, short_name: str, route_id: str) -> str:
    headsign = normalize_whitespace(raw)
    if not headsign:
        return ""

    prefixes = [normalize_whitespace(short_name), normalize_whitespace(route_id)]
    for prefix in prefixes:
        if not prefix:
            continue
        if not headsign.lower().startswith(prefix.lower() + " "):
            continue

        trimmed = headsign[len(prefix) :].strip(" -")
        if trimmed:
            return trimmed

    return headsign


def build_direction_key(direction_id: str, headsign: str) -> str:
    direction_value = normalize_whitespace(direction_id)
    if direction_value:
        safe_direction = re.sub(r"[^A-Za-z0-9_-]+", "_", direction_value).strip("_")
        return f"dir_{safe_direction or '0'}"

    if headsign:
        digest = hashlib.md5(headsign.lower().encode("utf-8")).hexdigest()[:10]
        return f"hs_{digest}"

    return "dir_default"


def fallback_direction_label(direction_id: str | None) -> str:
    if direction_id:
        return f"Direction {direction_id}"
    return "Direction"


def direction_sort_key(direction_id: str | None, label: str, direction_key: str) -> tuple[int, int, str, str]:
    if direction_id is not None:
        if direction_id.isdigit():
            return (0, int(direction_id), label.lower(), direction_key)
        return (0, 10_000, direction_id.lower(), direction_key)
    return (1, 10_000, label.lower(), direction_key)


def normalize_color(raw: str) -> str | None:
    value = (raw or "").strip().lstrip("#")
    if len(value) != 6:
        return None
    if not re.fullmatch(r"[0-9a-fA-F]{6}", value):
        return None
    if value.lower() == "000000":
        return None
    return f"#{value.lower()}"


def hsl_to_hex(h: float, s: float, l: float) -> str:
    c = (1 - abs(2 * l - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = l - c / 2

    if h < 60:
        rp, gp, bp = c, x, 0
    elif h < 120:
        rp, gp, bp = x, c, 0
    elif h < 180:
        rp, gp, bp = 0, c, x
    elif h < 240:
        rp, gp, bp = 0, x, c
    elif h < 300:
        rp, gp, bp = x, 0, c
    else:
        rp, gp, bp = c, 0, x

    r = round((rp + m) * 255)
    g = round((gp + m) * 255)
    b = round((bp + m) * 255)
    return f"#{r:02x}{g:02x}{b:02x}"


def stable_route_color(seed: str) -> str:
    digest = hashlib.md5(seed.encode("utf-8")).hexdigest()
    hue = int(digest[:4], 16) % 360
    return hsl_to_hex(hue, 0.68, 0.46)


def choose_representative_date(
    date_trip_count: dict[dt.date, int], weekday_index: int, today: dt.date
) -> dt.date | None:
    candidates: list[tuple[dt.date, int]] = [
        (service_date, trip_count)
        for service_date, trip_count in date_trip_count.items()
        if service_date.weekday() == weekday_index
    ]
    if not candidates:
        return None

    def ranking(item: tuple[dt.date, int]) -> tuple[int, int, dt.date]:
        service_date, trip_count = item
        if service_date >= today:
            distance_rank = (service_date - today).days
        else:
            distance_rank = 100_000 + (today - service_date).days
        return (-trip_count, distance_rank, service_date)

    return sorted(candidates, key=ranking)[0][0]


def download_gtfs(url: str, destination: pathlib.Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url) as response, destination.open("wb") as out_file:
        out_file.write(response.read())


def collect_service_dates(
    zf: zipfile.ZipFile,
    relevant_service_ids: set[str],
) -> dict[str, set[dt.date]]:
    service_dates: dict[str, set[dt.date]] = defaultdict(set)

    if has_member(zf, "calendar.txt"):
        for row in iter_csv(zf, "calendar.txt"):
            service_id = row["service_id"]
            if service_id not in relevant_service_ids:
                continue

            try:
                start_date = parse_gtfs_date(row["start_date"])
                end_date = parse_gtfs_date(row["end_date"])
            except (KeyError, ValueError):
                continue

            active_weekdays = {
                idx
                for idx, key in enumerate(DAY_KEYS)
                if str(row.get(key, "0")).strip() == "1"
            }
            if not active_weekdays:
                continue

            cursor = start_date
            while cursor <= end_date:
                if cursor.weekday() in active_weekdays:
                    service_dates[service_id].add(cursor)
                cursor += dt.timedelta(days=1)

    if has_member(zf, "calendar_dates.txt"):
        for row in iter_csv(zf, "calendar_dates.txt"):
            service_id = row["service_id"]
            if service_id not in relevant_service_ids:
                continue

            try:
                service_date = parse_gtfs_date(row["date"])
            except ValueError:
                continue

            exception_type = str(row.get("exception_type", "")).strip()
            if exception_type == "1":
                service_dates[service_id].add(service_date)
            elif exception_type == "2":
                service_dates[service_id].discard(service_date)

    return service_dates


def sanitize_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    cleaned = cleaned.strip("._-")
    return cleaned or "route"


def natural_sort_key(value: str):
    parts = re.split(r"(\d+)", value)
    key = []
    for part in parts:
        if part.isdigit():
            key.append((0, int(part)))
        else:
            key.append((1, part.lower()))
    return key


def dedupe_and_simplify_shape(
    sequence_points: list[tuple[int, float, float]], max_points: int
) -> list[list[float]]:
    ordered = sorted(sequence_points, key=lambda p: p[0])

    cleaned: list[list[float]] = []
    previous = None
    for _, lat, lon in ordered:
        current = [round(lat, 6), round(lon, 6)]
        if current == previous:
            continue
        cleaned.append(current)
        previous = current

    if len(cleaned) <= max_points:
        return cleaned

    step = max(1, math.ceil(len(cleaned) / max_points))
    simplified = [cleaned[0]]
    simplified.extend(cleaned[idx] for idx in range(step, len(cleaned) - 1, step))
    simplified.append(cleaned[-1])

    # In rare cases, simplification can still overshoot by 1 due to division.
    if len(simplified) > max_points:
        ratio = len(simplified) / max_points
        out = [simplified[0]]
        cursor = ratio
        while len(out) < max_points - 1:
            out.append(simplified[int(cursor)])
            cursor += ratio
        out.append(simplified[-1])
        simplified = out

    return simplified


def build_feed(
    feed_config: dict,
    gtfs_zip_path: pathlib.Path,
    routes_dir: pathlib.Path,
    schedules_dir: pathlib.Path | None,
    max_shape_points: int,
    schedule_mode: str,
    today: dt.date,
) -> tuple[dict, list[dict]]:
    agency_id = feed_config["id"]
    agency_label = feed_config["label"]
    gtfs_url = feed_config["gtfs_url"]

    with zipfile.ZipFile(gtfs_zip_path) as zf:
        route_meta: dict[str, dict] = {}

        for row in iter_csv(zf, "routes.txt"):
            route_id = row["route_id"].strip()
            short_name = row.get("route_short_name", "").strip() or route_id
            long_name = row.get("route_long_name", "").strip()
            route_desc = row.get("route_desc", "").strip()
            route_color = normalize_color(row.get("route_color", "")) or stable_route_color(
                f"{agency_id}:{short_name}:{route_id}"
            )

            route_meta[route_id] = {
                "routeId": route_id,
                "shortName": short_name,
                "longName": long_name,
                "routeDesc": route_desc,
                "label": f"{short_name} {long_name}".strip(),
                "color": route_color,
                "gtfsColor": normalize_color(row.get("route_color", "")) or "",
            }

        trip_to_route: dict[str, str] = {}
        trip_to_service: dict[str, str] = {}
        trip_to_direction_key: dict[str, str] = {}
        route_shape_ids: dict[str, set[str]] = defaultdict(set)
        route_shape_direction_keys: dict[str, dict[str, set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )
        route_trip_ids: dict[str, set[str]] = defaultdict(set)
        route_service_ids: dict[str, set[str]] = defaultdict(set)
        route_direction_service_ids: dict[str, dict[str, set[str]]] = defaultdict(
            lambda: defaultdict(set)
        )
        route_direction_id_by_key: dict[str, dict[str, str | None]] = defaultdict(dict)
        route_direction_label_votes: dict[str, dict[str, dict[str, int]]] = defaultdict(
            lambda: defaultdict(lambda: defaultdict(int))
        )

        for row in iter_csv(zf, "trips.txt"):
            route_id = row["route_id"].strip()
            if route_id not in route_meta:
                continue

            trip_id = row["trip_id"].strip()
            service_id = row["service_id"].strip()
            shape_id = row.get("shape_id", "").strip()
            direction_id = normalize_whitespace(row.get("direction_id", ""))
            trip_headsign = normalize_trip_headsign(
                row.get("trip_headsign", ""),
                route_meta[route_id]["shortName"],
                route_id,
            )
            direction_key = build_direction_key(direction_id, trip_headsign)

            trip_to_route[trip_id] = route_id
            trip_to_service[trip_id] = service_id
            trip_to_direction_key[trip_id] = direction_key
            route_trip_ids[route_id].add(trip_id)
            route_service_ids[route_id].add(service_id)
            route_direction_service_ids[route_id][direction_key].add(service_id)
            if shape_id:
                route_shape_ids[route_id].add(shape_id)
                route_shape_direction_keys[route_id][shape_id].add(direction_key)

            if direction_key not in route_direction_id_by_key[route_id]:
                route_direction_id_by_key[route_id][direction_key] = direction_id or None

            if trip_headsign:
                route_direction_label_votes[route_id][direction_key][trip_headsign] += 1

        route_direction_labels: dict[str, dict[str, str]] = {}
        route_direction_keys: dict[str, list[str]] = {}
        for route_id in route_meta:
            direction_keys = list(route_direction_service_ids[route_id].keys())
            if not direction_keys:
                direction_keys = ["dir_default"]
                route_direction_service_ids[route_id]["dir_default"] = set(route_service_ids[route_id])
                route_direction_id_by_key[route_id]["dir_default"] = None

            labels_for_route: dict[str, str] = {}
            for direction_key in direction_keys:
                vote_map = route_direction_label_votes[route_id].get(direction_key, {})
                if vote_map:
                    labels_for_route[direction_key] = sorted(
                        vote_map.items(),
                        key=lambda item: (-item[1], item[0].lower()),
                    )[0][0]
                    continue

                labels_for_route[direction_key] = fallback_direction_label(
                    route_direction_id_by_key[route_id].get(direction_key)
                )

            sorted_keys = sorted(
                direction_keys,
                key=lambda direction_key: direction_sort_key(
                    route_direction_id_by_key[route_id].get(direction_key),
                    labels_for_route[direction_key],
                    direction_key,
                ),
            )

            route_direction_keys[route_id] = sorted_keys
            route_direction_labels[route_id] = {
                direction_key: labels_for_route[direction_key] for direction_key in sorted_keys
            }

        relevant_service_ids: set[str] = set()
        for service_set in route_service_ids.values():
            relevant_service_ids.update(service_set)

        service_dates = collect_service_dates(zf, relevant_service_ids)

        route_date_trip_count: dict[str, dict[dt.date, int]] = defaultdict(
            lambda: defaultdict(int)
        )
        for trip_id, route_id in trip_to_route.items():
            service_id = trip_to_service[trip_id]
            for service_date in service_dates.get(service_id, set()):
                route_date_trip_count[route_id][service_date] += 1

        representative_dates: dict[str, dict[str, dt.date | None]] = defaultdict(dict)
        active_services_by_route_day_direction: dict[str, dict[str, dict[str, set[str]]]] = (
            defaultdict(lambda: defaultdict(dict))
        )

        for route_id in route_meta:
            for weekday_index, day_key in enumerate(DAY_KEYS):
                chosen_date = choose_representative_date(
                    route_date_trip_count[route_id], weekday_index, today
                )
                representative_dates[route_id][day_key] = chosen_date

            for direction_key in route_direction_keys[route_id]:
                for day_key in DAY_KEYS:
                    chosen_date = representative_dates[route_id][day_key]
                    if not chosen_date:
                        active_services_by_route_day_direction[route_id][direction_key][day_key] = set()
                        continue

                    active_services = {
                        service_id
                        for service_id in route_direction_service_ids[route_id][direction_key]
                        if chosen_date in service_dates.get(service_id, set())
                    }
                    active_services_by_route_day_direction[route_id][direction_key][day_key] = (
                        active_services
                    )

        route_stop_ids: dict[str, set[str]] = defaultdict(set)
        route_stop_schedule_by_service_direction: dict[
            str, dict[str, dict[str, dict[str, set[str]]]]
        ] = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(set))))

        for row in iter_csv(zf, "stop_times.txt"):
            trip_id = row["trip_id"].strip()
            route_id = trip_to_route.get(trip_id)
            if not route_id:
                continue

            stop_id = row["stop_id"].strip()
            route_stop_ids[route_id].add(stop_id)

            if schedule_mode == "none":
                continue

            raw_time = row.get("departure_time") or row.get("arrival_time") or ""
            normalized_time = normalize_gtfs_time(raw_time.strip())
            if not normalized_time:
                continue

            service_id = trip_to_service[trip_id]
            direction_key = trip_to_direction_key.get(trip_id, "dir_default")
            route_stop_schedule_by_service_direction[route_id][stop_id][direction_key][
                service_id
            ].add(normalized_time)

        selected_stop_ids: set[str] = set()
        for route_id in route_meta:
            selected_stop_ids.update(route_stop_ids[route_id])

        stop_info: dict[str, dict] = {}
        for row in iter_csv(zf, "stops.txt"):
            stop_id = row["stop_id"].strip()
            if stop_id not in selected_stop_ids:
                continue

            try:
                lat = float(row["stop_lat"])
                lon = float(row["stop_lon"])
            except (ValueError, TypeError):
                continue

            stop_info[stop_id] = {
                "stopId": stop_id,
                "name": row.get("stop_name", "").strip() or stop_id,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
            }

        route_shapes: dict[str, list[dict]] = defaultdict(list)
        shape_to_routes: dict[str, set[str]] = defaultdict(set)
        for route_id, shape_ids in route_shape_ids.items():
            for shape_id in shape_ids:
                shape_to_routes[shape_id].add(route_id)

        if has_member(zf, "shapes.txt") and shape_to_routes:
            current_shape_id: str | None = None
            current_points: list[tuple[int, float, float]] = []

            def flush_shape(shape_id: str | None, points: list[tuple[int, float, float]]):
                if not shape_id or not points:
                    return
                routes = shape_to_routes.get(shape_id)
                if not routes:
                    return
                geometry = dedupe_and_simplify_shape(points, max_shape_points)
                if len(geometry) < 2:
                    return
                for route_id in routes:
                    route_direction_key_order = route_direction_keys.get(route_id, [])
                    shape_direction_key_set = route_shape_direction_keys[route_id].get(shape_id, set())
                    shape_direction_keys = [
                        direction_key
                        for direction_key in route_direction_key_order
                        if direction_key in shape_direction_key_set
                    ]
                    shape_direction_keys.extend(
                        sorted(
                            direction_key
                            for direction_key in shape_direction_key_set
                            if direction_key not in route_direction_key_order
                        )
                    )
                    if not shape_direction_keys:
                        shape_direction_keys = route_direction_key_order or ["dir_default"]

                    entry = {
                        "shapeId": shape_id,
                        "directionKeys": shape_direction_keys,
                        "points": geometry,
                    }
                    route_shapes[route_id].append(entry)

            for row in iter_csv(zf, "shapes.txt"):
                shape_id = row["shape_id"].strip()
                if shape_id not in shape_to_routes:
                    continue

                if current_shape_id is None:
                    current_shape_id = shape_id

                if shape_id != current_shape_id:
                    flush_shape(current_shape_id, current_points)
                    current_shape_id = shape_id
                    current_points = []

                try:
                    sequence = int(row["shape_pt_sequence"])
                    lat = float(row["shape_pt_lat"])
                    lon = float(row["shape_pt_lon"])
                except (ValueError, TypeError):
                    continue

                current_points.append((sequence, lat, lon))

            flush_shape(current_shape_id, current_points)

        feed_updated_at = None
        if zf.infolist():
            newest_entry = max(zf.infolist(), key=lambda zi: zi.date_time)
            feed_updated_at = (
                dt.datetime(*newest_entry.date_time).replace(tzinfo=dt.timezone.utc).isoformat()
            )

    manifest_entries: list[dict] = []

    for route_id, meta in route_meta.items():
        route_key = f"{agency_id}:{route_id}"
        route_stops = []
        direction_keys = route_direction_keys.get(route_id, ["dir_default"])
        direction_labels = route_direction_labels.get(route_id) or {
            "dir_default": fallback_direction_label(None)
        }

        for stop_id in sorted(
            route_stop_ids[route_id],
            key=lambda sid: (
                stop_info.get(sid, {}).get("name", sid).lower(),
                sid,
            ),
        ):
            info = stop_info.get(stop_id)
            if not info:
                continue

            stop_payload = {**info}
            if schedule_mode == "inline":
                direction_schedule: dict[str, dict[str, list[str]]] = {}
                by_direction = route_stop_schedule_by_service_direction[route_id][stop_id]
                for direction_key in direction_keys:
                    by_service = by_direction.get(direction_key, {})
                    service_schedule_for_direction: dict[str, list[str]] = {}
                    for service_id, times in by_service.items():
                        if service_id not in route_service_ids[route_id]:
                            continue
                        sorted_times = sorted(times, key=parse_time_to_seconds)
                        if sorted_times:
                            service_schedule_for_direction[service_id] = sorted_times
                    if service_schedule_for_direction:
                        direction_schedule[direction_key] = service_schedule_for_direction

                stop_payload["serviceScheduleByDirection"] = direction_schedule

            route_stops.append(stop_payload)

        shapes = route_shapes.get(route_id, [])

        all_lats: list[float] = []
        all_lons: list[float] = []
        for shape in shapes:
            for lat, lon in shape["points"]:
                all_lats.append(float(lat))
                all_lons.append(float(lon))
        for stop in route_stops:
            all_lats.append(float(stop["lat"]))
            all_lons.append(float(stop["lon"]))

        bounds = None
        if all_lats and all_lons:
            bounds = [
                [round(min(all_lats), 6), round(min(all_lons), 6)],
                [round(max(all_lats), 6), round(max(all_lons), 6)],
            ]

        representative_dates_json = {
            day_key: (
                representative_dates[route_id][day_key].isoformat()
                if representative_dates[route_id][day_key]
                else None
            )
            for day_key in DAY_KEYS
        }

        filename = (
            f"{agency_id}_{sanitize_filename(meta['shortName'])}_{sanitize_filename(route_id)}.json"
        )
        route_file_rel = f"routes/{filename}"

        route_payload = {
            "key": route_key,
            "agencyId": agency_id,
            "agencyLabel": agency_label,
            "routeId": route_id,
            "shortName": meta["shortName"],
            "longName": meta["longName"],
            "routeDesc": meta["routeDesc"],
            "label": meta["label"],
            "color": meta["color"],
            "gtfsColor": meta["gtfsColor"],
            "tripCount": len(route_trip_ids[route_id]),
            "stopCount": len(route_stops),
            "shapeCount": len(shapes),
            "bounds": bounds,
            "shapes": shapes,
            "stops": route_stops,
            "directionLabels": direction_labels,
        }
        if schedule_mode == "inline":
            active_services_by_direction_json = {
                direction_key: {
                    day_key: sorted(
                        active_services_by_route_day_direction[route_id][direction_key][day_key]
                    )
                    for day_key in DAY_KEYS
                }
                for direction_key in direction_keys
            }
            route_payload["representativeDates"] = representative_dates_json
            route_payload["activeServicesByDayByDirection"] = active_services_by_direction_json
        elif schedule_mode == "external":
            if schedules_dir is None:
                raise RuntimeError("schedules_dir is required when schedule_mode='external'")

            day_schedules_by_stop_by_direction: dict[str, dict[str, dict[str, list[str]]]] = {}
            for stop in route_stops:
                stop_id = stop["stopId"]
                day_schedule_by_direction: dict[str, dict[str, list[str]]] = {}

                for direction_key in direction_keys:
                    day_schedule_for_direction: dict[str, list[str]] = {}
                    by_service = route_stop_schedule_by_service_direction[route_id][stop_id].get(
                        direction_key, {}
                    )
                    for day_key in DAY_KEYS:
                        merged: set[str] = set()
                        active_services = active_services_by_route_day_direction[route_id][
                            direction_key
                        ][day_key]
                        for service_id in active_services:
                            merged.update(by_service.get(service_id, set()))

                        sorted_times = sorted(merged, key=parse_time_to_seconds)
                        day_schedule_for_direction[day_key] = sorted_times

                    day_schedule_by_direction[direction_key] = day_schedule_for_direction

                day_schedules_by_stop_by_direction[stop_id] = day_schedule_by_direction

            schedule_filename = filename.replace(".json", "_schedule.json")
            schedule_file_rel = f"schedules/{schedule_filename}"
            schedule_payload = {
                "key": route_key,
                "agencyId": agency_id,
                "routeId": route_id,
                "representativeDates": representative_dates_json,
                "directionLabels": direction_labels,
                "daySchedulesByStopByDirection": day_schedules_by_stop_by_direction,
            }
            (schedules_dir / schedule_filename).write_text(
                json.dumps(schedule_payload, separators=(",", ":")),
                encoding="utf-8",
            )
            route_payload["scheduleFile"] = schedule_file_rel

        (routes_dir / filename).write_text(
            json.dumps(route_payload, separators=(",", ":")),
            encoding="utf-8",
        )

        search_parts = [
            meta["shortName"],
            meta["longName"],
            meta["routeDesc"],
            agency_label,
        ]
        if agency_id == "princeton":
            if meta["shortName"] in {"TPL", "TPLEXP"}:
                search_parts.append("Princeton Loop")
            elif meta["shortName"] == "WS":
                search_parts.append("Weekend Shopper")
            else:
                search_parts.append("TigerTransit Tiger Transit")

        long_bits = " ".join(part for part in search_parts if part)

        manifest_entry = {
            "key": route_key,
            "agencyId": agency_id,
            "agencyLabel": agency_label,
            "routeId": route_id,
            "shortName": meta["shortName"],
            "longName": meta["longName"],
            "routeDesc": meta["routeDesc"],
            "label": meta["label"],
            "color": meta["color"],
            "tripCount": len(route_trip_ids[route_id]),
            "stopCount": len(route_stops),
            "shapeCount": len(shapes),
            "bounds": bounds,
            "file": route_file_rel,
            "searchText": long_bits.lower(),
        }
        if schedule_mode == "external":
            manifest_entry["scheduleFile"] = route_payload.get("scheduleFile")

        manifest_entries.append(manifest_entry)

    source_meta = {
        "agencyId": agency_id,
        "agencyLabel": agency_label,
        "description": feed_config["description"],
        "gtfsUrl": gtfs_url,
        "gtfsZip": str(gtfs_zip_path),
        "feedUpdatedAt": feed_updated_at,
    }

    return source_meta, manifest_entries


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-download both GTFS feeds before building",
    )
    parser.add_argument(
        "--output-dir",
        default="data",
        help="Output directory for manifest and route files",
    )
    parser.add_argument(
        "--max-shape-points",
        type=int,
        default=260,
        help="Maximum points kept per shape after simplification",
    )
    parser.add_argument(
        "--inline-schedules",
        action="store_true",
        help="Embed stop schedules inside each route JSON (larger payload, faster per-stop popup rendering)",
    )
    parser.add_argument(
        "--no-stop-schedules",
        action="store_true",
        help="Omit stop-level schedule data entirely",
    )
    parser.add_argument(
        "--web-slim",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    args = parser.parse_args()

    if args.max_shape_points < 50:
        raise SystemExit("--max-shape-points must be >= 50")

    effective_max_shape_points = args.max_shape_points
    schedule_mode = "external"
    if args.inline_schedules:
        schedule_mode = "inline"
    if args.no_stop_schedules:
        schedule_mode = "none"
    if args.web_slim:
        effective_max_shape_points = min(effective_max_shape_points, 260)

    output_dir = pathlib.Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    routes_dir = output_dir / "routes"
    if routes_dir.exists():
        shutil.rmtree(routes_dir)
    routes_dir.mkdir(parents=True, exist_ok=True)

    schedules_dir: pathlib.Path | None = None
    schedules_path = output_dir / "schedules"
    if schedules_path.exists():
        shutil.rmtree(schedules_path)
    if schedule_mode == "external":
        schedules_path.mkdir(parents=True, exist_ok=True)
        schedules_dir = schedules_path

    today = dt.date.today()
    sources = []
    all_routes = []

    for feed in FEEDS:
        zip_path = pathlib.Path(feed["zip_path"])
        if args.refresh or not zip_path.exists():
            print(f"Downloading {feed['gtfs_url']} -> {zip_path}")
            download_gtfs(feed["gtfs_url"], zip_path)

        print(f"Building routes for {feed['label']} from {zip_path}")
        source_meta, routes = build_feed(
            feed,
            zip_path,
            routes_dir,
            schedules_dir,
            effective_max_shape_points,
            schedule_mode,
            today,
        )
        sources.append(source_meta)
        all_routes.extend(routes)

    all_routes.sort(key=lambda row: (row["agencyLabel"], natural_sort_key(row["shortName"])))

    manifest = {
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "timezone": "America/New_York",
        "agencies": [
            {
                "id": feed["id"],
                "label": feed["label"],
                "description": feed["description"],
            }
            for feed in FEEDS
        ],
        "sources": sources,
        "routeCount": len(all_routes),
        "routes": all_routes,
    }

    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"Wrote {manifest_path} with {manifest['routeCount']} routes")
    by_agency = defaultdict(int)
    for row in all_routes:
        by_agency[row["agencyId"]] += 1
    for agency_id, count in sorted(by_agency.items()):
        print(f"{agency_id}: {count} routes")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
