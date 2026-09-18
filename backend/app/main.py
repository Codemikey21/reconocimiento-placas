"""
main.py

API FastAPI para el reconocimiento de placas vehiculares.

Endpoints:
  GET  /health              -> chequeo de salud simple
  POST /recognize           -> recibe una imagen (multipart/form-data, campo "file")
                                y devuelve la(s) placa(s) detectada(s)

Para correr localmente (pruebas antes de subir a AWS):
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

Para producción en la instancia EC2, ver backend/README.md.
"""

import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.plate_pipeline import get_recognizer

app = FastAPI(
    title="API de Reconocimiento de Placas",
    description="Recibe una foto tomada desde la app móvil y devuelve la(s) placa(s) detectada(s).",
    version="1.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE_MB = 8


class PlateInfo(BaseModel):
    plate_text: str
    raw_text: str
    confidence: float
    method: str


class RecognizeResponse(BaseModel):
    success: bool
    plate_text: str | None = None
    raw_text: str | None = None
    confidence: float = 0.0
    method: str = "none"
    processing_time_ms: int = 0
    candidates: list[str] = []
    plates: list[PlateInfo] = []


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool


@app.on_event("startup")
def load_model_on_startup():
    get_recognizer()


@app.get("/health", response_model=HealthResponse)
def health():
    return HealthResponse(status="ok", model_loaded=True)


@app.post("/recognize", response_model=RecognizeResponse)
async def recognize(file: UploadFile = File(...)):
    if file.content_type not in ("image/jpeg", "image/jpg", "image/png"):
        raise HTTPException(
            status_code=400,
            detail=f"Tipo de archivo no soportado: {file.content_type}. Usa JPEG o PNG.",
        )

    image_bytes = await file.read()
    size_mb = len(image_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=413,
            detail=f"Imagen demasiado grande ({size_mb:.1f} MB). Máximo {MAX_FILE_SIZE_MB} MB.",
        )

    recognizer = get_recognizer()
    result = recognizer.recognize(image_bytes)

    return RecognizeResponse(
        success=result.success,
        plate_text=result.plate_text,
        raw_text=result.raw_text,
        confidence=result.confidence,
        method=result.method,
        processing_time_ms=result.processing_time_ms,
        candidates=result.candidates,
        plates=[
            PlateInfo(
                plate_text=p.plate_text,
                raw_text=p.raw_text,
                confidence=p.confidence,
                method=p.method,
            )
            for p in result.plates
        ],
    )
