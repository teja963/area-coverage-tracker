#!/usr/bin/env python3
"""Convert the official GBA ward KML into compact browser-ready GeoJSON."""

import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from itertools import combinations
from pathlib import Path

NS = {"kml": "http://www.opengis.net/kml/2.2"}


def parse_ring(node: ET.Element | None) -> list[list[float]]:
    if node is None or not node.text:
        return []
    points = []
    for value in node.text.split():
        lng, lat, *_ = value.split(",")
        point = [round(float(lng), 6), round(float(lat), 6)]
        if not points or point != points[-1]:
            points.append(point)
    if points and points[0] != points[-1]:
        points.append(points[0])
    return points


def color_adjacent_features(features: list[dict]) -> int:
    """Assign different color indexes to wards sharing a boundary vertex."""
    owners: dict[tuple[float, float], set[int]] = defaultdict(set)
    adjacency = [set() for _ in features]

    for feature_index, feature in enumerate(features):
        geometry = feature["geometry"]
        polygons = (
            [geometry["coordinates"]]
            if geometry["type"] == "Polygon"
            else geometry["coordinates"]
        )
        for polygon in polygons:
            for lng, lat in polygon[0][:-1]:
                # Five decimal places joins source vertices within about one metre.
                owners[(round(lng, 5), round(lat, 5))].add(feature_index)

    for feature_indexes in owners.values():
        for first, second in combinations(feature_indexes, 2):
            adjacency[first].add(second)
            adjacency[second].add(first)

    colors: list[int | None] = [None] * len(features)
    remaining = set(range(len(features)))
    while remaining:
        feature_index = max(
            remaining,
            key=lambda index: (
                len({colors[item] for item in adjacency[index] if colors[item] is not None}),
                len(adjacency[index]),
                -index,
            ),
        )
        used = {colors[item] for item in adjacency[feature_index] if colors[item] is not None}
        color_index = next(index for index in range(len(features)) if index not in used)
        colors[feature_index] = color_index
        remaining.remove(feature_index)

    for feature, color_index in zip(features, colors, strict=True):
        feature["properties"]["color_index"] = color_index
    return max(color for color in colors if color is not None) + 1


def convert(source: Path, destination: Path) -> None:
    root = ET.parse(source).getroot()
    features = []

    for placemark in root.findall(".//kml:Placemark", NS):
        properties = {
            item.attrib["name"]: (item.text or "")
            for item in placemark.findall(".//kml:SimpleData", NS)
        }
        polygons = []
        for polygon in placemark.findall(".//kml:Polygon", NS):
            outer = parse_ring(
                polygon.find(
                    "./kml:outerBoundaryIs/kml:LinearRing/kml:coordinates",
                    NS,
                )
            )
            if len(outer) < 4:
                continue
            rings = [outer]
            rings.extend(
                ring
                for ring in (
                    parse_ring(node)
                    for node in polygon.findall(
                        "./kml:innerBoundaryIs/kml:LinearRing/kml:coordinates",
                        NS,
                    )
                )
                if len(ring) >= 4
            )
            polygons.append(rings)

        if not polygons:
            continue
        geometry = (
            {"type": "Polygon", "coordinates": polygons[0]}
            if len(polygons) == 1
            else {"type": "MultiPolygon", "coordinates": polygons}
        )
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "ward_id": properties.get("ward_id", ""),
                    "ward_name": properties.get("ward_name", ""),
                    "corporation": properties.get("Corporation", ""),
                    "assembly": properties.get("Assembly", ""),
                    "source": "GBA Final Wards, December 2025",
                },
                "geometry": geometry,
            }
        )

    color_count = color_adjacent_features(features)
    destination.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    print(
        f"Wrote {len(features)} official ward boundaries using "
        f"{color_count} adjacency-safe colors to {destination}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert-gba-kml.py INPUT.kml OUTPUT.geojson")
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
