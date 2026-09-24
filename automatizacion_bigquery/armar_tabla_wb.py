"""
Arma la tabla WB filtrada/final a partir del export de BigQuery
(automatizacion_bigquery/tabla WB sub final.json), reutilizando SIN
MODIFICAR `cargar_y_filtrar` de ../generar_reporte_pairings.py (ya
validada: reglas lun-vie, presentación no domingo, dia_duty contiguo
<=2, rutas/vuelos permitidos, y el mecanismo _pk = trip+fecha_inicio_trip
que ya resuelve la reutilización de pairing_id).

`cargar_y_filtrar` espera un CSV con fechas en texto español
("31 ago 2026"), pero BigQuery las da en ISO ("2026-08-31"). Para
reutilizarla intacta, este script escribe un CSV temporal con el
formato exacto que ya espera (mismas columnas, fechas convertidas) y
deja que pd.read_csv infiera los tipos tal cual lo hacía con los CSV
viejos del panel -> evita reimplementar la lógica de filtrado aparte.

Pensado para copiarse celda por celda a un notebook de Colab.
"""

import sys
import json
import tempfile
import pandas as pd

sys.path.insert(0, r"C:\Users\Fernando\Documents\002.CHAMBA\LATAM\parings")
from generar_reporte_pairings import cargar_y_filtrar  # noqa: E402

SRC_JSON = "tabla WB sub final.json"
MES_OBJETIVO = 9
ANIO_OBJETIVO = 2026

MESES_ES = {1: "ene", 2: "feb", 3: "mar", 4: "abr", 5: "may", 6: "jun",
            7: "jul", 8: "ago", 9: "sept", 10: "oct", 11: "nov", 12: "dic"}


def iso_a_texto_es(s: str) -> str:
    """'2026-08-31' -> '31 ago 2026' (formato que espera parse_fecha)."""
    if not s or pd.isna(s):
        return s
    y, m, d = s.split("-")
    return f"{int(d)} {MESES_ES[int(m)]} {y}"


def json_a_csv_temporal(path_json: str) -> str:
    with open(path_json, encoding="utf-8") as f:
        data = json.load(f)
    df = pd.DataFrame(data)

    for col in ("inicio_vuelo_lt", "presentacion_duty_date_lt", "fecha_inicio_trip"):
        df[col] = df[col].apply(iso_a_texto_es)

    tmp = tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, encoding="utf-8")
    df.to_csv(tmp.name, index=False)
    return tmp.name


def armar_tabla_wb(path_json: str, mes: int, anio: int):
    csv_tmp = json_a_csv_temporal(path_json)
    validos = cargar_y_filtrar(csv_tmp, mes, anio)

    # cargar_y_filtrar (script original) da por hecho que un _pk con las
    # reglas OK ya viene con sus 2 piernas completas -> cierto siempre con
    # el CSV viejo del panel, pero con BigQuery encontré pairings de UNA
    # sola pierna (ej. trip 11: el QUALIFY de "última carga por mes" puede
    # quedarse con la ida de un pairing en el reload de un mes y perder la
    # vuelta si cae en el mes siguiente con otro reload). Se descartan acá
    # -> no es un round-trip real, no se puede armar el bloque.
    piernas_por_pk = validos.groupby("_pk").size()
    pk_incompletos = piernas_por_pk[piernas_por_pk < 2].index
    incompletos = validos[validos["_pk"].isin(pk_incompletos)].copy()
    validos = validos[~validos["_pk"].isin(pk_incompletos)].copy()

    return validos, incompletos


if __name__ == "__main__":
    validos, incompletos = armar_tabla_wb(SRC_JSON, MES_OBJETIVO, ANIO_OBJETIVO)
    print(f"Piernas válidas: {len(validos)}")
    print(f"Pairings válidos (_pk únicos, >=2 piernas): {validos['_pk'].nunique()}")
    print(f"Pairings descartados por venir incompletos (1 sola pierna): {incompletos['_pk'].nunique()}")
    validos.to_excel("Candidatos_WB_desde_BigQuery_v2.xlsx", index=False)
    print("Guardado: Candidatos_WB_desde_BigQuery_v2.xlsx")
