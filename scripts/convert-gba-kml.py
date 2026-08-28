#!/usr/bin/env python3
"""Convert the official GBA ward KML into compact browser-ready GeoJSON."""

import json
import sys
import xml.etree.ElementTree as ET
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

    destination.write_text(
        json.dumps(
            {"type": "FeatureCollection", "features": features},
            ensure_ascii=False,
            separators=(",", ":"),
        )
    )
    print(f"Wrote {len(features)} official ward boundaries to {destination}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: convert-gba-kml.py INPUT.kml OUTPUT.geojson")
    convert(Path(sys.argv[1]), Path(sys.argv[2]))
