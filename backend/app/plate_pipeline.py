"""
plate_pipeline.py

Pipeline de reconocimiento de placas vehiculares:
  1. Localización de la placa en la imagen.
     - Si existe un modelo YOLO propio entrenado (app/models/best.pt), se usa
       ese modelo (esta es la parte "modelo propio" de la actividad).
     - Si todavía no lo has entrenado/copiado, se usa un método de respaldo
       con OpenCV (bordes + contornos) para que puedas seguir probando el
       resto del sistema mientras entrenas el modelo.
  2. Lectura de caracteres sobre la región localizada usando EasyOCR
     (red neuronal ya entrenada, se usa solo para leer el texto, no para
     localizar la placa).
  3. Validación/limpieza del texto contra los formatos de placas colombianas
     (autos: 3 letras + 3 números; motos: 3 letras + 2 números + 1 letra).

Este módulo se carga una sola vez al iniciar el servidor y expone la función
`get_recognizer()` que usa main.py.
"""

import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import cv2
import easyocr
import numpy as np

# ---------------------------------------------------------------------------
# Ruta del modelo YOLO entrenado por ti (ver carpeta ml/ para entrenarlo).
# Cuando termines el entrenamiento en Colab, descarga "best.pt" y colócalo
# exactamente en esta ruta: backend/app/models/best.pt
# ---------------------------------------------------------------------------
YOLO_MODEL_PATH = Path(__file__).parent / "models" / "best.pt"
YOLO_CONFIDENCE_THRESHOLD = 0.35

# ---------------------------------------------------------------------------
# Patrones de placas colombianas
# ---------------------------------------------------------------------------
PLATE_PATTERNS = [
    re.compile(r"^[A-Z]{3}\d{3}$"),      # autos
    re.compile(r"^[A-Z]{3}\d{2}[A-Z]$"),  # motos
]

COMMON_OCR_FIXES = {
    "O": "0", "Q": "0", "D": "0",
    "I": "1", "L": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
}


@dataclass
class PlateResult:
    success: bool
    plate_text: Optional[str] = None
    raw_text: Optional[str] = None
    confidence: float = 0.0
    method: str = "none"  # "yolo" | "contours" | "full_frame" | "none"
    processing_time_ms: int = 0
    candidates: list = field(default_factory=list)


class PlateRecognizer:
    def __init__(self, languages=("en",), gpu=False):
        print("[plate_pipeline] Cargando modelo EasyOCR (puede tardar la primera vez)...")
        self.reader = easyocr.Reader(list(languages), gpu=gpu)
        print("[plate_pipeline] Modelo EasyOCR listo.")

        self.yolo_model = None
        if YOLO_MODEL_PATH.exists():
            try:
                from ultralytics import YOLO

                print(f"[plate_pipeline] Cargando modelo YOLO propio desde {YOLO_MODEL_PATH}...")
                self.yolo_model = YOLO(str(YOLO_MODEL_PATH))
                print("[plate_pipeline] Modelo YOLO cargado. Usando localización propia.")
            except Exception as exc:  # noqa: BLE001
                print(f"[plate_pipeline] No se pudo cargar el modelo YOLO ({exc}). "
                      f"Usando localización por contornos (OpenCV) como respaldo.")
        else:
            print(f"[plate_pipeline] No se encontró {YOLO_MODEL_PATH}. "
                  f"Usando localización por contornos (OpenCV) mientras entrenas tu modelo YOLO.")

    # -- localización con el modelo YOLO propio -----------------------------
    def _locate_with_yolo(self, image: np.ndarray, max_candidates: int = 5):
        results = self.yolo_model.predict(image, verbose=False)[0]
        candidates = []
        if results.boxes is None:
            return candidates

        boxes = sorted(
            results.boxes, key=lambda b: float(b.conf[0]), reverse=True
        )
        h_img, w_img = image.shape[:2]

        for box in boxes[:max_candidates]:
            conf = float(box.conf[0])
            if conf < YOLO_CONFIDENCE_THRESHOLD:
                continue
            x0, y0, x1, y1 = [int(v) for v in box.xyxy[0].tolist()]
            pad_x = int((x1 - x0) * 0.05)
            pad_y = int((y1 - y0) * 0.15)
            x0 = max(0, x0 - pad_x)
            y0 = max(0, y0 - pad_y)
            x1 = min(w_img, x1 + pad_x)
            y1 = min(h_img, y1 + pad_y)
            crop = image[y0:y1, x0:x1]
            if crop.size > 0:
                candidates.append((crop, conf))

        return candidates

    # -- localización de respaldo con OpenCV (contornos) ---------------------
    def _locate_with_contours(self, image: np.ndarray, max_candidates: int = 5):
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 11, 17, 17)
        edges = cv2.Canny(gray, 30, 200)

        contours, _ = cv2.findContours(edges.copy(), cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        contours = sorted(contours, key=cv2.contourArea, reverse=True)[:30]

        h_img, w_img = gray.shape[:2]
        candidates = []

        for c in contours:
            x, y, w, h = cv2.boundingRect(c)
            if h == 0:
                continue
            aspect_ratio = w / float(h)
            area_ratio = (w * h) / float(w_img * h_img)

            if 1.8 <= aspect_ratio <= 5.5 and 0.005 <= area_ratio <= 0.35:
                pad_x = int(w * 0.05)
                pad_y = int(h * 0.15)
                x0 = max(0, x - pad_x)
                y0 = max(0, y - pad_y)
                x1 = min(w_img, x + w + pad_x)
                y1 = min(h_img, y + h + pad_y)
                crop = image[y0:y1, x0:x1]
                if crop.size > 0:
                    candidates.append((crop, 0.5))  # confianza "neutra"
            if len(candidates) >= max_candidates:
                break

        return candidates

    # -- limpieza / validación -----------------------------------------------
    @staticmethod
    def _clean_text(raw: str) -> str:
        text = raw.upper()
        return re.sub(r"[^A-Z0-9]", "", text)

    @staticmethod
    def _matches_pattern(text: str) -> bool:
        return any(p.match(text) for p in PLATE_PATTERNS)

    def _best_match_from_text(self, raw: str) -> Optional[str]:
        cleaned = self._clean_text(raw)
        if len(cleaned) < 6:
            return None

        for i in range(len(cleaned) - 5):
            window = cleaned[i:i + 6]
            if self._matches_pattern(window):
                return window

        for i in range(len(cleaned) - 5):
            window = list(cleaned[i:i + 6])
            fixed = window[:]
            for pos in (3, 4):
                if fixed[pos] in COMMON_OCR_FIXES:
                    fixed[pos] = COMMON_OCR_FIXES[fixed[pos]]
            fixed_str = "".join(fixed)
            if self._matches_pattern(fixed_str):
                return fixed_str

        return None

    def _ocr_crop(self, crop: np.ndarray):
        results = self.reader.readtext(crop, detail=1, paragraph=False)
        if not results:
            return None, 0.0, ""
        raw_text = "".join([r[1] for r in results])
        avg_conf = float(np.mean([r[2] for r in results]))
        plate = self._best_match_from_text(raw_text)
        return plate, avg_conf, raw_text

    # -- API pública -----------------------------------------------------------
    def recognize(self, image_bytes: bytes) -> PlateResult:
        start = time.time()

        np_arr = np.frombuffer(image_bytes, np.uint8)
        image = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if image is None:
            return PlateResult(success=False, processing_time_ms=0, method="none")

        candidates_found = []

        if self.yolo_model is not None:
            for crop, det_conf in self._locate_with_yolo(image):
                plate, ocr_conf, raw = self._ocr_crop(crop)
                if plate:
                    # combinar confianza de detección + confianza de OCR
                    combined_conf = (det_conf + ocr_conf) / 2
                    candidates_found.append((plate, combined_conf, raw, "yolo"))
        else:
            for crop, _ in self._locate_with_contours(image):
                plate, ocr_conf, raw = self._ocr_crop(crop)
                if plate:
                    candidates_found.append((plate, ocr_conf, raw, "contours"))

        if not candidates_found:
            plate, conf, raw = self._ocr_crop(image)
            if plate:
                candidates_found.append((plate, conf, raw, "full_frame"))

        elapsed_ms = int((time.time() - start) * 1000)

        if not candidates_found:
            return PlateResult(success=False, processing_time_ms=elapsed_ms, method="none")

        candidates_found.sort(key=lambda t: t[1], reverse=True)
        best_plate, best_conf, best_raw, best_method = candidates_found[0]

        return PlateResult(
            success=True,
            plate_text=best_plate,
            raw_text=best_raw,
            confidence=round(best_conf, 4),
            method=best_method,
            processing_time_ms=elapsed_ms,
            candidates=[c[0] for c in candidates_found],
        )


recognizer: Optional[PlateRecognizer] = None


def get_recognizer() -> PlateRecognizer:
    global recognizer
    if recognizer is None:
        recognizer = PlateRecognizer()
    return recognizer