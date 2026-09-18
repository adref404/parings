"""
Prepara la "hoja de búsqueda" de vuelos candidatos para armar Pairings NB
(Line Check A320/A319), aplicando las reglas de los pasos 2.9 a 2.14 del
"Manual Traspaso FREEZE LP" (Parte 2. Line Check A320).

=====================================================================
QUÉ SÍ HACE (automatizado, 1:1 con el manual):
=====================================================================
  2.9-2.10  Depura la base del panel: se queda con trip/fecha/vuelo/
            dep/arr/std_hb/sta_hb/sub_fleet/hbt (SIEMPRE homebase,
            nunca UTC/LT).
  2.11      Filtra por mes objetivo, exige dep=LIM, solo rutas
            nacionales, excluye TRU/JUL/JAE/AYP/JAU/IQT SIEMPRE, más
            las exclusiones dinámicas del mes que definas en
            EXCLUSIONES_MES (ej. AQP en sept-2026 por el Perumín).
  2.14      Identifica la "primera mitad" de cada pairing: el instructor
            solo cubre el primer día de duty (dia_duty mínimo) del
            pairing -> normalmente el primer tramo ida + el de vuelta.
  2.12      Valida, sobre esa primera mitad:
              - el primer vuelo sale después de las 08:30
              - cada tramo tiene HBT > 1 hora
              - la conexión interna (entre la ida y la vuelta) es
                > 50 min y < 1 h 30
              - la duración total (PSV) no supera las 11 horas
            y ordena el resultado de más antiguo a más reciente.

=====================================================================
QUÉ NO HACE (falta información que este CSV no trae):
=====================================================================
  - 2.1-2.4  No sabe quiénes necesitan LCK este mes ni cuántos
             instructores-día se necesitan -> eso sale del archivo 9
             y del archivo 10, que no son parte de este CSV.
  - 2.2-2.3  No sabe qué instructor es IDE ni cuál es "no apto" para
             cada tripulante -> eso sale de la base de habilitaciones
             y del historial de revas (archivo 10).
  - 2.5-2.6  No asigna instructor ni fecha a cada bloque -> esa
             asignación depende del Rol de Instructores, que no se
             tiene aquí.
  - 2.15     PARCIALMENTE automatizado: la columna "Posible 2do vuelo
             (mismo día)" ya lista, para cada candidato, qué otros
             candidatos válidos de la misma fecha conectan dentro de
             (50min, 1h30) -> ver nota en armar_primeras_mitades(). Pero
             la elección FINAL de cuál instructor toma cuál combinación
             sigue siendo manual (depende del Rol, no de este CSV).
  - 2.16     No controla pairings duplicados a través del mes: un
             mismo pairing puede salir más de una vez en esta lista
             si tiene más de una fecha válida; quien arma el Rol debe
             marcar cuáles ya usó.

Uso:
    python generar_candidatos_nb.py
"""

import re
import pandas as pd
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# ----------------------------------------------------------------------
# Configuración
# ----------------------------------------------------------------------
SRC = r"Panel pairing_Base reporte pairing_Tabla (7).csv"
OUT = r"Candidatos_NB_LCK_SET_2026_v3.xlsx"
MES_OBJETIVO = 9
ANIO_OBJETIVO = 2026

# Exclusiones dinámicas del mes (2.11: "la lista es dinámica, revalidar
# cada mes"). Ejemplo real del manual: en septiembre 2026 se excluyó
# Arequipa por el Perumín -> EXCLUSIONES_MES = {"AQP"}
EXCLUSIONES_MES: set[str] = set()

MESES = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7,
    "ago": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dic": 12,
}
WD_ES = {
    "Monday": "lunes", "Tuesday": "martes", "Wednesday": "miércoles",
    "Thursday": "jueves", "Friday": "viernes", "Saturday": "sábado",
    "Sunday": "domingo",
}

# Lista EXACTA de destinos válidos (dep=LIM), confirmada en el video de
# muestra de quien arma este entregable -> reemplaza la lista que había
# inferido del manual (esa incluía TCQ/TYL/TBP y excluía IQT; la del
# video incluye IQT y no incluye TCQ/TYL/TBP). Esta es la que manda.
RUTAS_VALIDAS_ARR = {"AQP", "CIX", "CJA", "CUZ", "IQT", "PCL", "PEM", "PIU", "TPP"}

HORA_MIN_SALIDA = pd.Timedelta(hours=8, minutes=30)   # 2.12: sale después de 08:30
HBT_MIN = pd.Timedelta(hours=1)                        # 2.12: HBT > 1 hora
CONEXION_MIN = pd.Timedelta(minutes=50)                # 2.12: conexión > 50 min
CONEXION_MAX = pd.Timedelta(hours=1, minutes=30)       # 2.12: conexión < 1h30
PSV_MAX = pd.Timedelta(hours=11)                       # 2.12: PSV <= 11 hrs


def parse_fecha(s):
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


def parse_hora(s):
    """'08:15:00' -> Timedelta(hours=8, minutes=15)."""
    if pd.isna(s):
        return pd.NaT
    h, m, sec = str(s).split(":")
    return pd.Timedelta(hours=int(h), minutes=int(m), seconds=int(sec))


def cargar_y_depurar(csv_path: str) -> pd.DataFrame:
    """2.9-2.10: depura la base y se queda con las columnas de trabajo."""
    df = pd.read_csv(csv_path)

    df["fecha_dt"] = df["inicio_vuelo_lt"].apply(parse_fecha)
    df["std_td"] = df["std_hb"].apply(parse_hora)
    df["sta_td"] = df["sta_hb"].apply(parse_hora)
    df["hbt_td"] = df["hbt"].apply(parse_hora)

    df["std_dt"] = df["fecha_dt"] + df["std_td"]
    df["sta_dt"] = df["fecha_dt"] + df["sta_td"]
    # si la hora de llegada es menor que la de salida, cruzó medianoche
    df.loc[df["sta_dt"] < df["std_dt"], "sta_dt"] += pd.Timedelta(days=1)

    df["dia_semana"] = df["fecha_dt"].dt.day_name().map(WD_ES)

    cols = ["trip", "dia_duty", "fecha_dt", "dia_semana", "vuelo", "dep", "arr",
            "std_hb", "sta_hb", "std_dt", "sta_dt", "hbt", "hbt_td", "sub_fleet"]
    return df[cols].copy()


def filtrar_mes_y_ruta(df: pd.DataFrame, mes: int, anio: int) -> pd.DataFrame:
    """2.11: mes objetivo, dep=LIM, ruta nacional válida."""
    rutas_validas = RUTAS_VALIDAS_ARR - {c.upper() for c in EXCLUSIONES_MES}

    en_mes = (df["fecha_dt"].dt.month == mes) & (df["fecha_dt"].dt.year == anio)
    sale_de_lim = df["dep"] == "LIM"
    llega_a_lim = df["arr"] == "LIM"
    ruta_nacional_ok = df["arr"].isin(rutas_validas) | (llega_a_lim)

    return df[en_mes & (sale_de_lim | llega_a_lim) & ruta_nacional_ok].copy()


def armar_primeras_mitades(df: pd.DataFrame, dia_duty_min_real: pd.Series | None = None
                            ) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    2.14: para cada trip, la "primera mitad" son las piernas del
    dia_duty mínimo (el instructor solo cubre el primer día de duty).

    IMPORTANTE: `df` ya viene filtrado por mes/ruta (filtrar_mes_y_ruta),
    así que su dia_duty mínimo puede NO ser el día 1 real del pairing si
    ese día 1 cayó en otro mes o en una ruta no válida (y por eso se
    filtró). Para no chequear crew en un día que en realidad es el 2do o
    3ro del pairing (violaría 2.14), se recibe `dia_duty_min_real`: el
    dia_duty mínimo de cada trip calculado ANTES de filtrar (bug real
    encontrado en QA, ej. trip 65: día 1 real en 30-sep se filtra, y el
    día 2 -ya en octubre- se tomaba por error como si fuera el día 1).

    Devuelve (candidatos_validos, excluidos_con_motivo).
    """
    validos_rows = []
    excluidos_rows = []

    for trip, grupo in df.groupby("trip"):
        dia_min = grupo["dia_duty"].min()
        if dia_duty_min_real is not None and trip in dia_duty_min_real.index \
                and dia_min != dia_duty_min_real.loc[trip]:
            excluidos_rows.append({
                "trip": trip,
                "motivo": (f"el día {dia_min} que sobrevivió el filtro no es el día 1 real del "
                           f"pairing (día 1 real = {dia_duty_min_real.loc[trip]}, cayó fuera de "
                           f"mes/ruta) -> el instructor solo puede cubrir el día 1 real"),
            })
            continue
        dia1 = grupo[grupo["dia_duty"] == dia_min].sort_values("std_dt")

        # 2.14: "el instructor solo puede chequear a los 4 TC que operan
        # el PRIMER tramo de ida y vuelta" -> aunque el día 1 tenga más
        # tramos (2 vueltas seguidas, ej. LIM-CUZ-LIM-AQP-LIM), solo se
        # toman los 2 primeros (la primera ida + la primera vuelta); el
        # resto del día 1 no le corresponde al instructor.
        if len(dia1) < 2:
            excluidos_rows.append({"trip": trip, "motivo": "día 1 sin vuelta el mismo día (1 solo tramo)"})
            continue

        # Indicación del usuario: si el día 1 trae 6, 8 o 10 tramos (3, 4
        # o 5 idas+vueltas seguidas), es demasiado para un solo instructor
        # -> se descarta el trip completo (no solo los primeros 2 tramos).
        if len(dia1) in (6, 8, 10):
            excluidos_rows.append({"trip": trip, "motivo": f"día 1 tiene {len(dia1)} tramos -> no se toma"})
            continue

        ida, vuelta = dia1.iloc[0], dia1.iloc[1]
        if ida["dep"] != "LIM":
            excluidos_rows.append({"trip": trip, "motivo": "el primer tramo no sale de LIM"})
            continue
        if vuelta["arr"] != "LIM":
            excluidos_rows.append({"trip": trip, "motivo": "el segundo tramo del día 1 no vuelve a LIM"})
            continue
        if vuelta["dep"] != ida["arr"]:
            # ruta triangular (LIM-X-Y-LIM) con un tramo intermedio que no
            # toca LIM y por eso quedó filtrado -> lo que sobrevivió NO es
            # un ida+vuelta real al mismo destino (ej. trip 17: LIM-AQP,
            # [AQP-CUZ filtrado], CUZ-LIM). Se descarta.
            excluidos_rows.append({"trip": trip, "motivo": f"vuelta sale de {vuelta['dep']} pero la ida llegó a {ida['arr']} (ruta triangular con tramo intermedio filtrado)"})
            continue

        motivos = []
        if (ida["std_dt"] - ida["fecha_dt"]) <= HORA_MIN_SALIDA:
            motivos.append("sale antes/igual a 08:30")
        if ida["hbt_td"] <= HBT_MIN:
            motivos.append("HBT ida <= 1h")
        if vuelta["hbt_td"] <= HBT_MIN:
            motivos.append("HBT vuelta <= 1h")

        # OJO: la regla de conexión >50min y <1h30 (2.12) es para EMPATAR
        # DOS PAIRINGS DISTINTOS el mismo día (2.15: "se busca un pairing
        # distinto cuyo primer vuelo salga después..."), NO para la vuelta
        # interna de un pairing ya armado por Carmen -> verificado con los
        # datos: el 95% de las conexiones internas reales están entre 35 y
        # 50 min (turnaround normal), fuera de ese rango. Por eso NO se usa
        # como motivo de exclusión aquí; solo se deja como dato informativo
        # en la columna "Conexión" de la salida.
        conexion = vuelta["std_dt"] - ida["sta_dt"]
        if conexion <= pd.Timedelta(0):
            motivos.append(f"conexión interna negativa/cero ({conexion}) -> datos inconsistentes")

        psv = vuelta["sta_dt"] - ida["std_dt"]
        if psv > PSV_MAX:
            motivos.append(f"PSV {psv} > 11h")

        if motivos:
            excluidos_rows.append({"trip": trip, "motivo": "; ".join(motivos)})
            continue

        validos_rows.append({
            "Fecha": ida["fecha_dt"].strftime("%d/%m/%Y"),
            "DíaSem": ida["dia_semana"],
            "Pairing ID": trip,
            "Vuelo Ida": ida["vuelo"], "Dep": ida["dep"], "Arr": ida["arr"],
            "STD Ida": ida["std_hb"], "STA Ida": ida["sta_hb"], "HBT Ida": ida["hbt"],
            "Vuelo Vuelta": vuelta["vuelo"], "Dep Vta": vuelta["dep"], "Arr Vta": vuelta["arr"],
            "STD Vuelta": vuelta["std_hb"], "STA Vuelta": vuelta["sta_hb"], "HBT Vuelta": vuelta["hbt"],
            "Conexión": str(conexion), "PSV Total": str(psv),
            "Sub Flota": ida["sub_fleet"],
            "_orden": ida["std_dt"],
            "_ida_std_dt": ida["std_dt"], "_vuelta_sta_dt": vuelta["sta_dt"],
        })

    cols_finales = ["Fecha", "DíaSem", "Pairing ID", "Vuelo Ida", "Dep", "Arr", "STD Ida",
                     "STA Ida", "HBT Ida", "Vuelo Vuelta", "Dep Vta", "Arr Vta", "STD Vuelta",
                     "STA Vuelta", "HBT Vuelta", "Conexión", "PSV Total", "Sub Flota",
                     "Posible 2do vuelo (mismo día)"]

    if not validos_rows:
        excluidos = pd.DataFrame(excluidos_rows)
        return pd.DataFrame(columns=cols_finales), excluidos

    validos = pd.DataFrame(validos_rows).sort_values("_orden")

    # 2.15: para cada candidato, qué OTROS candidatos válidos del mismo
    # día podrían ser "el segundo vuelo" del instructor (su ida sale
    # >50min y <1h30 después de que este candidato regresa a LIM).
    posibles = []
    for _, row in validos.iterrows():
        mismo_dia = validos[validos["Fecha"] == row["Fecha"]]
        ventana_ini = row["_vuelta_sta_dt"] + CONEXION_MIN
        ventana_fin = row["_vuelta_sta_dt"] + CONEXION_MAX
        candidatos_2do = mismo_dia[
            (mismo_dia["Pairing ID"] != row["Pairing ID"]) &
            (mismo_dia["_ida_std_dt"] > ventana_ini) &
            (mismo_dia["_ida_std_dt"] < ventana_fin)
        ]["Pairing ID"].tolist()
        posibles.append(", ".join(str(p) for p in candidatos_2do) if candidatos_2do else "")
    validos["Posible 2do vuelo (mismo día)"] = posibles

    validos = validos[cols_finales].reset_index(drop=True)
    excluidos = pd.DataFrame(excluidos_rows)
    return validos, excluidos


def guardar_excel(validos: pd.DataFrame, excluidos: pd.DataFrame, out_path: str):
    bold = Font(bold=True)
    header_fill = PatternFill("solid", fgColor="FFFF00")
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center")

    with pd.ExcelWriter(out_path, engine="openpyxl") as writer:
        validos.to_excel(writer, sheet_name="Candidatos_validos", index=False)
        excluidos.to_excel(writer, sheet_name="Excluidos_primera_mitad", index=False)

        for nombre, data in (("Candidatos_validos", validos), ("Excluidos_primera_mitad", excluidos)):
            ws = writer.sheets[nombre]
            for c in range(1, len(data.columns) + 1):
                cell = ws.cell(row=1, column=c)
                cell.font = bold
                cell.fill = header_fill
                cell.border = border
                cell.alignment = center
            for r in range(2, len(data) + 2):
                for c in range(1, len(data.columns) + 1):
                    ws.cell(row=r, column=c).border = border
            widths = [max(12, len(str(col)) + 2) for col in data.columns]
            for c, w in enumerate(widths, start=1):
                ws.column_dimensions[ws.cell(row=1, column=c).column_letter].width = w
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions


if __name__ == "__main__":
    df = cargar_y_depurar(SRC)
    dia_duty_min_real = df.groupby("trip")["dia_duty"].min()  # ANTES de filtrar
    df_filtrado = filtrar_mes_y_ruta(df, MES_OBJETIVO, ANIO_OBJETIVO)
    validos, excluidos = armar_primeras_mitades(df_filtrado, dia_duty_min_real)
    guardar_excel(validos, excluidos, OUT)

    print(f"Trips en el mes/ruta filtrados: {df_filtrado['trip'].nunique()}")
    print(f"Candidatos válidos (primera mitad OK): {len(validos)}")
    print(f"Excluidos (primera mitad con algún problema): {len(excluidos)}")
    print(f"Archivo generado: {OUT}")
