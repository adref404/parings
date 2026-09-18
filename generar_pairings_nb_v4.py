"""
Versión 4 del reporte de Pairings NB: además de armar los bloques de
vuelos (igual que generar_reporte_pairings_nb.py), AUTO-ASIGNA
instructor + actividad + tripulantes a cada bloque, aplicando:

  - Regla de reva: un instructor NO puede dictar Line Check (LCK) este
    mes al tripulante al que le dictó REVA el mes anterior.
  - Cupos por flota: A320 = 4 cupos (1 TJ + 3 TC), A319 = 3 cupos
    (1 TJ + 2 TC) -> ya estaba en "Resumen Final" (columna CUPOS),
    aquí además se listan los tripulantes que ocupan esos cupos.
  - Grupos de instructores (Grupo 1/2/3), según la matriz que se
    confirmó por imagen.
  - Actividad por tripulante (no todos son "LCK A320F"; también
    Reentrenamiento, etc.), tomada de su estado "OBS FREEZE".

*** IMPORTANTE: no existe (en los archivos que se me pasaron) la base
real de "qué tripulante necesita LCK este mes" ni su historial de
reva -> esa base solo se vio en capturas de pantalla, no es un
archivo que se pueda leer/procesar. Por eso la lista de tripulantes
de este script es 100% FICTICIA (nombres "Tripulante Ejemplo NN",
sin relación con personas reales) -> sirve para DEMOSTRAR cómo
quedaría automatizada la asignación, pero antes de usarla en
producción hay que reemplazar CREW_SIMULADO por el archivo real del
roster + historial de revas del mes anterior. ***

Uso:
    python generar_pairings_nb_v4.py
"""

import random

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.worksheet.datavalidation import DataValidation

from generar_reporte_pairings_nb import (
    SRC, MES_OBJETIVO, ANIO_OBJETIVO,
    cargar_y_depurar, filtrar_mes_y_ruta, armar_primeras_mitades, parear_candidatos,
    INSTRUCTORES_DATA, ACTIVIDADES_NB, TITULOS_GRID, HEADERS,
)

OUT = r"Pairings_NB_SET_2026_v4.xlsx"

# ----------------------------------------------------------------------
# Grupos de instructores (confirmado por imagen: Instructor -> Grupo)
# ----------------------------------------------------------------------
GRUPOS = {
    "Grupo 1": ["Christian Rondon", "Fiorella Ruiz", "Jefferson Mendez", "Sebastian Correa"],
    "Grupo 2": ["Claudia Flores", "Javier Zapata", "Jazmin Guerra", "Jennifert Acurio"],
    "Grupo 3": ["Gabriela Ungaro", "Karen Santa Cruz", "Patricia Najar"],
}
INSTRUCTOR_A_GRUPO = {nombre: grupo for grupo, nombres in GRUPOS.items() for nombre in nombres}
POOL_INSTRUCTORES = [n for nombres in GRUPOS.values() for n in nombres]  # 11, orden fijo para el round-robin

OBS_A_ACTIVIDAD = {
    "LCK P1": "LCK A320F",
    "LCK P2": "LCK A320F",
    "LCK PRORROGA": "Reentrenamiento A320F",
}


def generar_crew_simulado(n=32, seed=42):
    """
    *** DATOS FICTICIOS, NO SON TRIPULANTES REALES ***
    Simula la "hoja de búsqueda" de tripulantes (roster + historial de
    reva del mes anterior) que en la realidad viene de otro archivo
    (el que se vio en las capturas). Reemplazar por el archivo real.
    """
    rnd = random.Random(seed)
    cats = ["TCA"] * 6 + ["TCB"] * 2 + ["JSBA"]  # JSBA ~ rol TJ (purser)
    obs_opciones = ["LCK P1", "LCK P2", "LCK PRORROGA"]

    crew = []
    for i in range(1, n + 1):
        cat = rnd.choice(cats)
        obs = rnd.choice(obs_opciones)
        # ~30% de los tripulantes tuvieron reva el mes anterior con
        # alguno de los 11 instructores del pool (dato ficticio)
        reva_agosto = rnd.choice(POOL_INSTRUCTORES) if rnd.random() < 0.30 else None
        crew.append({
            "bp": 9000000 + i,
            "cat": cat,
            "es_tj": cat in ("JSBA", "JSBB"),
            "nombre": f"Tripulante Ejemplo {i:02d}",
            "obs_freeze": obs,
            "reva_agosto": reva_agosto,
        })
    return crew


def asignar_bloques(bloques, crew):
    """
    Para cada bloque (en orden cronológico) consume tripulantes de la
    cola según los cupos de su flota (320->4, 319->3) y elige, por
    round-robin, el primer instructor del pool que NO tenga conflicto
    de reva con NINGUNO de los tripulantes que le tocarían en ese
    bloque. Devuelve {indice_bloque: {instructor, grupo, actividad,
    tripulantes_str}}.
    """
    bloques_ordenados = sorted(
        enumerate(bloques),
        key=lambda ib: (ib[1][0]["Fecha"], ib[1][0]["STD Ida"]),
    )

    asignaciones = {}
    crew_ptr = 0
    ins_ptr = 0

    for bidx, (candA, _candB) in bloques_ordenados:
        if crew_ptr >= len(crew):
            break  # ya no quedan tripulantes por chequear este mes

        cupos = 4 if int(candA["Sub Flota"]) == 320 else 3
        tripulantes_bloque = crew[crew_ptr: crew_ptr + cupos]
        crew_ptr += len(tripulantes_bloque)

        instructor = None
        for _ in range(len(POOL_INSTRUCTORES)):
            candidato = POOL_INSTRUCTORES[ins_ptr % len(POOL_INSTRUCTORES)]
            ins_ptr += 1
            if all(tc["reva_agosto"] != candidato for tc in tripulantes_bloque):
                instructor = candidato
                break
        if instructor is None:
            # los 11 tienen conflicto con este grupo de tripulantes (caso
            # límite) -> se deja el primero del pool y se marca para
            # revisión manual
            instructor = POOL_INSTRUCTORES[ins_ptr % len(POOL_INSTRUCTORES)]

        for tc in tripulantes_bloque:
            tc["ins_asignado"] = instructor

        actividad = OBS_A_ACTIVIDAD.get(tripulantes_bloque[0]["obs_freeze"], "LCK A320F")

        asignaciones[bidx] = {
            "instructor": instructor,
            "grupo": INSTRUCTOR_A_GRUPO.get(instructor, "-"),
            "actividad": actividad,
            "tripulantes": ", ".join(tc["nombre"] for tc in tripulantes_bloque),
        }

    return asignaciones


def construir_bloques_nb_v4(bloques: list, asignaciones: dict, crew: list, out_path: str):
    wb = Workbook()
    ws = wb.active
    ws.title = "Pairings NB"

    bold = Font(bold=True)
    red_bold = Font(bold=True, color="CC0000")
    green_bold = Font(bold=True)
    dutyid_fill = PatternFill("solid", fgColor="FFC000")
    psv_fill = PatternFill("solid", fgColor="FFFF00")
    resumen_fill = PatternFill("solid", fgColor="D9E1F2")
    conexion_lim_fill = PatternFill("solid", fgColor="C6E8C6")
    tripulantes_fill = PatternFill("solid", fgColor="E2EFDA")
    thin = Side(style="thin", color="999999")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    center = Alignment(horizontal="center", wrap_text=True)

    COL_CONEXION, COL_HBT = 11, 12
    COL_INS, COL_TRIPULANTES, COL_DESC = 13, 14, 15   # M, N (ahora con tripulantes), O
    COL_VACIA2 = 16
    COL_RESUMEN_INI = 17
    RESUMEN_HEADERS = ["Pairing ID", "Fecha", "DíaSem", "Vuelo", "Ruta",
                        "Instructor", "Actividad", "Sub Flota"]

    # --- hoja "Instructores" (catálogo + Grupo) ---
    wi = wb.create_sheet("Instructores")
    for j, h in enumerate(["Instructor", "BP", "Nombre", "Grupo"]):
        c = wi.cell(row=1, column=1 + j, value=h)
        c.font = bold
        c.border = border
    for i, (nombre, bp, legal) in enumerate(INSTRUCTORES_DATA, start=2):
        wi.cell(row=i, column=1, value=nombre).border = border
        wi.cell(row=i, column=2, value=bp).border = border
        wi.cell(row=i, column=3, value=legal).border = border
        wi.cell(row=i, column=4, value=INSTRUCTOR_A_GRUPO.get(nombre, "")).border = border
    for c, w in zip("ABCD", (18, 12, 40, 10)):
        wi.column_dimensions[c].width = w
    n_instructores = len(INSTRUCTORES_DATA)

    dv_instructor = DataValidation(
        type="list", formula1=f"=Instructores!$A$2:$A${1 + n_instructores}", allow_blank=True)
    ws.add_data_validation(dv_instructor)

    # --- grid de reglas ---
    for fila_r, col_r, texto, es_rojo in TITULOS_GRID:
        c = ws.cell(row=fila_r, column=col_r, value=texto)
        c.font = red_bold if es_rojo else bold

    fila_labels = 6

    for j, h in enumerate(RESUMEN_HEADERS):
        c = ws.cell(row=fila_labels, column=COL_RESUMEN_INI + j, value=h)
        c.font = bold
        c.fill = resumen_fill
        c.border = border
        c.alignment = center

    dv = DataValidation(type="list", formula1='"' + ",".join(ACTIVIDADES_NB) + '"', allow_blank=True)
    ws.add_data_validation(dv)

    todas_filas_pairing = []
    HEADER_TITULOS = ["Pairing ID", "FECHA REAL", "Day of Week", "Flight No",
                       "Dep Stn", "Arr Stn", "STD", "STA", "subflota", "Conexion", "HBT"]

    bloques_ordenados = sorted(
        enumerate(bloques),
        key=lambda ib: (ib[1][0]["Fecha"], ib[1][0]["STD Ida"]),
    )

    fila = fila_labels + 2
    for bidx, (candA, candB) in bloques_ordenados:
        candidatos_bloque = [candA] + ([candB] if candB is not None else [])
        filas_bloque = []

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

        r1 = filas_bloque[0][0]
        asignado = asignaciones.get(bidx)

        # --- instructor (auto-asignado si hay tripulantes pendientes; si no, dropdown vacío) ---
        c_ins = ws.cell(row=r1, column=COL_INS, value=asignado["instructor"] if asignado else None)
        c_ins.fill = dutyid_fill
        c_ins.font = bold
        comentario = "Elegir el instructor de la lista"
        if asignado:
            comentario = (f"AUTO (simulado): Grupo {asignado['grupo']}. "
                           f"Verificar igual antes de confirmar.")
        c_ins.comment = Comment(comentario, "generar_pairings_nb_v4.py")
        dv_instructor.add(c_ins)
        for idx, (r_ida, r_vta) in enumerate(filas_bloque):
            if idx > 0:
                ws.cell(row=r_ida, column=COL_INS, value=f'=IF($M${r1}="","",$M${r1})')

        # --- tripulantes del cupo (columna N, antes vacía) ---
        c_trip = ws.cell(row=r1, column=COL_TRIPULANTES,
                          value=(asignado["tripulantes"] if asignado else None))
        c_trip.fill = tripulantes_fill
        c_trip.alignment = Alignment(wrap_text=True, vertical="top")
        c_trip.comment = Comment(
            "*** SIMULADO: nombres ficticios de ejemplo, reemplazar por el roster real ***"
            if asignado else "", "generar_pairings_nb_v4.py")

        # --- actividad ---
        c_act = ws.cell(row=r1, column=COL_DESC, value=asignado["actividad"] if asignado else None)
        c_act.fill = dutyid_fill
        c_act.font = bold
        c_act.comment = Comment("Tipo de actividad (elegir de la lista si se corrige a mano)",
                                 "generar_pairings_nb_v4.py")
        dv.add(c_act)

        for k, (r_ida, r_vta) in enumerate(filas_bloque):
            if k > 0:
                ws.cell(row=r_ida, column=COL_DESC, value=f'=IF($O${r1}="","",$O${r1})')
            ws.cell(row=r_vta, column=COL_DESC,
                    value=(f'="LIM-"&G{r_ida}&"-LIM   LA "&E{r_ida}&" ("&LEFT(H{r_ida},5)&"-"&LEFT(I{r_ida},5)&" hrs)'
                           f'  /  LA "&E{r_vta}&" ("&LEFT(H{r_vta},5)&"-"&LEFT(I{r_vta},5)&" hrs)"'))

        r_ult = filas_bloque[-1][1]
        fila_psv = fila
        c_psv_label = ws.cell(row=fila_psv, column=10, value="PSV total:")
        c_psv_label.font = bold
        c_psv_label.fill = psv_fill
        c_psv_val = ws.cell(row=fila_psv, column=11,
                             value=f'=TEXT(TIMEVALUE(I{r_ult})-TIMEVALUE(H{r1})+(I{r_ult}<H{r1}),"[h]:mm")')
        c_psv_val.fill = psv_fill

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

        fila = fila_psv + 2

    anchos = [10, 11, 9, 8, 7, 7, 9, 9, 9]
    for j, w in enumerate(anchos):
        ws.column_dimensions[ws.cell(row=1, column=2 + j).column_letter].width = w
    for col, w in ((COL_CONEXION, 9), (COL_HBT, 8), (COL_INS, 18), (COL_TRIPULANTES, 34),
                   (COL_DESC, 26), (COL_VACIA2, 3)):
        ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = w
    for j, w in enumerate([10, 11, 9, 12, 16, 18, 24, 9]):
        ws.column_dimensions[ws.cell(row=1, column=COL_RESUMEN_INI + j).column_letter].width = w

    ws.freeze_panes = f"B{fila_labels + 1}"

    # ------------------------------------------------------------------
    # "Resumen Final": 1 fila por pairing, con BP/Nombre del instructor,
    # CUPOS, GRUPO del instructor y los TRIPULANTES asignados al cupo.
    # ------------------------------------------------------------------
    wr = wb.create_sheet("Resumen Final")
    resumen_final_headers = ["TRIP", "Fecha", "DíaSEM", "Vuelo", "Ruta", "BP INS",
                              "INS", "GRUPO INS", "ACTIVIDAD", "FLOTA", "Nombre INS",
                              "CUPOS", "TRIPULANTES (cupo, SIMULADO)"]
    for j, h in enumerate(resumen_final_headers):
        c = wr.cell(row=1, column=1 + j, value=h)
        c.font = bold
        c.border = border

    P = "'Pairings NB'!"
    for i, (r_ida, r_vta, r1_bloque) in enumerate(todas_filas_pairing, start=2):
        ins_ref = f"{P}$M${r1_bloque}"
        act_ref = f"{P}$O${r1_bloque}"
        flota_ref = f"{P}J{r_ida}"
        trip_ref = f"{P}$N${r1_bloque}"
        valores = [
            f"={P}B{r_ida}",
            f"={P}C{r_ida}",
            f"={P}D{r_ida}",
            f'={P}E{r_ida}&"/"&{P}E{r_vta}',
            f'={P}F{r_ida}&"-"&{P}G{r_ida}&"-"&{P}F{r_ida}',
            f'=IFERROR(VLOOKUP({ins_ref},Instructores!$A:$D,2,FALSE),"")',
            f"={ins_ref}",
            f'=IFERROR(VLOOKUP({ins_ref},Instructores!$A:$D,4,FALSE),"")',
            f"={act_ref}",
            f"={flota_ref}",
            f'=IFERROR(VLOOKUP({ins_ref},Instructores!$A:$D,3,FALSE),"")',
            f'=IF({flota_ref}=320,4,3)',
            f"={trip_ref}",
        ]
        for j, val in enumerate(valores):
            c = wr.cell(row=i, column=1 + j, value=val)
            c.border = border

    for col, w in zip("ABCDEFGHIJKLM", (9, 11, 10, 12, 16, 10, 18, 10, 26, 8, 40, 8, 40)):
        wr.column_dimensions[col].width = w
    wr.freeze_panes = "A2"
    wr.auto_filter.ref = wr.dimensions

    # ------------------------------------------------------------------
    # "Tripulantes (SIMULADO)": roster ficticio usado para la demo.
    # ------------------------------------------------------------------
    wt = wb.create_sheet("Tripulantes (SIMULADO)")
    aviso = wt.cell(row=1, column=1,
                     value=("*** DATOS FICTICIOS DE EJEMPLO — no son tripulantes reales. Generado para "
                            "demostrar el automatismo de asignación. Reemplazar por el archivo real del "
                            "roster del mes + historial de reva del mes anterior. ***"))
    aviso.font = red_bold
    wt.merge_cells(start_row=1, start_column=1, end_row=1, end_column=8)
    crew_headers = ["BP (ficticio)", "CAT", "Nombre (ficticio)", "OBS FREEZE",
                     "Reva mes anterior (INS, ficticio)", "Instructor asignado SET (simulado)",
                     "Grupo INS asignado", "¿Programado este bloque?"]
    for j, h in enumerate(crew_headers):
        c = wt.cell(row=2, column=1 + j, value=h)
        c.font = bold
        c.fill = resumen_fill
        c.border = border
    for i, tc in enumerate(crew, start=3):
        asignado_ok = "ins_asignado" in tc
        fila_vals = [
            tc["bp"], tc["cat"], tc["nombre"], tc["obs_freeze"],
            tc["reva_agosto"] or "",
            tc.get("ins_asignado", "") or "(sin bloque disponible este mes)",
            INSTRUCTOR_A_GRUPO.get(tc.get("ins_asignado", ""), ""),
            "SI" if asignado_ok else "NO",
        ]
        for j, v in enumerate(fila_vals):
            c = wt.cell(row=i, column=1 + j, value=v)
            c.border = border
    for col, w in zip("ABCDEFGH", (14, 8, 22, 14, 24, 26, 12, 20)):
        wt.column_dimensions[col].width = w
    wt.freeze_panes = "A3"
    wt.auto_filter.ref = f"A2:H{2 + len(crew)}"

    # ------------------------------------------------------------------
    # "Grupos Instructores": referencia rápida.
    # ------------------------------------------------------------------
    wg = wb.create_sheet("Grupos Instructores")
    wg.cell(row=1, column=1, value="Grupo").font = bold
    wg.cell(row=1, column=2, value="Instructor").font = bold
    r = 2
    for grupo, nombres in GRUPOS.items():
        for nombre in nombres:
            wg.cell(row=r, column=1, value=grupo).border = border
            wg.cell(row=r, column=2, value=nombre).border = border
            r += 1
    wg.column_dimensions["A"].width = 12
    wg.column_dimensions["B"].width = 20

    wb.save(out_path)


if __name__ == "__main__":
    df = cargar_y_depurar(SRC)
    dia_duty_min_real = df.groupby("trip")["dia_duty"].min()
    df_filtrado = filtrar_mes_y_ruta(df, MES_OBJETIVO, ANIO_OBJETIVO)
    validos, _excluidos = armar_primeras_mitades(df_filtrado, dia_duty_min_real)
    bloques = parear_candidatos(validos)

    crew = generar_crew_simulado()
    asignaciones = asignar_bloques(bloques, crew)

    construir_bloques_nb_v4(bloques, asignaciones, crew, OUT)

    n_asignados = len(asignaciones)
    n_tripulantes_cubiertos = sum(1 for tc in crew if "ins_asignado" in tc)
    print(f"Bloques totales: {len(bloques)}")
    print(f"Bloques con instructor/tripulantes asignados (simulado): {n_asignados}")
    print(f"Tripulantes ficticios cubiertos: {n_tripulantes_cubiertos} de {len(crew)}")
    print(f"Archivo generado: {OUT}")
