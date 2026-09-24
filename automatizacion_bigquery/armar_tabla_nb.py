"""
Arma la tabla NB filtrada/final a partir del export de BigQuery
(automatizacion_bigquery/tabla NB sub final.json), aplicando las MISMAS
reglas ya validadas en ../generar_candidatos_nb.py (2.9-2.14 del manual),
SIN modificar ese script.

Pensado para copiarse celda por celda a un notebook de Google Colab
(cada función de abajo = 1 celda), reemplazando en Colab la lectura del
JSON local por la autenticación + query a BigQuery.

Bug real encontrado y corregido aquí (no existía en el CSV viejo):
  El export de BigQuery NO trae `fecha_inicio_trip`, y `pairing_id`
  (columna "trip") se reutiliza para pairings distintos a lo largo de
  los 13 meses que trae la query (confirmado: 84 de 2689 trips con un
  rango de fechas de 26-29 días, imposible para un pairing real).
  Ej. trip "2": una fila con dia_duty=6 el 1-sep-2026 (cola de un
  pairing que empezó en agosto) y otras 3 filas con dia_duty=1 el
  27-sep-2026 (un pairing DISTINTO que por coincidencia reusa el
  mismo número). Se corrige separando instancias por CADA VEZ que
  dia_duty retrocede (nunca debería bajar dentro del mismo pairing
  real) -> ver separar_instancias_trip().
"""

import sys
import json
import pandas as pd

sys.path.insert(0, r"C:\Users\Fernando\Documents\002.CHAMBA\LATAM\parings")
import generar_candidatos_nb as _nb  # noqa: E402  (import tras sys.path)
from generar_candidatos_nb import (   # noqa: E402
    filtrar_mes_y_ruta, armar_primeras_mitades, parse_hora, WD_ES,
)

# Lista de rutas actualizada según "Procedimiento_LCK_A320F_Flujograma_y_
# Paso_a_Paso.docx" (reunión Parte 4, 10-ago-2026), que coincide con el
# manual original (Parte 2) y reemplaza la que venía de un video más
# antiguo: quita IQT (excluida en 2 de 3 fuentes) y agrega TBP/TCQ.
# No se toca generar_candidatos_nb.py -> se sobrescriben sus constantes
# de módulo en tiempo de ejecución, sin modificar el archivo en disco.
_nb.RUTAS_VALIDAS_ARR = {"AQP", "CIX", "CJA", "CUZ", "PEM", "PIU", "TBP", "TPP", "TCQ"}
# Excepción real del mes: el propio documento confirma que en sept-2026
# se excluyó Arequipa (AQP) por el Perumín -> aplica exactamente al mes
# que se está procesando acá. Revisar cada mes si sigue vigente.
_nb.EXCLUSIONES_MES = {"AQP"}

# ----------------------------------------------------------------------
SRC_JSON = "tabla NB sub final.json"
MES_OBJETIVO = 9
ANIO_OBJETIVO = 2026


def cargar_json_a_df(path: str) -> pd.DataFrame:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    df = pd.DataFrame(data)
    df["trip"] = df["trip"].astype(str)
    df["dia_duty"] = df["dia_duty"].astype(int)
    df["fecha_dt"] = pd.to_datetime(df["inicio_vuelo_lt"])  # ISO "YYYY-MM-DD"
    df["std_td"] = df["std_hb"].apply(parse_hora)
    df["sta_td"] = df["sta_hb"].apply(parse_hora)
    df["hbt_td"] = df["hbt"].apply(parse_hora)
    df["std_dt"] = df["fecha_dt"] + df["std_td"]
    df["sta_dt"] = df["fecha_dt"] + df["sta_td"]
    df.loc[df["sta_dt"] < df["std_dt"], "sta_dt"] += pd.Timedelta(days=1)
    df["dia_semana"] = df["fecha_dt"].dt.day_name().map(WD_ES)
    return df


def separar_instancias_trip(df: pd.DataFrame) -> pd.DataFrame:
    """
    `trip` (pairing_id) se reutiliza entre pairings reales distintos en
    este export. Separa instancias: dentro de un mismo pairing real,
    dia_duty nunca debería retroceder (puede repetirse el mismo día
    para 2+ tramos, o saltar por un día de descanso, pero no bajar).
    Cada vez que baja, es un pairing NUEVO reusando el mismo número.

    Agrega:
      - "trip_original": el pairing_id tal cual vino de BigQuery (para
        mostrar al final).
      - "trip": se REEMPLAZA por una clave sintética única por instancia
        (ej. "2_0", "2_1") -> es la que usan filtrar_mes_y_ruta y
        armar_primeras_mitades para agrupar, sin que se mezclen.
    """
    df = df.sort_values(["trip", "fecha_dt", "std_dt"]).reset_index(drop=True)
    instancia = []
    trip_actual = None
    max_dia_duty = -1
    idx_instancia = 0
    for _, row in df.iterrows():
        if row["trip"] != trip_actual:
            trip_actual = row["trip"]
            idx_instancia = 0
            max_dia_duty = row["dia_duty"]
        elif row["dia_duty"] < max_dia_duty:
            idx_instancia += 1
            max_dia_duty = row["dia_duty"]
        else:
            max_dia_duty = max(max_dia_duty, row["dia_duty"])
        instancia.append(f"{row['trip']}_{idx_instancia}")

    df["trip_original"] = df["trip"]
    df["trip"] = instancia
    return df


def armar_tabla_nb(path: str, mes: int, anio: int):
    df = cargar_json_a_df(path)
    n_trips_crudos = df["trip"].nunique()

    df = separar_instancias_trip(df)
    n_instancias = df["trip"].nunique()

    dia_duty_min_real = df.groupby("trip")["dia_duty"].min()  # ANTES de filtrar
    df_filtrado = filtrar_mes_y_ruta(df, mes, anio)
    validos, excluidos = armar_primeras_mitades(df_filtrado, dia_duty_min_real)

    # recuperar el pairing_id ORIGINAL de BigQuery para mostrar (no la clave sintética)
    mapa_original = df.drop_duplicates("trip").set_index("trip")["trip_original"]
    if len(validos):
        validos.insert(2, "Pairing ID (BigQuery)", validos["Pairing ID"].map(mapa_original))

    return validos, excluidos, n_trips_crudos, n_instancias


if __name__ == "__main__":
    validos, excluidos, n_trips_crudos, n_instancias = armar_tabla_nb(SRC_JSON, MES_OBJETIVO, ANIO_OBJETIVO)
    print(f"Trip IDs crudos (BigQuery, pueden repetirse): {n_trips_crudos}")
    print(f"Instancias de pairing reales detectadas: {n_instancias}")
    print(f"Candidatos válidos (día 1 real, reglas 2.9-2.14): {len(validos)}")
    print(f"Excluidos: {len(excluidos)}")
    validos.to_excel("Candidatos_NB_desde_BigQuery.xlsx", index=False)
    print("Guardado: Candidatos_NB_desde_BigQuery.xlsx")
