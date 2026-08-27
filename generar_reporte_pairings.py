"""
Genera el reporte de pairings en formato "bloque" (uno por Pairing ID),
replicando el modelo de plantilla: encabezado repetido por bloque +
filas de vuelos de ese pairing + filas en blanco de separación.

Reglas de filtrado aplicadas (confirmadas con el usuario):
  1. Solo se consideran vuelos (piernas) cuyo día de la semana
     (según `inicio_vuelo_lt`) sea lunes, martes, miércoles o jueves,
     y cuya fecha caiga en septiembre de 2026.
  2. Si UNA sola pierna de un pairing (trip) cae fuera de ese rango
     (otro día de la semana u otro mes), se descarta el pairing COMPLETO.
  3. Se descarta el pairing completo si la fecha de presentación
     (`presentacion_duty_date_lt`) de cualquiera de sus piernas cae
     en domingo (los instructores no trabajan los domingos).
  4. Se descarta el pairing si el rango entre su `dia_duty` mínimo y
     máximo es mayor a 2 (máx. 3 días de duty seguidos; se excluyen
     combinaciones como 1-4, 1-5 o 2-5).
  5. Por ahora solo se incluyen pairings cuyas piernas sean la ruta
     LIM-MIA / MIA-LIM (round-trip de 3 días). Otras rutas (LIM-SCL,
     LIM-JFK, etc.) se excluyen -> ver ALLOWED_ROUTES.

Uso:
    python generar_reporte_pairings.py

Ajusta las rutas SRC / OUT y BLANK_ROWS según necesites.
"""

import re
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# ----------------------------------------------------------------------
# Configuración
# ----------------------------------------------------------------------
SRC = r"Panel pairing_Base reporte pairing_Tabla (6) (1).csv"
OUT = r"Reporte_pairings_bloques_Lun-Jue_Sep2026_LIM-MIA.xlsx"
BLANK_ROWS = 2  # filas en blanco entre un bloque (pairing) y el siguiente

TITULO_1 = "Comenzar asignando vuelos los Jueves y Viernes (porque el SAB es DO)"
TITULO_2 = "LCK de ida (porque va OP) y de retorno DGAC o RECA"

MESES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7,
    "ago": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dic": 12,
}
WD_ES = {
    "Monday": "lunes", "Tuesday": "martes", "Wednesday": "miércoles",
    "Thursday": "jueves", "Friday": "viernes", "Saturday": "sábado",
    "Sunday": "domingo",
}
DIAS_OK = {"Monday", "Tuesday", "Wednesday", "Thursday"}
ALLOWED_ROUTES = {("LIM", "MIA"), ("MIA", "LIM")}  # por ahora, solo este round-trip de 3 días

# Encabezados finales, hasta la columna N (B..N en la plantilla)
HEADERS = ["Pairing ID", "FECHA REAL", "MES", "Day of Week", "Flight No",
           "Dep Stn", "Arr Stn", "STD", "STA", "DAY", "AC Type", "HBT",
           "DIA_DUTY"]


def parse_fecha(s):
    """Convierte fechas tipo '31 ago 2026' / '1 sept 2026' a Timestamp."""
    if pd.isna(s):
        return pd.NaT
    s = str(s).strip().lower()
    m = re.match(r"(\d+)\s+([a-z]+)\s+(\d+)", s)
    if not m:
        return pd.NaT
    d, mo, y = m.groups()
    if mo not in MESES:
        return pd.NaT
    return pd.Timestamp(year=int(y), month=MESES[mo], day=int(d))


def cargar_y_filtrar(csv_path: str) -> pd.DataFrame:
    df = pd.read_csv(csv_path)

    df["inicio_vuelo_lt_dt"] = df["inicio_vuelo_lt"].apply(parse_fecha)
    df["presentacion_duty_date_lt_dt"] = df["presentacion_duty_date_lt"].apply(parse_fecha)
    df["wd_vuelo"] = df["inicio_vuelo_lt_dt"].dt.day_name()
    df["wd_pres"] = df["presentacion_duty_date_lt_dt"].dt.day_name()
    df["dia_semana"] = df["wd_vuelo"].map(WD_ES)

    # Validez a nivel de pierna (leg)
    df["leg_dia_ok"] = df["wd_vuelo"].isin(DIAS_OK)
    df["leg_mes_ok"] = (df["inicio_vuelo_lt_dt"].dt.month == 9) & \
                        (df["inicio_vuelo_lt_dt"].dt.year == 2026)
    df["leg_pres_ok"] = df["wd_pres"] != "Sunday"
    df["leg_ruta_ok"] = list(zip(df["dep"], df["arr"]))
    df["leg_ruta_ok"] = df["leg_ruta_ok"].isin(ALLOWED_ROUTES)

    # Validez a nivel de trip completo
    g = df.groupby("trip")
    trip_dia_ok = g["leg_dia_ok"].transform("all")
    trip_mes_ok = g["leg_mes_ok"].transform("all")
    trip_pres_ok = g["leg_pres_ok"].transform("all")
    trip_ruta_ok = g["leg_ruta_ok"].transform("all")
    dd_span = g["dia_duty"].transform(lambda s: s.max() - s.min())
    trip_span_ok = dd_span <= 2

    df["trip_valido"] = trip_dia_ok & trip_mes_ok & trip_pres_ok & trip_ruta_ok & trip_span_ok

    validos = df[df["trip_valido"]].copy()
    validos["fecha_real_fmt"] = validos["inicio_vuelo_lt_dt"].dt.strftime("%d/%m/%Y")

    validos = validos.rename(columns={
        "trip": "Pairing ID",
        "fecha_real_fmt": "FECHA REAL",
        "mes": "MES",
        "dia_semana": "Day of Week",
        "vuelo": "Flight No",
        "dep": "Dep Stn",
        "arr": "Arr Stn",
        "std_hb": "STD",
        "sta_hb": "STA",
        "pax": "DAY",
        "sub_fleet": "AC Type",
        "hbt": "HBT",
        "dia_duty": "DIA_DUTY",
    })

    return validos.sort_values(["Pairing ID", "DIA_DUTY"])[HEADERS]


def construir_reporte_bloques(validos: pd.DataFrame, out_path: str, blank_rows: int = 2):
    wb = Workbook()
    ws = wb.active
    ws.title = "Pairings"

    bold = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="FFFF00")   # amarillo -> MES
    dutyid_fill = PatternFill("solid", fgColor="FFC000")   # naranja -> DIA_DUTY
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center")

    n_cols = len(HEADERS)  # B..N

    # Título / notas al inicio (fila 1 y 2), a partir de la columna B
    ws.cell(row=1, column=2, value=TITULO_1).font = bold
    ws.cell(row=2, column=2, value=TITULO_2).font = bold

    fila = 4  # deja una fila en blanco después del título

    for pairing_id, grupo in validos.groupby("Pairing ID", sort=False):
        # --- fila de encabezado del bloque ---
        for j, h in enumerate(HEADERS):
            c = ws.cell(row=fila, column=2 + j, value=h)
            c.font = bold
            c.border = border
            c.alignment = center
            if h == "MES":
                c.fill = header_fill
            if h == "DIA_DUTY":
                c.fill = dutyid_fill
        fila += 1

        # --- filas de datos (una por vuelo/pierna del pairing) ---
        for _, row in grupo.iterrows():
            for j, h in enumerate(HEADERS):
                c = ws.cell(row=fila, column=2 + j, value=row[h])
                c.border = border
                c.alignment = center
            fila += 1

        # --- separación entre bloques ---
        fila += blank_rows

    # Ancho de columnas
    anchos = [10, 12, 10, 12, 10, 9, 9, 10, 10, 6, 9, 9, 10]
    for j, w in enumerate(anchos):
        ws.column_dimensions[ws.cell(row=1, column=2 + j).column_letter].width = w

    ws.freeze_panes = "B4"
    wb.save(out_path)


if __name__ == "__main__":
    validos = cargar_y_filtrar(SRC)
    construir_reporte_bloques(validos, OUT, blank_rows=BLANK_ROWS)
    print(f"Pairings válidos: {validos['Pairing ID'].nunique()}")
    print(f"Filas de vuelo: {len(validos)}")
    print(f"Archivo generado: {OUT}")
