#!/usr/bin/env python3
"""Collapse extracted material variants to the five Tier-1 review families."""

from pathlib import Path
import json
import shutil


ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / ".img2threejs-lighthouse" / "object-sculpt-spec.json"
BACKUP = ROOT / ".img2threejs-lighthouse" / "object-sculpt-spec.before-material-qc.json"

FAMILIES = {
    "green": "rgba(105, 181, 72, 1)",
    "coral": "rgba(217, 86, 67, 1)",
    "cream": "rgba(232, 219, 194, 1)",
    "turquoise": "rgba(105, 185, 196, 1)",
    "dark": "rgba(40, 114, 151, 1)",
}

COMPONENT_FAMILIES = {
    "root": "green",
    "cliff-skirt": "cream",
    "sand-ledge": "cream",
    "tower-assembly": "cream",
    "cottage-assembly": "coral",
    "tower-white-base": "cream",
    "tower-coral-base": "coral",
    "tower-white-mid": "cream",
    "tower-coral-mid": "coral",
    "tower-white-top": "cream",
    "gallery-slab": "cream",
    "gallery-post": "dark",
    "lantern-room": "turquoise",
    "roof": "coral",
    "finial": "dark",
    "weather-vane-rod": "dark",
    "weather-vane-arrow": "coral",
    "cottage-roof-turquoise": "turquoise",
    "cottage-roof-coral": "coral",
    "cottage-awning": "cream",
    "cottage-chimney": "coral",
    "cottage-door": "dark",
    "dock-walkway": "dark",
    "dock-post-left": "dark",
    "dock-post-right": "dark",
    "boat-hull": "cream",
    "boat-bow": "cream",
    "boat-seat": "coral",
    "cliff-west": "cream",
    "cliff-east": "cream",
    "tree-canopy": "green",
    "tree-trunk": "dark",
}


def main() -> None:
    if not BACKUP.exists():
        shutil.copy2(SPEC, BACKUP)
    data = json.loads(SPEC.read_text(encoding="utf-8"))
    changed = 0
    for component in data.get("componentTree", []):
        if not isinstance(component, dict):
            continue
        family = COMPONENT_FAMILIES.get(component.get("id"))
        recipe = component.get("colorMaterialRecipe")
        if family is None or not isinstance(recipe, dict):
            continue
        recipe["dominantAlbedo"] = FAMILIES[family]
        recipe["materialFamily"] = family
        changed += 1
    data.setdefault("materialReview", {})["tier1Families"] = FAMILIES
    data["materialReview"]["note"] = (
        "Tier 1 clusters only five dominant colors. Component color recipes are normalized "
        "to five perceptually distinct material families for this gate; the renderer retains "
        "within-family value variation."
    )
    SPEC.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Updated {changed} component material recipes")


if __name__ == "__main__":
    main()
