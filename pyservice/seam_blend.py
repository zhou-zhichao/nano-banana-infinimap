from __future__ import annotations

import base64
import binascii
import os
from typing import Any

import numpy as np

DEFAULT_SEAM_BAND_PX = 48
DEFAULT_MULTIBAND_NUM_BANDS = 5


def _parse_positive_env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    if value <= 0:
        return default
    return value


def get_seam_band_px() -> int:
    return _parse_positive_env_int("SEAM_BAND_PX", DEFAULT_SEAM_BAND_PX)


def get_multiband_num_bands() -> int:
    return _parse_positive_env_int("SEAM_MULTIBAND_NUM_BANDS", DEFAULT_MULTIBAND_NUM_BANDS)


def _import_cv2():
    try:
        import cv2  # type: ignore
    except Exception as exc:  # pragma: no cover - runtime dependency path
        raise RuntimeError("OpenCV is unavailable. Install opencv-contrib-python-headless.") from exc
    return cv2


def _decode_base64(value: str, field_name: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError(f"{field_name} must be valid base64") from exc


def _decode_png_rgba(cv2_mod: Any, png_bytes: bytes, field_name: str) -> np.ndarray:
    array = np.frombuffer(png_bytes, dtype=np.uint8)
    image = cv2_mod.imdecode(array, cv2_mod.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"{field_name} must be a valid PNG image")

    if image.ndim == 2:
        return cv2_mod.cvtColor(image, cv2_mod.COLOR_GRAY2BGRA)
    if image.ndim == 3 and image.shape[2] == 3:
        return cv2_mod.cvtColor(image, cv2_mod.COLOR_BGR2BGRA)
    if image.ndim == 3 and image.shape[2] == 4:
        return image
    raise ValueError(f"{field_name} has unsupported channels")


def _decode_png_mask(cv2_mod: Any, png_bytes: bytes, field_name: str) -> np.ndarray:
    array = np.frombuffer(png_bytes, dtype=np.uint8)
    image = cv2_mod.imdecode(array, cv2_mod.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"{field_name} must be a valid PNG image")

    if image.ndim == 2:
        mask = image
    elif image.ndim == 3 and image.shape[2] == 4:
        mask = image[:, :, 3]
    elif image.ndim == 3 and image.shape[2] == 3:
        mask = cv2_mod.cvtColor(image, cv2_mod.COLOR_BGR2GRAY)
    else:
        raise ValueError(f"{field_name} has unsupported channels")

    if mask.dtype != np.uint8:
        mask = np.clip(mask, 0, 255).astype(np.uint8)
    return mask


def _validate_geometry(
    base_rgba: np.ndarray,
    overlay_rgba: np.ndarray,
    overlay_mask: np.ndarray,
    tile_size: int,
    center_offset_tiles: int,
) -> tuple[int, int]:
    if tile_size <= 0:
        raise ValueError("tile_size must be positive")
    if center_offset_tiles < 0:
        raise ValueError("center_offset_tiles must be non-negative")

    base_h, base_w = base_rgba.shape[:2]
    overlay_h, overlay_w = overlay_rgba.shape[:2]
    mask_h, mask_w = overlay_mask.shape[:2]

    if base_h != overlay_h or base_w != overlay_w or base_h != mask_h or base_w != mask_w:
        raise ValueError("base/overlay/overlay_mask must share identical dimensions")

    expected_size = tile_size * (center_offset_tiles * 2 + 3)
    if base_w != expected_size or base_h != expected_size:
        raise ValueError(
            f"image dimensions must be {expected_size}x{expected_size} for tile_size={tile_size}, "
            f"center_offset_tiles={center_offset_tiles}"
        )

    center_left = center_offset_tiles * tile_size
    center_top = center_offset_tiles * tile_size
    center_right = center_left + tile_size * 3
    center_bottom = center_top + tile_size * 3
    if center_right > base_w or center_bottom > base_h:
        raise ValueError("center 3x3 region exceeds image bounds")

    return base_w, base_h


def _create_graphcut_seam_finder(cv2_mod: Any):
    constructors: list[Any] = []
    if hasattr(cv2_mod, "detail_GraphCutSeamFinder"):
        constructors.append(cv2_mod.detail_GraphCutSeamFinder)
    detail_ns = getattr(cv2_mod, "detail", None)
    if detail_ns is not None and hasattr(detail_ns, "GraphCutSeamFinder"):
        constructors.append(detail_ns.GraphCutSeamFinder)
    if not constructors:
        raise RuntimeError("GraphCutSeamFinder is unavailable in this OpenCV build")

    cost_candidates: list[Any] = ["COST_COLOR_GRAD"]
    cost_const = getattr(cv2_mod, "detail_GraphCutSeamFinderBase_COST_COLOR_GRAD", None)
    if cost_const is not None:
        cost_candidates.append(cost_const)
    if detail_ns is not None:
        detail_cost_const = getattr(detail_ns, "GraphCutSeamFinderBase_COST_COLOR_GRAD", None)
        if detail_cost_const is not None:
            cost_candidates.append(detail_cost_const)

    last_error: Exception | None = None
    for constructor in constructors:
        for cost in cost_candidates:
            try:
                return constructor(cost)
            except Exception as exc:  # pragma: no cover - runtime OpenCV API variance
                last_error = exc
                continue

    raise RuntimeError("Failed to initialize GraphCutSeamFinder") from last_error


def _create_multiband_blender(cv2_mod: Any, num_bands: int):
    constructors: list[Any] = []
    if hasattr(cv2_mod, "detail_MultiBandBlender"):
        constructors.append(cv2_mod.detail_MultiBandBlender)
    detail_ns = getattr(cv2_mod, "detail", None)
    if detail_ns is not None and hasattr(detail_ns, "MultiBandBlender"):
        constructors.append(detail_ns.MultiBandBlender)
    if not constructors:
        raise RuntimeError("MultiBandBlender is unavailable in this OpenCV build")

    last_error: Exception | None = None
    for constructor in constructors:
        # Common constructor variants across OpenCV wheels.
        for args in [tuple(), (False, int(num_bands))]:
            try:
                blender = constructor(*args)
                if hasattr(blender, "setNumBands"):
                    blender.setNumBands(int(num_bands))
                return blender
            except Exception as exc:  # pragma: no cover - runtime OpenCV API variance
                last_error = exc
                continue

    raise RuntimeError("Failed to initialize MultiBandBlender") from last_error


def _to_ndarray(image: Any) -> np.ndarray:
    if hasattr(image, "get"):
        return image.get()
    return np.asarray(image)


def _to_binary_mask(mask: Any) -> np.ndarray:
    mask_array = _to_ndarray(mask)
    if mask_array.ndim == 3:
        mask_array = mask_array[:, :, 0]
    return np.where(mask_array > 0, 255, 0).astype(np.uint8)


def _run_graphcut_seam_finder(
    seam_finder: Any,
    seam_images: list[np.ndarray],
    corners: list[tuple[int, int]],
    masks: list[np.ndarray],
) -> list[np.ndarray]:
    if hasattr(seam_finder, "find"):
        result = seam_finder.find(seam_images, corners, masks)
        if isinstance(result, (tuple, list)):
            if len(result) < len(masks):
                result = [*result, *masks[len(result) :]]
            return [_to_binary_mask(mask) for mask in result[: len(masks)]]
        return [_to_binary_mask(mask) for mask in masks]

    if hasattr(seam_finder, "feed"):
        seam_finder.feed(seam_images, corners, masks)
        return [_to_binary_mask(mask) for mask in masks]

    raise RuntimeError("GraphCutSeamFinder has neither find nor feed in this OpenCV build")


def _apply_center_lock(
    mask: np.ndarray,
    tile_size: int,
    center_offset_tiles: int,
    band_px: int,
) -> np.ndarray:
    output = mask.copy()
    center_left = center_offset_tiles * tile_size
    center_top = center_offset_tiles * tile_size
    center_right = center_left + tile_size * 3
    center_bottom = center_top + tile_size * 3

    max_band = max(1, (tile_size * 3) // 2 - 1)
    band = max(1, min(int(band_px), max_band))

    inner_left = center_left + band
    inner_top = center_top + band
    inner_right = center_right - band
    inner_bottom = center_bottom - band

    if inner_left < inner_right and inner_top < inner_bottom:
        output[inner_top:inner_bottom, inner_left:inner_right] = 0
    return output


def _encode_png(cv2_mod: Any, bgra: np.ndarray) -> bytes:
    ok, encoded = cv2_mod.imencode(".png", bgra)
    if not ok:
        raise RuntimeError("Failed to encode blended image as PNG")
    return encoded.tobytes()


def blend_seam_grid_png(
    base_png: bytes,
    overlay_png: bytes,
    overlay_mask_png: bytes,
    tile_size: int = 256,
    center_offset_tiles: int = 1,
) -> bytes:
    cv2_mod = _import_cv2()

    base_rgba = _decode_png_rgba(cv2_mod, base_png, "base_png_base64")
    overlay_rgba = _decode_png_rgba(cv2_mod, overlay_png, "overlay_png_base64")
    overlay_mask = _decode_png_mask(cv2_mod, overlay_mask_png, "overlay_mask_png_base64")
    width, height = _validate_geometry(base_rgba, overlay_rgba, overlay_mask, tile_size, center_offset_tiles)

    base_alpha = base_rgba[:, :, 3]
    overlay_alpha = overlay_rgba[:, :, 3]
    overlay_valid_mask = np.where((overlay_alpha > 0) & (overlay_mask > 0), 255, 0).astype(np.uint8)
    base_valid_mask = np.where(base_alpha > 0, 255, 0).astype(np.uint8)

    if int(overlay_valid_mask.max()) == 0:
        return _encode_png(cv2_mod, base_rgba)
    if int(base_valid_mask.max()) == 0:
        overlay_only = overlay_rgba.copy()
        overlay_only[:, :, 3] = overlay_valid_mask
        return _encode_png(cv2_mod, overlay_only)

    base_mask_locked = _apply_center_lock(base_valid_mask, tile_size, center_offset_tiles, get_seam_band_px())
    image_base = base_rgba[:, :, :3]
    image_overlay = overlay_rgba[:, :, :3]
    masks = [base_mask_locked.copy(), overlay_valid_mask.copy()]

    overlap = cv2_mod.bitwise_and(masks[0], masks[1])
    if int(overlap.max()) > 0:
        seam_finder = _create_graphcut_seam_finder(cv2_mod)
        seam_images = [image_base.astype(np.float32), image_overlay.astype(np.float32)]
        corners = [(0, 0), (0, 0)]
        masks = _run_graphcut_seam_finder(seam_finder, seam_images, corners, masks)

    blender = _create_multiband_blender(cv2_mod, get_multiband_num_bands())
    blender.prepare((0, 0, width, height))
    if int(masks[0].max()) > 0:
        blender.feed(image_base.astype(np.int16), masks[0], (0, 0))
    if int(masks[1].max()) > 0:
        blender.feed(image_overlay.astype(np.int16), masks[1], (0, 0))

    blended_image, blended_mask = blender.blend(None, None)
    blended_bgr = _to_ndarray(blended_image)
    blended_mask_u8 = _to_ndarray(blended_mask)

    if blended_bgr.ndim != 3 or blended_bgr.shape[2] < 3:
        raise RuntimeError("MultiBandBlender returned invalid image data")
    if blended_mask_u8.ndim == 3:
        blended_mask_u8 = blended_mask_u8[:, :, 0]

    blended_bgr_u8 = np.clip(blended_bgr[:, :, :3], 0, 255).astype(np.uint8)
    blended_mask_u8 = np.clip(blended_mask_u8, 0, 255).astype(np.uint8)
    alpha_union = np.maximum(np.maximum(base_valid_mask, overlay_valid_mask), blended_mask_u8)

    output_bgra = np.dstack((blended_bgr_u8, alpha_union))
    output_bgra[alpha_union == 0, :3] = 0
    return _encode_png(cv2_mod, output_bgra)


def blend_seam_grid_base64(
    base_png_base64: str,
    overlay_png_base64: str,
    overlay_mask_png_base64: str,
    tile_size: int = 256,
    center_offset_tiles: int = 1,
) -> bytes:
    base_png = _decode_base64(base_png_base64, "base_png_base64")
    overlay_png = _decode_base64(overlay_png_base64, "overlay_png_base64")
    overlay_mask_png = _decode_base64(overlay_mask_png_base64, "overlay_mask_png_base64")
    return blend_seam_grid_png(
        base_png=base_png,
        overlay_png=overlay_png,
        overlay_mask_png=overlay_mask_png,
        tile_size=tile_size,
        center_offset_tiles=center_offset_tiles,
    )
