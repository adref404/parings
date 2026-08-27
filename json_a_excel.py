"""
Convierte el JSON de perfilamiento de BigQuery
(carmen_gold_crew_pairing_carmen_system_profile_*.json) en un Excel
con una tabla por sección, SIN modificar el JSON original: se crea
un archivo .xlsx nuevo con la misma información.

Estructura de entrada esperada: una lista de objetos
    {"section": "...", "row_number": "...", "payload": "<json string>"}

Secciones detectadas en este archivo y cómo se tratan:
  - dataset_summary     -> hoja "dataset_summary" (1 fila)
  - objects_inventory   -> hoja "objects_inventory" (incluye el DDL completo)
  - columns_dictionary  -> hoja "columns_dictionary" (1 fila por columna)
  - column_profile      -> hoja "column_profile" (estadísticas por columna;
                            el campo anidado "top_values" se separa a su
                            propia hoja "top_values")
  - table_quality       -> hoja "table_quality" (1 fila)
  - sample_data         -> hoja "sample_data" (el "row_json" de cada
                            muestra se expande en columnas reales de la
                            tabla original)

Uso:
    python json_a_excel.py
"""

import json
import pandas as pd

SRC = r"carmen_gold_crew_pairing_carmen_system_profile_2026-08-23.json"
OUT = r"carmen_gold_crew_pairing_carmen_system_profile_2026-08-23.xlsx"


def flatten(value):
    """Convierte listas/dicts anidados a texto JSON para que quepan en una celda."""
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    return value


def cargar_registros(path: str):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    registros = {}
    for item in data:
        seccion = item["section"]
        payload = json.loads(item["payload"])
        registros.setdefault(seccion, []).append(payload)
    return registros


def construir_hojas(registros: dict) -> dict:
    """Devuelve {nombre_hoja: DataFrame} listo para exportar."""
    hojas = {}

    # --- Secciones "planas": una fila por payload, tal cual ---
    for seccion in ("dataset_summary", "objects_inventory", "columns_dictionary", "table_quality"):
        if seccion in registros:
            filas = [{k: flatten(v) for k, v in r.items()} for r in registros[seccion]]
            hojas[seccion] = pd.DataFrame(filas)

    # --- column_profile: separar "top_values" a su propia hoja ---
    if "column_profile" in registros:
        perfil_filas = []
        top_values_filas = []
        for r in registros["column_profile"]:
            r = dict(r)  # copia
            top_values = r.pop("top_values", None) or []
            for rank, tv in enumerate(top_values, start=1):
                top_values_filas.append({
                    "table_name": r.get("table_name"),
                    "column_name": r.get("column_name"),
                    "rank": rank,
                    **tv,
                })
            r["top_values_count"] = len(top_values)
            perfil_filas.append({k: flatten(v) for k, v in r.items()})
        hojas["column_profile"] = pd.DataFrame(perfil_filas)
        if top_values_filas:
            hojas["top_values"] = pd.DataFrame(top_values_filas)

    # --- sample_data: expandir row_json en columnas reales de la tabla ---
    if "sample_data" in registros:
        filas = []
        for r in registros["sample_data"]:
            fila_real = json.loads(r["row_json"])
            fila = {
                "sample_row_number": r.get("sample_row_number"),
                "sample_method": r.get("sample_method"),
                "table_name": r.get("table_name"),
                **{k: flatten(v) for k, v in fila_real.items()},
            }
            filas.append(fila)
        hojas["sample_data"] = pd.DataFrame(filas)

    return hojas


def guardar_excel(hojas: dict, out_path: str):
    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        for nombre, df in hojas.items():
            df.to_excel(writer, sheet_name=nombre[:31], index=False)
            ws = writer.sheets[nombre[:31]]
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions


if __name__ == "__main__":
    registros = cargar_registros(SRC)
    hojas = construir_hojas(registros)
    guardar_excel(hojas, OUT)
    for nombre, df in hojas.items():
        print(f"{nombre}: {len(df)} filas x {len(df.columns)} columnas")
    print(f"Archivo generado: {OUT}")
