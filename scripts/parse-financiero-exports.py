import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd


LONG_CODE_RE = re.compile(r"^\d+(?:\.\d+){8,}$")
DIRECTION_RE = re.compile(r"(\d{4}\.\d+\.\d+)")


def normalize_header(value):
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip().upper()


def to_number(value):
    if value is None:
        return 0.0
    if isinstance(value, float):
        if math.isnan(value):
            return 0.0
        return float(value)
    if isinstance(value, int):
        return float(value)
    text = str(value).strip()
    if not text:
        return 0.0
    text = text.replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 0.0


def find_header_map(frame):
    for row_idx in range(min(25, len(frame.index))):
        headers = {}
        for col_idx in range(min(20, len(frame.columns))):
            normalized = normalize_header(frame.iat[row_idx, col_idx])
            if normalized == "PARTIDA":
                headers["partida"] = col_idx
            elif normalized == "NOMBRE":
                headers["nombre"] = col_idx
            elif normalized == "MONTO INICIAL":
                headers["initial"] = col_idx
            elif normalized == "CANTIDA REFORMA":
                headers["reforma"] = col_idx
            elif normalized == "MONTO CODIFICADO":
                headers["codificado"] = col_idx
            elif normalized == "MONTO CERTIFICADO":
                headers["certificado"] = col_idx
            elif normalized == "MONTO COMPROMETIDO":
                headers["comprometido"] = col_idx
            elif normalized == "MONTO DEVENGADO":
                headers["devengado"] = col_idx
            elif normalized == "MONTO EJECUTADO":
                headers["ejecutado"] = col_idx
            elif normalized == "PENDIENTE POR CERTIFICAR":
                headers["pendienteCertificar"] = col_idx
            elif normalized == "PENDIENTE POR DEVENGAR":
                headers["pendienteDevengar"] = col_idx
            elif normalized == "PENDIENTE POR EJECUTAR":
                headers["pendienteEjecutar"] = col_idx
        if {"partida", "initial", "reforma", "codificado", "certificado"} <= set(headers):
            headers["row"] = row_idx
            return headers
    raise RuntimeError("No se encontro la fila de encabezados esperada.")


def parse_file(path_str):
    path = Path(path_str)
    frame = pd.read_excel(path, header=None)
    header_map = find_header_map(frame)
    file_time = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    records = []
    for row_idx in range(header_map["row"] + 1, len(frame.index)):
        partida = str(frame.iat[row_idx, header_map["partida"]] or "").strip()
        if not LONG_CODE_RE.match(partida):
            continue
        direction_match = DIRECTION_RE.search(partida)
        if not direction_match:
            continue
        records.append(
            {
                "File": path.name,
                "FileTime": file_time,
                "Partida": partida,
                "DirectionCode": direction_match.group(1),
                "Initial": to_number(frame.iat[row_idx, header_map["initial"]]),
                "Reforma": to_number(frame.iat[row_idx, header_map["reforma"]]),
                "Codificado": to_number(frame.iat[row_idx, header_map["codificado"]]),
                "Certificado": to_number(frame.iat[row_idx, header_map["certificado"]]),
                "Comprometido": to_number(frame.iat[row_idx, header_map["comprometido"]]) if "comprometido" in header_map else 0.0,
                "Devengado": to_number(frame.iat[row_idx, header_map["devengado"]]) if "devengado" in header_map else 0.0,
                "Ejecutado": to_number(frame.iat[row_idx, header_map["ejecutado"]]) if "ejecutado" in header_map else 0.0,
                "PendienteCertificar": to_number(frame.iat[row_idx, header_map["pendienteCertificar"]]) if "pendienteCertificar" in header_map else 0.0,
                "PendienteDevengar": to_number(frame.iat[row_idx, header_map["pendienteDevengar"]]) if "pendienteDevengar" in header_map else 0.0,
                "PendienteEjecutar": to_number(frame.iat[row_idx, header_map["pendienteEjecutar"]]) if "pendienteEjecutar" in header_map else 0.0,
            }
        )
    return records


def main():
    files = sys.argv[1:]
    all_records = []
    for file_path in files:
        all_records.extend(parse_file(file_path))
    sys.stdout.write(json.dumps(all_records, ensure_ascii=False))


if __name__ == "__main__":
    main()
