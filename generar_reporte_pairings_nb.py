"""
Arma el archivo final "Pairings NB" en formato bloque, replicando la
estructura real de "Copia de Pairings NB SEPTIEMBRE - 26": CADA BLOQUE
son 2 pairings encadenados (4 filas = 1 día completo de instructor:
ida+vuelta + ida+vuelta), no 1 pairing por bloque.

Reutiliza la lógica ya validada de generar_candidatos_nb.py (depuración,
filtro de mes/ruta/hora, armado de la primera mitad de cada pairing).

Confirmado con el usuario / video de muestra:
  - Rutas válidas (dep=LIM): exactamente AQP, CIX, CJA, CUZ, IQT, PCL,
    PEM, PIU, TPP (ver RUTAS_VALIDAS_ARR en generar_candidatos_nb.py).
  - STD > 08:30.
  - La "Conexión" (columna K) es el hueco entre CADA fila y la fila
    anterior del bloque (STD de esta fila menos STA de la anterior):
    en la fila 2 es el giro interno del pairing A; en la fila 3 es la
    conexión ENTRE el pairing A y el B (la que debe cumplir >=50min y
    <1h30 para que el emparejamiento sea válido); en la fila 4 vuelve
    a ser el giro interno del pairing B.
  - Estructura de columnas (B en adelante): Pairing ID, Fecha, DíaSem,
    Vuelo, Dep, Arr, STD, STA, Sub Flota, Conexión, HBT, Instructor,
    (N vacía), Actividad+descripción, (P vacía), y desde Q hasta X el
    resumen (Pairing ID, Fecha, DíaSem, Vuelo, Ruta, Instructor,
    Actividad, Sub Flota) -> 2 filas de resumen por bloque (1 por
    pairing), con Sub Flota = "=J<fila>" (misma fila del grid).

SUPUESTO que hice y que puede necesitar ajuste (no estaba 100% claro
en las capturas): en la columna de descripción (O), cada pairing usa
2 líneas -> [Actividad] en la 1ra pierna, [ruta + los 2 vuelos con
horario] en la 2da pierna del mismo pairing. Si tu plantilla real usa
más líneas (una por vuelo separada), dímelo y lo ajusto.

Emparejamiento automático: se recorren los candidatos en orden
cronológico y cada uno se une con el primer candidato del mismo día
(no usado todavía) cuya salida caiga en la ventana (50min, 1h30) desde
su regreso. Si no encuentra pareja, queda como bloque de 2 filas (1
solo pairing) -> revisar la hoja para completarlo a mano.

Uso:
    python generar_reporte_pairings_nb.py
"""

import re
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation

from generar_candidatos_nb import (
    SRC, MES_OBJETIVO, ANIO_OBJETIVO,
    cargar_y_depurar, filtrar_mes_y_ruta, armar_primeras_mitades,
    CONEXION_MIN, CONEXION_MAX, PSV_MAX,
)

# ----------------------------------------------------------------------
OUT = r"Pairings_NB_SET_2026_v3.xlsx"
N_MUESTRA = None   # número de BLOQUES (no candidatos) de muestra; None = todos

# Grid EXACTO de las 4 filas de reglas (fila, columna, texto, es_rojo),
# tal cual la captura -> no es una lista, es una cuadrícula de 4 filas.
TITULOS_GRID = [
    (1, 2, "Conexión > o = a 50min y < a 1hr y 30min", False),
    (1, 4, "NO CONSIDERAR TRU/JUL/JAE/AYP/JAU/IQT", True),
    (1, 8, "CONSIDERAR PAIRINGS PARTIDOS LCK A320", False),
    (1, 11, "Vuelos LCK = Siempre en Flota 320", False),
    (2, 2, "Vuelos HBT mayor a 1 hora", False),
    (2, 4, "PSV NO MAYOR A 11 HRS", False),
    (2, 8, "CONSIDERAR SIEMPRE EL PDR", False),
    (2, 11, "Vuelos iniciando más de 08:30", False),
    (3, 4, "NO REPETIR PAIRING EN LCK", True),
]

ACTIVIDADES_NB = [
    "LCK A320F", "Reentrenamiento A320F", "LCK A320F + Habilitación A320F",
    "LCK A320 ALUMNO", "Auditoria CAB Vuelo", "BIANUAL IDE - HAB IDE",
    "EXP RECIENTE A320", "CHEQUEO LATAM A320F", "CHEQUEO DGAC A320F",
]

# Catálogo de instructores (nombre corto, BP, nombre completo/legal) ->
# alimenta la hoja "Instructores" y el desplegable de la columna M.
INSTRUCTORES_DATA = [
    ("Christian Rondon", "1271571", " RONDON BARRUTIA CHRISTIAN ERIC "),
    ("Erika Davila", "967092", "DAVILA BELLO MARIA ERIKA"),
    ("Sebastian Correa", "2396710", " CORREA GARCIA JUAN SEBASTIAN "),
    ("Fiorella Ruiz", "2713993", "RUIZ RIOJA FIORELLA DEL PILAR"),
    ("Jazmin Guerra", "29530", "GUERRA SUAREZ JAZMIN"),
    ("Jennifert Acurio", "3779550", "ACURIO DARGENT JENNIFERT MILAGROS"),
    ("Karen Santa Cruz", "2843319", "SANTA CRUZ HUAMAN KAREN"),
    ("Luis Bacigalupo", "2963161", "BACIGALUPO FLORES LUIS ENRIQUE"),
    ("Claudia Flores", "3217561", " FLORES FUENTES DAVILA CLAUDIA ALEXANDRA "),
    ("Karla Moz", "71348", "MOZ MONTES KARLA LISSETTE"),
    ("Elizabeth Torres", "2369641", "TORRES POLO ELIZABETH DEL PILAR"),
    ("Patricia Najar", "2369624", "NAJAR CRUZ PATRICIA DEL PILAR"),
    ("Javier Zapata", "3134911", "ZAPATA GARAYAR JAVIER RICARDO SALVADOR"),
    ("Jefferson Mendez", "3750335", " MENDEZ RUCOBA JEFFERSON "),
    ("Gabriela Ungaro", "3852423", "UNGARO GUTIERREZ GABRIELA"),
    ("Mariella Carrasco", "2604360", "CARRASCO BENAVIDES ROSA MARIELLA"),
    ("Cesar Campos", "2823133", " CAMPOS CONCHE CESAR AUGUSTO "),
    ("Kevin Segovia", "3189967", "SEGOVIA TAPIA RAY KEVIN"),
    ("Milagros Salas", "2415373", "SALAS COSIO MILAGROS PATRICIA"),
    ("Judith Fernandez", "2440915", "FERNANDEZ GARCIA JUDITH JULIET"),
    ("Rafael Nieto", "3796947", " NIETO SAENZ RAFAEL ANTONIO "),
    ("Gianfranco Celiz", "3841387", " CELIZ ROSSI GIANFRANCO PAOLO "),
]

HEADERS = ["Pairing ID", "Fecha", "DíaSem", "Vuelo", "Dep", "Arr", "STD", "STA", "Sub Flota"]


def _fecha_dt(s):
    d, m, a = s.split("/")
    return pd.Timestamp(year=int(a), month=int(m), day=int(d))


def _hora_td(s):
    h, m, sec = s.split(":")
    return pd.Timedelta(hours=int(h), minutes=int(m), seconds=int(sec))


def parear_candidatos(validos: pd.DataFrame) -> list[tuple]:
    """
    Empareja cada candidato con otro del mismo día que conecte en
    (CONEXION_MIN, CONEXION_MAX) Y cuyo PSV COMBINADO (desde la salida
    del primero hasta el regreso del segundo -> el día completo del
    instructor) no supere PSV_MAX. Recorrido cronológico, greedy.

    Bug real encontrado en QA: antes solo se validaba el PSV de cada
    pairing por separado (eso ya lo hace armar_primeras_mitades), pero
    "PSV NO MAYOR A 11 HRS" aplica al día completo del instructor, y
    dos pairings válidos por separado podían sumar >11h combinados
    (ej. pairing 535 + 561 = 11:05h).

    Devuelve una lista de tuplas (candidato_A, candidato_B_o_None).
    """
    df = validos.copy()
    df["_ida_dt"] = df.apply(lambda r: _fecha_dt(r["Fecha"]) + _hora_td(r["STD Ida"]), axis=1)
    df["_vta_dt"] = df.apply(lambda r: _fecha_dt(r["Fecha"]) + _hora_td(r["STA Vuelta"]), axis=1)
    df = df.sort_values("_ida_dt").reset_index(drop=True)

    usados = set()
    bloques = []
    for i, row in df.iterrows():
        if row["Pairing ID"] in usados:
            continue
        ventana_ini = row["_vta_dt"] + CONEXION_MIN
        ventana_fin = row["_vta_dt"] + CONEXION_MAX
        mismo_dia = df[
            (~df["Pairing ID"].isin(usados)) &
            (df["Pairing ID"] != row["Pairing ID"]) &
            (df["Fecha"] == row["Fecha"]) &
            (df["_ida_dt"] > ventana_ini) & (df["_ida_dt"] < ventana_fin) &
            (df["_vta_dt"] - row["_ida_dt"] <= PSV_MAX)
        ].sort_values("_ida_dt")

        usados.add(row["Pairing ID"])
        if len(mismo_dia) > 0:
            segunda = mismo_dia.iloc[0]
            usados.add(segunda["Pairing ID"])
            bloques.append((row, segunda))
        else:
            bloques.append((row, None))
    return bloques


def construir_bloques_nb(bloques: list, out_path: str, n_muestra: int | None):
    wb = Workbook()
    ws = wb.active
    ws.title = "Pairings NB"

    bold = Font(bold=True)
    red_bold = Font(bold=True, color="CC0000")
    green_bold = Font(bold=True)
    dutyid_fill = PatternFill("solid", fgColor="FFC000")
    psv_fill = PatternFill("solid", fgColor="FFFF00")       # amarillo
    resumen_fill = PatternFill("solid", fgColor="D9E1F2")
    conexion_lim_fill = PatternFill("solid", fgColor="C6E8C6")  # verde pastel
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", wrap_text=True)

    COL_CONEXION, COL_HBT = 11, 12          # K, L
    COL_INS, COL_VACIA1, COL_DESC = 13, 14, 15   # M, N(vacía), O
    COL_VACIA2 = 16                          # P(vacía)
    COL_RESUMEN_INI = 17                     # Q..X
    RESUMEN_HEADERS = ["Pairing ID", "Fecha", "DíaSem", "Vuelo", "Ruta",
                        "Instructor", "Actividad", "Sub Flota"]

    # --- hoja "Instructores" (catálogo: nombre corto / BP / nombre legal) ---
    wi = wb.create_sheet("Instructores")
    for j, h in enumerate(["Instructor", "BP", "Nombre"]):
        c = wi.cell(row=1, column=1 + j, value=h)
        c.font = bold
        c.border = border
    for i, (nombre, bp, legal) in enumerate(INSTRUCTORES_DATA, start=2):
        wi.cell(row=i, column=1, value=nombre).border = border
        wi.cell(row=i, column=2, value=bp).border = border
        wi.cell(row=i, column=3, value=legal).border = border
    for c, w in zip("ABC", (18, 12, 40)):
        wi.column_dimensions[c].width = w
    n_instructores = len(INSTRUCTORES_DATA)

    dv_instructor = DataValidation(
        type="list", formula1=f"=Instructores!$A$2:$A${1 + n_instructores}", allow_blank=True)
    ws.add_data_validation(dv_instructor)

    # --- grid de reglas (4 filas EXACTAS, no lista) ---
    for fila_r, col_r, texto, es_rojo in TITULOS_GRID:
        c = ws.cell(row=fila_r, column=col_r, value=texto)
        c.font = red_bold if es_rojo else bold

    fila_labels = 6  # deja la fila 4 (parte del grid) y la 5 en blanco

    for j, h in enumerate(RESUMEN_HEADERS):
        c = ws.cell(row=fila_labels, column=COL_RESUMEN_INI + j, value=h)
        c.font = bold
        c.fill = resumen_fill
        c.border = border
        c.alignment = center

    dv = DataValidation(type="list", formula1='"' + ",".join(ACTIVIDADES_NB) + '"', allow_blank=True)
    ws.add_data_validation(dv)

    todas_filas_pairing = []  # (r_ida, r_vta, r1_del_bloque) -> para la hoja Resumen Final

    HEADER_TITULOS = ["Pairing ID", "FECHA REAL", "Day of Week", "Flight No",
                       "Dep Stn", "Arr Stn", "STD", "STA", "subflota", "Conexion", "HBT"]

    fila = fila_labels + 2  # deja 1 fila en blanco antes del primer bloque
    if n_muestra is not None:
        bloques = bloques[:n_muestra]

    for candA, candB in bloques:
        candidatos_bloque = [candA] + ([candB] if candB is not None else [])
        filas_bloque = []  # (fila_ida, fila_vuelta) por candidato

        # --- encabezado de columnas, repetido por bloque ---
        for j, titulo in enumerate(HEADER_TITULOS):
            c = ws.cell(row=fila, column=2 + j, value=titulo)
            c.font = bold
            c.fill = resumen_fill
            c.border = border
            c.alignment = center
        fila += 1

        fila_r1 = fila
        for cand in candidatos_bloque:
            r_ida, r_vta = fila, fila + 1
            ida = {"Pairing ID": cand["Pairing ID"], "Fecha": cand["Fecha"], "DíaSem": cand["DíaSem"],
                   "Vuelo": cand["Vuelo Ida"], "Dep": cand["Dep"], "Arr": cand["Arr"],
                   "STD": cand["STD Ida"], "STA": cand["STA Ida"], "Sub Flota": cand["Sub Flota"]}
            vta = {"Pairing ID": cand["Pairing ID"], "Fecha": cand["Fecha"], "DíaSem": cand["DíaSem"],
                   "Vuelo": cand["Vuelo Vuelta"], "Dep": cand["Dep Vta"], "Arr": cand["Arr Vta"],
                   "STD": cand["STD Vuelta"], "STA": cand["STA Vuelta"], "Sub Flota": cand["Sub Flota"]}

            for r, leg in ((r_ida, ida), (r_vta, vta)):
                for j, h in enumerate(HEADERS):
                    c = ws.cell(row=r, column=2 + j, value=leg[h])
                    c.border = border
                    c.alignment = center
                c = ws.cell(row=r, column=COL_HBT,
                            value=(cand["HBT Ida"] if r == r_ida else cand["HBT Vuelta"]))
                c.border = border
                c.alignment = center

            # Conexión (K): hueco con la fila anterior del bloque (blanco en la 1ra fila).
            # En r_ida (salida de Lima) != fila_r1, es la conexión ENTRE dos pairings
            # (llegada a Lima -> salida de Lima) -> se resalta en verde pastel/negrita.
            # En r_vta es el giro interno del pairing (llegada a otra ciudad -> salida
            # de esa misma ciudad) -> queda sin resaltar.
            # +(TIMEVALUE(H)<TIMEVALUE(I)) suma 1 día si el vuelo de regreso
            # despega después de medianoche (cruza el día) -> evita conexión
            # negativa (bug real encontrado en QA, ej. pairing 236: llega
            # 23:25, sale 00:05 del día siguiente).
            if r_ida != fila_r1:
                c_con = ws.cell(row=r_ida, column=COL_CONEXION,
                                 value=(f'=TEXT(TIMEVALUE(H{r_ida})-TIMEVALUE(I{r_ida - 1})'
                                        f'+(TIMEVALUE(H{r_ida})<TIMEVALUE(I{r_ida - 1})),"[h]:mm")'))
                c_con.fill = conexion_lim_fill
                c_con.font = green_bold
            ws.cell(row=r_vta, column=COL_CONEXION,
                    value=(f'=TEXT(TIMEVALUE(H{r_vta})-TIMEVALUE(I{r_ida})'
                           f'+(TIMEVALUE(H{r_vta})<TIMEVALUE(I{r_ida})),"[h]:mm")'))

            filas_bloque.append((r_ida, r_vta))
            fila = r_vta + 1

        # --- instructor: input en r1, y se repite SOLO en la salida de Lima de
        # cada pairing siguiente (r_ida) -> no se muestra en las filas de regreso (r_vta) ---
        r1 = filas_bloque[0][0]
        c_ins = ws.cell(row=r1, column=COL_INS)
        c_ins.fill = dutyid_fill
        c_ins.font = bold
        c_ins.comment = Comment("Elegir el instructor de la lista", "generar_reporte_pairings_nb.py")
        dv_instructor.add(c_ins)
        for idx, (r_ida, r_vta) in enumerate(filas_bloque):
            if idx > 0:
                ws.cell(row=r_ida, column=COL_INS, value=f'=IF($M${r1}="","",$M${r1})')

        # --- actividad (dropdown, r1) + repetida en la 1ra fila de cada pairing siguiente ---
        c_act = ws.cell(row=r1, column=COL_DESC)
        c_act.fill = dutyid_fill
        c_act.font = bold
        c_act.comment = Comment("Tipo de actividad (elegir de la lista)", "generar_reporte_pairings_nb.py")
        dv.add(c_act)

        for k, (r_ida, r_vta) in enumerate(filas_bloque):
            if k > 0:
                ws.cell(row=r_ida, column=COL_DESC, value=f'=IF($O${r1}="","",$O${r1})')
            # 2da fila del pairing: ruta + ambos vuelos con horario
            ws.cell(row=r_vta, column=COL_DESC,
                    value=(f'="LIM-"&G{r_ida}&"-LIM   LA "&E{r_ida}&" ("&LEFT(H{r_ida},5)&"-"&LEFT(I{r_ida},5)&" hrs)'
                           f'  /  LA "&E{r_vta}&" ("&LEFT(H{r_vta},5)&"-"&LEFT(I{r_vta},5)&" hrs)"'))

        # --- fila PSV total del bloque (label en J, valor en K, ambas en amarillo) ---
        r_ult = filas_bloque[-1][1]
        fila_psv = fila
        c_psv_label = ws.cell(row=fila_psv, column=10, value="PSV total:")
        c_psv_label.font = bold
        c_psv_label.fill = psv_fill
        c_psv_val = ws.cell(row=fila_psv, column=11,
                             value=f'=TEXT(TIMEVALUE(I{r_ult})-TIMEVALUE(H{r1})+(I{r_ult}<H{r1}),"[h]:mm")')
        c_psv_val.fill = psv_fill

        # --- resumen (Q..X), 1 fila por pairing del bloque ---
        for r_ida, r_vta in filas_bloque:
            todas_filas_pairing.append((r_ida, r_vta, r1))
            resumen_valores = [
                f"=B{r_ida}", f"=C{r_ida}", f"=D{r_ida}",
                f'=E{r_ida}&"/"&E{r_vta}',
                f'=F{r_ida}&"-"&G{r_ida}&"-"&F{r_ida}',
                f'=IF($M${r1}="","",$M${r1})',
                f'=IF($O${r1}="","",$O${r1})',
                f"=J{r_ida}",
            ]
            for j, val in enumerate(resumen_valores):
                c = ws.cell(row=r_ida, column=COL_RESUMEN_INI + j, value=val)
                c.border = border
                c.alignment = center

        fila = fila_psv + 2  # 1 fila de separación entre bloques

    # --- anchos de columna ---
    anchos = [10, 11, 9, 8, 7, 7, 9, 9, 9]
    for j, w in enumerate(anchos):
        ws.column_dimensions[ws.cell(row=1, column=2 + j).column_letter].width = w
    for col, w in ((COL_CONEXION, 9), (COL_HBT, 8), (COL_INS, 18), (COL_VACIA1, 3),
                   (COL_DESC, 38), (COL_VACIA2, 3)):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = w
    for j, w in enumerate([10, 11, 9, 12, 16, 18, 24, 9]):
        ws.column_dimensions[ws.cell(row=1, column=COL_RESUMEN_INI + j).column_letter].width = w

    ws.freeze_panes = f"B{fila_labels + 1}"

    # ------------------------------------------------------------------
    # Hoja "Resumen Final": 1 fila por pairing (todo el mes), con BP y
    # Nombre completo del instructor (VLOOKUP contra "Instructores") y
    # CUPOS calculado (320->4, 319->3, salvo actividades con
    # "Habilitación" -> 2, según el manual 2.4 y tus ejemplos reales).
    # ------------------------------------------------------------------
    wr = wb.create_sheet("Resumen Final")
    resumen_final_headers = ["TRIP", "Fecha", "DíaSEM", "Vuelo", "Ruta", "BP INS",
                              "INS", "ACTIVIDAD", "FLOTA", "Nombre INS", "CUPOS"]
    for j, h in enumerate(resumen_final_headers):
        c = wr.cell(row=1, column=1 + j, value=h)
        c.font = bold
        c.border = border

    P = "'Pairings NB'!"
    for i, (r_ida, r_vta, r1_bloque) in enumerate(todas_filas_pairing, start=2):
        ins_ref = f"{P}$M${r1_bloque}"
        act_ref = f"{P}$O${r1_bloque}"
        flota_ref = f"{P}J{r_ida}"
        valores = [
            f"={P}B{r_ida}",
            f"={P}C{r_ida}",
            f"={P}D{r_ida}",
            f'={P}E{r_ida}&"/"&{P}E{r_vta}',
            f'={P}F{r_ida}&"-"&{P}G{r_ida}&"-"&{P}F{r_ida}',
            f'=IFERROR(VLOOKUP({ins_ref},Instructores!$A:$C,2,FALSE),"")',
            f"={ins_ref}",
            f"={act_ref}",
            f"={flota_ref}",
            f'=IFERROR(VLOOKUP({ins_ref},Instructores!$A:$C,3,FALSE),"")',
            f'=IF({flota_ref}=320,4,3)',  # 2.4/2.18 del manual: A320=4 cupos, A319=3
        ]
        for j, val in enumerate(valores):
            c = wr.cell(row=i, column=1 + j, value=val)
            c.border = border

    for col, w in zip("ABCDEFGHIJK", (9, 11, 10, 12, 16, 10, 18, 26, 8, 40, 8)):
        wr.column_dimensions[col].width = w
    wr.freeze_panes = "A2"
    wr.auto_filter.ref = wr.dimensions

    wb.save(out_path)


if __name__ == "__main__":
    df = cargar_y_depurar(SRC)
    dia_duty_min_real = df.groupby("trip")["dia_duty"].min()  # ANTES de filtrar
    df_filtrado = filtrar_mes_y_ruta(df, MES_OBJETIVO, ANIO_OBJETIVO)
    validos, _excluidos = armar_primeras_mitades(df_filtrado, dia_duty_min_real)
    bloques = parear_candidatos(validos)

    n_parejas = sum(1 for _, b in bloques if b is not None)
    n_solos = sum(1 for _, b in bloques if b is None)

    construir_bloques_nb(bloques, OUT, n_muestra=N_MUESTRA)
    print(f"Candidatos válidos: {len(validos)}")
    print(f"Bloques armados: {len(bloques)} ({n_parejas} con 2 pairings, {n_solos} sin pareja)")
    print(f"Archivo generado (muestra de {N_MUESTRA} bloques): {OUT}")
