#!/usr/bin/env python3
"""Create scale-aligned, square review crops from the reference and render."""

from pathlib import Path
from collections import deque
from math import atan2, cos, pi, sin
import json
import sys

skill_intake = Path.home() / ".codex" / "skills" / "img2threejs" / "forge" / "stage1_intake"
sys.path.insert(0, str(skill_intake))

from build_detail_inventory import read_png, write_png_rgb  # noqa: E402


def crop_and_resize(source: Path, output: Path, box: tuple[int, int, int, int], size: int) -> None:
    width, height, pixels = read_png(source)
    left, top, crop_width, crop_height = box
    result = []
    for y in range(size):
        source_y = min(height - 1, top + min(crop_height - 1, int(y * crop_height / size)))
        for x in range(size):
            source_x = min(width - 1, left + min(crop_width - 1, int(x * crop_width / size)))
            result.append(pixels[source_y * width + source_x][:3])
    write_png_rgb(output, size, size, result)
    print(f"{source} -> {output} ({left},{top},{crop_width},{crop_height})")


def object_box(source: Path, background: tuple[int, int, int]) -> tuple[int, int, int, int]:
    width, height, pixels = read_png(source)
    mask = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            red, green, blue, _alpha = pixels[y * width + x]
            delta = abs(red - background[0]) + abs(green - background[1]) + abs(blue - background[2])
            if delta > 12:
                mask[y * width + x] = 1

    best_points = []
    seen = bytearray(width * height)
    for start_y in range(height):
        for start_x in range(width):
            start = start_y * width + start_x
            if not mask[start] or seen[start]:
                continue
            queue = deque([start])
            seen[start] = 1
            points = []
            while queue:
                index = queue.popleft()
                points.append(index)
                x = index % width
                y = index // width
                for neighbor in (
                    index - 1 if x > 0 else -1,
                    index + 1 if x + 1 < width else -1,
                    index - width if y > 0 else -1,
                    index + width if y + 1 < height else -1,
                ):
                    if neighbor >= 0 and mask[neighbor] and not seen[neighbor]:
                        seen[neighbor] = 1
                        queue.append(neighbor)
            if len(points) > len(best_points):
                best_points = points
    if not best_points:
        raise ValueError(f"No object pixels found in {source}")
    xs = [index % width for index in best_points]
    ys = [index // width for index in best_points]
    center_x = (min(xs) + max(xs)) * 0.5
    center_y = (min(ys) + max(ys)) * 0.5
    span = max(max(xs) - min(xs), max(ys) - min(ys)) * 1.12
    left = max(0, int(center_x - span * 0.5))
    top = max(0, int(center_y - span * 0.5))
    size = min(int(span), width - left, height - top)
    return left, top, size, size


def isolate_main_object(
    source: Path,
    output: Path,
    background: tuple[int, int, int],
) -> None:
    width, height, pixels = read_png(source)
    mask = bytearray(width * height)
    for y in range(height):
        for x in range(width):
            red, green, blue, _alpha = pixels[y * width + x]
            delta = abs(red - background[0]) + abs(green - background[1]) + abs(blue - background[2])
            if delta > 12:
                mask[y * width + x] = 1

    seen = bytearray(width * height)
    best_points = []
    for start_y in range(height):
        for start_x in range(width):
            start = start_y * width + start_x
            if not mask[start] or seen[start]:
                continue
            queue = deque([start])
            seen[start] = 1
            points = []
            while queue:
                index = queue.popleft()
                points.append(index)
                x = index % width
                y = index // width
                for neighbor in (
                    index - 1 if x > 0 else -1,
                    index + 1 if x + 1 < width else -1,
                    index - width if y > 0 else -1,
                    index + width if y + 1 < height else -1,
                ):
                    if neighbor >= 0 and mask[neighbor] and not seen[neighbor]:
                        seen[neighbor] = 1
                        queue.append(neighbor)
            if len(points) > len(best_points):
                best_points = points

    keep = set(best_points)
    isolated = []
    for index, (red, green, blue, _alpha) in enumerate(pixels):
        isolated.append((red, green, blue) if index in keep else background)
    write_png_rgb(output, width, height, isolated)
    print(f"{source} -> {output} (largest component isolated)")


def trace_shore_profile(source: Path, output: Path, samples: int = 64) -> None:
    width, height, pixels = read_png(source)
    xs = []
    ys = []
    for y in range(height):
        for x in range(width):
            red, green, blue, _alpha = pixels[y * width + x]
            if abs(red - 243) + abs(green - 243) + abs(blue - 243) > 12:
                xs.append(x)
                ys.append(y)
    if not xs:
        raise ValueError("Cannot trace an empty shore profile")
    center_x = (min(xs) + max(xs)) * 0.5
    center_y = (min(ys) + max(ys)) * 0.5
    radii = [0.0] * samples
    for x, y in zip(xs, ys):
        dx = x - center_x
        dy = y - center_y
        radius = (dx * dx + dy * dy) ** 0.5
        angle = atan2(dy, dx) % (pi * 2)
        index = int(angle / (pi * 2) * samples) % samples
        radii[index] = max(radii[index], radius)
    for index, radius in enumerate(radii):
        if radius > 0:
            continue
        previous = radii[(index - 1) % samples]
        following = radii[(index + 1) % samples]
        radii[index] = max(previous, following)
    largest = max(radii)
    scale = 1.9 / largest
    points = []
    for index, radius in enumerate(radii):
        angle = (index + 0.5) / samples * pi * 2
        points.append([
            round(cos(angle) * radius * scale, 5),
            round(sin(angle) * radius * scale, 5),
        ])
    output.write_text(
        json.dumps({"samples": samples, "points": points}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"{source} -> {output} (traced shore)")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    size = 720
    reference_path = root / ".img2threejs-lighthouse" / "reference-top.png"
    width, height, pixels = read_png(reference_path)
    normalized = []
    for red, green, blue, _alpha in pixels:
        distance_a = abs(red - 40) + abs(green - 114) + abs(blue - 151)
        distance_b = abs(red - 0) + abs(green - 112) + abs(blue - 133)
        teal_water = red < 85 and green > 88 and blue > 105 and blue >= green - 12
        if min(distance_a, distance_b) < 42 or teal_water:
            normalized.append((243, 243, 243))
        else:
            normalized.append((red, green, blue))
    write_png_rgb(root / "material-reference-normalized.png", width, height, normalized)
    print(f"{reference_path} -> material-reference-normalized.png")

    normalized_reference = root / "material-reference-normalized.png"
    material_render = root / "model-flat-top.png"
    reference_isolated = root / "material-reference-isolated.png"
    render_isolated = root / "material-render-isolated.png"
    isolate_main_object(normalized_reference, reference_isolated, (243, 243, 243))
    isolate_main_object(material_render, render_isolated, (243, 243, 243))
    trace_shore_profile(
        reference_isolated,
        root / "src" / "island-shore-profile.json",
    )
    crop_and_resize(
        reference_isolated,
        root / "material-reference-aligned.png",
        object_box(reference_isolated, (243, 243, 243)),
        size,
    )
    crop_and_resize(
        render_isolated,
        root / "material-render-aligned.png",
        object_box(render_isolated, (243, 243, 243)),
        size,
    )


if __name__ == "__main__":
    main()
