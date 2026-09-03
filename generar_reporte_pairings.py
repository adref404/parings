"""
Genera el reporte de pairings en formato "bloque" (uno por Pairing ID),
replicando el modelo de plantilla: encabezado repetido por bloque +
filas de vuelos de ese pairing + filas en blanco de separación.

Reglas de filtrado (corregidas y validadas contra el reporte de
referencia "Pairings WB SEPTIEMBRE-2026 - Vuelos"):
  1. Solo se consideran vuelos (piernas) cuyo día de la semana (según
     `inicio_vuelo_lt`) sea de LUNES A VIERNES (se arranca asignando
     jueves/viernes porque el sábado es DO). El pairing "empieza" en
     septiembre 2026 si la pierna con el `dia_duty` más bajo cae en
     ese mes -> la última pierna puede pasarse a octubre (ej. trip 313:
     empieza martes 30-sep y termina jueves 1-oct).
  2. Si UNA sola pierna de un pairing (trip) cae en sábado o domingo,
     se descarta el pairing COMPLETO.
  3. Se descarta el pairing completo si la fecha de presentación
     (`presentacion_duty_date_lt`) de cualquiera de sus piernas cae
     en domingo (los instructores no trabajan los domingos).
  4. Los valores de `dia_duty` del pairing deben ser CONSECUTIVOS, sin
     huecos (ej. {1,2} o {2,3} válido; {2,4} inválido aunque el rango
     sea <=2) y el rango entre el mínimo y el máximo no puede superar 2
     (máx. 3 días de duty seguidos).
  5. Solo se incluyen pairings cuyas piernas sean las rutas de
     entrenamiento: LIM-MIA / MIA-LIM (round-trip de 3 días) o
     LIM-SCL / SCL-LIM (vuelta el mismo día) -> ver ALLOWED_ROUTES.

Notas de casos NO resueltos por reglas (quedan 3 diferencias contra
la referencia de 25 pairings, validado con
"Pairings WB SEPTIEMBRE-2026 - Vuelos (1).csv"):
  - Pairing 226: el CSV origen tiene una pierna de vuelta distinta
    (vuelo 2693, dia_duty 5, 25-sep) a la que aparece en la referencia
    (vuelo 2699, dia_duty 2, 23-sep) -> parece un ajuste manual hecho
    al armar el roster final (posible dato con error en el pairing
    generado), no algo derivable de estas reglas.
  - Pairing 20 (semana 1, 1-2 sep, 2480/2481): candidato válido por
    todas las reglas, pero la referencia solo usó el pairing 29
    (2-3 sep, 2480/2695) para esa semana. No hay una columna que
    distinga "el elegido" del "candidato alterno" generado por Carmen.
  - Pairing 230 (semana 4, 21-23 sep, vuelo 2694): candidato válido,
    pero la referencia usó el pairing 226 (mismas fechas, vuelo 2698)
    -> el número de vuelo de esa ruta cambió a partir de la semana 4
    y 230 quedó con el vuelo "viejo".
Estos 3 casos no se pueden resolver con reglas de fecha/ruta/duty; se
necesitaría un criterio adicional (ej. una lista explícita del vuelo
vigente por semana) para elegir automáticamente entre candidatos
duplicados.

Uso:
    python generar_reporte_pairings.py

Ajusta las rutas SRC / OUT y BLANK_ROWS según necesites.
"""

import re
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment

# ----------------------------------------------------------------------
# Configuración
# ----------------------------------------------------------------------
SRC = r"Panel pairing_Base reporte pairing_Tabla (4).csv" # r"Panel pairing_Base reporte pairing_Tabla (6) (1).csv"
OUT = r"Reporte_pairings_WB_OCT_2026.xlsx"
MES_OBJETIVO = 10    # mes del reporte (1-12) -> cambiar junto con SRC/OUT cada corrida
ANIO_OBJETIVO = 2026  # año del reporte
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
DIAS_OK = {"Monday", "Tuesday", "Wednesday", "Thursday", "Friday"}
ALLOWED_ROUTES = {
    ("LIM", "MIA"), ("MIA", "LIM"),   # round-trip de 3 días
    ("LIM", "SCL"), ("SCL", "LIM"),   # vuelta el mismo día
}
# LIM-SCL/SCL-LIM tiene un vuelo diario regular (2697/2696) que NO es el
# de entrenamiento; el de entrenamiento es específicamente 2413/2412
# (el único que solo opera jue/vie). Para MIA se permiten los vuelos que
# aparecen en el roster de referencia.
ALLOWED_FLIGHTS = {2480, 2481, 2695, 2694, 2698, 2699, 2413, 2412}

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


def cargar_y_filtrar(csv_path: str, mes_objetivo: int = MES_OBJETIVO,
                      anio_objetivo: int = ANIO_OBJETIVO) -> pd.DataFrame:
    df = pd.read_csv(csv_path)

    df["inicio_vuelo_lt_dt"] = df["inicio_vuelo_lt"].apply(parse_fecha)
    df["presentacion_duty_date_lt_dt"] = df["presentacion_duty_date_lt"].apply(parse_fecha)
    df["wd_vuelo"] = df["inicio_vuelo_lt_dt"].dt.day_name()
    df["wd_pres"] = df["presentacion_duty_date_lt_dt"].dt.day_name()
    df["dia_semana"] = df["wd_vuelo"].map(WD_ES)

    # Validez a nivel de pierna (leg)
    df["leg_dia_ok"] = df["wd_vuelo"].isin(DIAS_OK)
    df["leg_pres_ok"] = df["wd_pres"] != "Sunday"
    df["leg_ruta_ok"] = list(zip(df["dep"], df["arr"]))
    df["leg_ruta_ok"] = df["leg_ruta_ok"].isin(ALLOWED_ROUTES) & df["vuelo"].isin(ALLOWED_FLIGHTS)

    # Validez a nivel de trip completo
    g = df.groupby("trip")
    trip_dia_ok = g["leg_dia_ok"].transform("all")
    trip_pres_ok = g["leg_pres_ok"].transform("all")

    # El trip "empieza" en el mes/año objetivo si su pierna de menor dia_duty
    # cae en ese mes (la última pierna puede pasarse al mes siguiente).
    idx_primera_pierna = g["dia_duty"].idxmin()
    primeras_piernas = df.loc[idx_primera_pierna, ["trip", "inicio_vuelo_lt_dt"]]
    primeras_piernas["mes_ok"] = (primeras_piernas["inicio_vuelo_lt_dt"].dt.month == mes_objetivo) & \
                                  (primeras_piernas["inicio_vuelo_lt_dt"].dt.year == anio_objetivo)
    mapa_mes_ok = primeras_piernas.set_index("trip")["mes_ok"]
    trip_mes_ok = df["trip"].map(mapa_mes_ok)
    trip_ruta_ok = g["leg_ruta_ok"].transform("all")

    def dia_duty_contiguo_y_corto(s):
        vals = sorted(s.dropna().unique())
        if not vals:
            return False
        rango_ok = (vals[-1] - vals[0]) <= 2
        contiguo = all(b - a == 1 for a, b in zip(vals, vals[1:]))
        return rango_ok and contiguo

    trip_dia_duty_ok = g["dia_duty"].transform(lambda s: dia_duty_contiguo_y_corto(s))

    df["trip_valido"] = trip_dia_ok & trip_mes_ok & trip_pres_ok & trip_ruta_ok & trip_dia_duty_ok

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


def construir_reporte_bloques(validos: pd.DataFrame, out_path: str, blank_rows: int = 1):
    """
    Arma el bloque B..N (datos) + O..Z (fórmulas), replicando la
    estructura real de "Pairings WB SEPTIEMBRE-2026 - Vuelos": la
    columna Q usa 6 filas por pairing (arranca 1 fila ANTES que la fila
    de encabezado del bloque), y todo lo demás corre una fila/columna
    más a la izquierda de lo que había quedado en la v4:

      fila  pre_row      : Q = INPUT tipo de actividad (vacío, ej. "LCK B767")
      fila  header_row   : B..N = títulos · O = INPUT nombre instructor
                            · Q = "- DEP1-ARR1"
                            · R..Z = resumen del pairing (fórmulas)
      fila  leg1_row     : B..N = datos pierna 1 · Q = "- LA <vuelo1> (STD-STA hrs)"
      fila  leg2_row     : B..N = datos pierna 2 · O = nombre (repetido
                            por fórmula) · Q = actividad (repetida, = pre_row)
      fila  post_row_1   : (B..N vacío) · Q = "- DEP2-ARR2"
      fila  post_row_2   : (B..N vacío) · Q = "- LA <vuelo2> (STD-STA hrs)"

    P queda vacía (columna separadora). Lo único que el encargado
    escribe a mano es el nombre del instructor (O, header_row) y el
    tipo de actividad (Q, pre_row) -> ambos quedan vacíos por defecto.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = "Pairings"

    bold = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="FFFF00")   # amarillo -> MES
    dutyid_fill = PatternFill("solid", fgColor="FFC000")   # naranja -> DIA_DUTY / inputs
    resumen_fill = PatternFill("solid", fgColor="D9E1F2")  # celeste claro -> resumen
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center")

    COL_O, COL_P, COL_Q = 15, 16, 17          # instructor, (vacía), actividad+ruta+vuelo (6 filas)
    COL_RESUMEN_INI = 18                       # R: Pairing/Fecha/DíaSem/Vuelo/Ruta/Instructor/Actividad/Inicio/Fin
    RESUMEN_HEADERS = ["Pairing ID", "Fecha", "Día Sem", "Vuelo", "Ruta",
                        "Instructor", "Actividad", "Inicio", "Fin"]

    # Título / notas al inicio (fila 1 y 2), a partir de la columna B
    ws.cell(row=1, column=2, value=TITULO_1).font = bold
    ws.cell(row=2, column=2, value=TITULO_2).font = bold

    # Encabezado (una sola vez, arriba de todo) del bloque de resumen R..Z
    # Títulos del resumen en la fila 3. Filas 1-3 son estáticas (freeze_panes);
    # la fila 4 (pre_row del primer bloque) NO queda fija, se scrollea normal.
    for j, h in enumerate(RESUMEN_HEADERS):
        c = ws.cell(row=3, column=COL_RESUMEN_INI + j, value=h)
        c.font = bold
        c.fill = resumen_fill
        c.border = border
        c.alignment = center

    fila = 5  # header_row del primer bloque (su pre_row es la fila 4, de arriba)

    for pairing_id, grupo in validos.groupby("Pairing ID", sort=False):
        piernas = [row for _, row in grupo.iterrows()]
        if len(piernas) != 2:
            # el layout de 6 filas de Q asume exactamente 2 piernas (ida y vuelta);
            # si algún día hay pairings de 1 o 3 piernas, hay que revisar esto.
            raise ValueError(f"Pairing {pairing_id} tiene {len(piernas)} piernas, se esperaban 2")

        pre_row = fila - 1
        header_row = fila
        leg1_row = fila + 1
        leg2_row = fila + 2
        post_row_1 = fila + 3
        post_row_2 = fila + 4

        # --- fila de encabezado del bloque (B..N = títulos) ---
        for j, h in enumerate(HEADERS):
            c = ws.cell(row=header_row, column=2 + j, value=h)
            c.font = bold
            c.border = border
            c.alignment = center
            if h == "MES":
                c.fill = header_fill
            if h == "DIA_DUTY":
                c.fill = dutyid_fill

        # --- input: instructor (O, header_row) ---
        c_ins = ws.cell(row=header_row, column=COL_O)
        c_ins.fill = dutyid_fill
        c_ins.font = bold
        c_ins.comment = Comment("Escribir aquí el nombre del instructor", "generar_reporte_pairings.py")

        # P se deja vacía (columna separadora, igual que en la referencia)

        # --- input: tipo de actividad (Q, pre_row) -> VACÍO, se llena a mano ---
        c_act = ws.cell(row=pre_row, column=COL_Q)
        c_act.fill = dutyid_fill
        c_act.font = bold
        c_act.comment = Comment(
            "Tipo de actividad (escribir a mano, ej. LCK B767, Reentrenamiento B767, "
            "CHEQUEO BI ANUAL INST B767, etc.)",
            "generar_reporte_pairings.py",
        )

        # --- filas de datos de las 2 piernas ---
        for r, pierna in zip((leg1_row, leg2_row), piernas):
            for j, h in enumerate(HEADERS):
                c = ws.cell(row=r, column=2 + j, value=pierna[h])
                c.border = border
                c.alignment = center

        # nombre del instructor repetido (por fórmula) en la pierna 2
        ws.cell(row=leg2_row, column=COL_O, value=f'=IF(O{header_row}="","",O{header_row})')

        # --- columna Q: las 6 líneas (actividad / ruta+vuelo x2 piernas) ---
        # pre_row.Q ya quedó como INPUT vacío (arriba)
        ws.cell(row=header_row, column=COL_Q, value=f'="- "&G{leg1_row}&"-"&H{leg1_row}')
        ws.cell(row=leg1_row, column=COL_Q,
                value=(f'="- LA "&F{leg1_row}&" ("&LEFT(I{leg1_row},5)&"-"'
                       f'&LEFT(J{leg1_row},5)&" hrs)"'))
        # actividad repetida (por fórmula) en la pierna 2
        ws.cell(row=leg2_row, column=COL_Q, value=f'=IF(Q{pre_row}="","",Q{pre_row})')
        ws.cell(row=post_row_1, column=COL_Q, value=f'="- "&G{leg2_row}&"-"&H{leg2_row}')
        ws.cell(row=post_row_2, column=COL_Q,
                value=(f'="- LA "&F{leg2_row}&" ("&LEFT(I{leg2_row},5)&"-"'
                       f'&LEFT(J{leg2_row},5)&" hrs)"'))

        # --- resumen del pairing, en la fila de encabezado (R..Z) ---
        resumen_valores = [
            f"=B{leg1_row}",
            f"=C{leg1_row}",
            f"=E{leg1_row}",                                    # Día Sem (¡columna E, no D!)
            f'=F{leg1_row}&"/"&F{leg2_row}',
            f'=G{leg1_row}&"-"&H{leg1_row}&"-"&G{leg1_row}',
            f'=IF(O{header_row}="","",O{header_row})',
            f'=IF(Q{pre_row}="","",Q{pre_row})',
            f"=C{leg1_row}",
            f"=C{leg2_row}",
        ]
        for j, val in enumerate(resumen_valores):
            c = ws.cell(row=header_row, column=COL_RESUMEN_INI + j, value=val)
            c.border = border
            c.alignment = center

        # --- separación antes del pre_row del siguiente bloque ---
        fila = post_row_2 + 1 + blank_rows

    # Ancho de columnas B..N, O..Q, y R..Z
    anchos = [10, 12, 10, 12, 10, 9, 9, 10, 10, 6, 9, 9, 10]
    for j, w in enumerate(anchos):
        ws.column_dimensions[ws.cell(row=1, column=2 + j).column_letter].width = w
    for col, w in ((COL_O, 18), (COL_P, 3), (COL_Q, 30)):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = w
    for j, w in enumerate([10, 12, 10, 12, 16, 20, 26, 12, 12]):
        ws.column_dimensions[ws.cell(row=1, column=COL_RESUMEN_INI + j).column_letter].width = w

    ws.freeze_panes = "B4"  # fija filas 1-3; la fila 4 (pre_row del 1er bloque) scrollea normal
    wb.save(out_path)


if __name__ == "__main__":
    validos = cargar_y_filtrar(SRC)
    construir_reporte_bloques(validos, OUT, blank_rows=BLANK_ROWS)
    print(f"Pairings válidos: {validos['Pairing ID'].nunique()}")
    print(f"Filas de vuelo: {len(validos)}")
    print(f"Archivo generado: {OUT}")
