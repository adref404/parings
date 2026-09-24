"""
Arma el archivo final de bloques NB (4 filas = 2 pairings encadenados =
1 día de instructor) a partir de los candidatos de BigQuery, reutilizando
SIN MODIFICAR `parear_candidatos` y `construir_bloques_nb` de
../generar_reporte_pairings_nb.py.

Usa como entrada los 555 candidatos ya corregidos por armar_tabla_nb.py
(ruta lista actualizada según el documento "Procedimiento_LCK_A320F...",
+ excepción de AQP por el Perumín en sept-2026).

OJO (limitación conocida, no corregida a propósito para no tocar el
código reusado): la columna "Pairing ID" que se muestra en los bloques
es la CLAVE SINTÉTICA de instancia (ej. "65_0"), no el número de trip
crudo de BigQuery, porque ese número se reutiliza entre pairings reales
distintos (ver armar_tabla_nb.py) y el emparejamiento necesita una
clave única de verdad para no confundir instancias. El número real de
BigQuery sigue disponible en Candidatos_NB_desde_BigQuery.xlsx, columna
"Pairing ID (BigQuery)", por si hace falta cruzarlo.

Pensado para copiarse a Colab.
"""

import sys
import pandas as pd

sys.path.insert(0, r"C:\Users\Fernando\Documents\002.CHAMBA\LATAM\parings")
from generar_reporte_pairings_nb import parear_candidatos, construir_bloques_nb  # noqa: E402

from armar_tabla_nb import armar_tabla_nb, SRC_JSON, MES_OBJETIVO, ANIO_OBJETIVO  # noqa: E402

OUT = r"Pairings_NB_desde_BigQuery.xlsx"
N_MUESTRA = None  # None = todos los bloques


if __name__ == "__main__":
    validos, excluidos, n_trips_crudos, n_instancias = armar_tabla_nb(SRC_JSON, MES_OBJETIVO, ANIO_OBJETIVO)
    bloques = parear_candidatos(validos)

    n_parejas = sum(1 for _, b in bloques if b is not None)
    n_solos = sum(1 for _, b in bloques if b is None)

    construir_bloques_nb(bloques, OUT, n_muestra=N_MUESTRA)

    print(f"Trip IDs crudos (BigQuery): {n_trips_crudos}")
    print(f"Instancias de pairing reales: {n_instancias}")
    print(f"Candidatos válidos: {len(validos)}")
    print(f"Bloques armados: {len(bloques)} ({n_parejas} con 2 pairings, {n_solos} sin pareja)")
    print(f"Archivo generado: {OUT}")
