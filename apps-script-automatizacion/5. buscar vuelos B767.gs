/*
Dos funciones en este archivo:

1. `seleccionarTripulantesB767()` — Archivo 9 (PROGRAMAR=Sí) -> Archivo 10 (ya construida y
   probada, ver más abajo).
2. `armarPairingsVuelosB767()` — NUEVA (2026-10-02): consulta BigQuery, filtra los pairings
   B767 válidos del mes y arma las hojas "Vuelos" y "Resumen" en el archivo
   `1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY` (confirmado por Fernando — mismo archivo que
   va a tener, a futuro, las 6 hojas de B767/B787/A320). Es la transformación a Apps Script de
   la lógica ya validada en `generar_reporte_pairings.py` /
   `automatizacion_bigquery/Automatizacion_WB_Fase3_Asignacion_Instructor_Vuelos.ipynb` — NO
   asigna instructor todavía (esa regla viene después, por equidad de pernoctes, que Fernando
   confirmó que ni él ni yo tenemos el histórico todavía para automatizar — queda pendiente).

   **Importante — sin probar contra la BigQuery Advanced Service real:** el filtrado y el
   armado de hojas se probaron con un mock de Node.js que imita la forma documentada de la
   respuesta de `BigQuery.Jobs.query()` (campos `rows[].f[].v` como strings, fechas
   DATETIME/DATE/TIME de BigQuery como texto) — pero el formato EXACTO de esos strings puede
   variar un poco según la versión de la API. Si al correrlo ves un error de parseo de fecha/
   hora, o un número de pairings claramente distinto al esperado, avísame con el mensaje de
   error o una fila de ejemplo (`Logger.log` ya deja impresas las primeras filas crudas) para
   ajustar el parser — mismo tipo de ida y vuelta que tuvimos en Colab la primera vez que corrió
   contra datos reales.

### Qué hace `seleccionarTripulantesB767()`
1. Lee Archivo 9, pestaña "LCK 767" (gid=1437673054): busca la fila real de encabezados
   buscando "BP" y "PROGRAMAR" (sin distinguir mayúsculas/minúsculas ni espacios — en esta
   hoja el encabezado real dice "Programar", no "PROGRAMAR"; en la de B787 sí está en
   mayúsculas, por eso la búsqueda no puede ser exacta). No asume una fila fija porque la hoja
   trae varias filas de títulos/notas (REENT+RECA, etc.) arriba del encabezado real.
2. Junta los BP cuyo PROGRAMAR sea "Si"/"Sí" (sin distinguir mayúsculas/tildes).
3. Escribe esos BP en Archivo 10, pestaña "prueba de LCK 767" (gid=1025385274), columna A,
   empezando en la fila 4 (confirmado por Fernando).
4. Si la nueva lista es más corta que la anterior, limpia las filas sobrantes de la columna A
   (para no dejar BPs viejos colgando).

### Importante — confirmar antes de usar en serio
- Solo escribe la columna A (BP). Si tienes otras columnas (CAT, Vigencia, etc.) llenadas a
  mano o por fórmula para cada fila, **revisa que sigan alineadas** después de correr esto: si
  el orden de los tripulantes con PROGRAMAR=Sí cambió en Archivo 9 respecto a la corrida
  anterior, las filas de Archivo 10 se reordenan junto con el BP.
- No toca la Matriz (reserva de instructor/día) ni asigna "coordinador" — eso es la regla que
  falta que Fernando indique.
*/

// ============================================================================
// 0. CALCULAR "Programar" (Sí/No) en Archivo 9, a partir de las vigencias
// ============================================================================
//
// Confirmado por Fernando (2026-10-02): la columna "Programar" de Archivo 9 estaba quedando
// ESTÁTICA (pegada del mes en que se escribió a mano), mientras que las columnas de vigencia
// (D/E/F: "Vig. RTI B767" / "Vig. LC B767" / "Vig. UV B767") sí se actualizan solas cada mes
// (jalan de otra hoja índice). Hace falta CALCULAR Programar en vez de dejarlo fijo.
//
// **Mi interpretación de la lógica (no confirmada rato por rato, corregir si no calza)** —
// basada en los rótulos reales de la hoja ("NO PROGRAMAR A LOS QUE TENGAN REVA VENCIDA" sobre
// la columna Programar, y "VERIFICAR CRUCE RECA / VCNTO LCK" sobre D/E/F):
//   - El disparador principal es **"Vig. LC B767" (columna E, resaltada en amarillo en tu
//     hoja)** — LC = Line Check, que es justo lo que se reserva con este proceso. Si esa
//     vigencia ya venció o vence EN EL MES ACTUAL (comparado contra la fecha de hoy, no un mes
//     fijo -> así se actualiza solo cada mes sin tocar código), la persona necesita que se le
//     programe un LCK -> candidato a "Sí".
//   - PERO si "Vig. RTI B767" (columna D) ya está VENCIDA (estrictamente en el pasado, no solo
//     "vence este mes") -> se fuerza "No" sin importar LC, siguiendo el rótulo "NO PROGRAMAR A
//     LOS QUE TENGAN REVA VENCIDA" (RTI = revalidación de seguridad, igual criterio que ya usa
//     `4. RTI copia.gs`).
//   - "Vig. UV B767" (columna F) no la uso para esta decisión por ahora (no encontré un rótulo
//     que diga qué hacer con ella) -> si tiene un rol, avisar para agregarlo.
//   - Si algún valor no se puede leer como "mes-año" (ej. "#N/A", vacío) se trata como NO
//     determinable -> se deja "No" y se cuenta aparte en el resumen final (no se inventa).
//
// Formato esperado de las celdas de vigencia: abreviatura de mes en español + "-" + año de 2
// dígitos (ej. "ago-27", "sept-26", "oct-26") — el mismo formato visible en tu captura.
function calcularProgramarB767() {
  var ID_ARCHIVO_9 = "1d95aUJtNVAtHd3tECTcsc2WHM8b557Jbl1DcCDsJGuo";
  var GID_ARCHIVO_9 = 1427213307; // pestaña "LCK 767" viva

  calcularProgramarWB_(ID_ARCHIVO_9, GID_ARCHIVO_9, "Vig. RTI B767", "Vig. LC B767", "767");
}

// Genérico (lo reutiliza B787 con sus propios nombres de columna) para no duplicar el parseo de
// fechas ni la lógica de decisión -> un solo lugar que corregir si la regla cambia.
function calcularProgramarWB_(idArchivo9, gidArchivo9, nombreColRTI, nombreColLC, etiquetaFlota) {
  var ss = SpreadsheetApp.openById(idArchivo9);
  var hoja = ss.getSheets().find(function (h) { return h.getSheetId() === gidArchivo9; });
  if (!hoja) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + gidArchivo9 + " en Archivo 9 (" + etiquetaFlota + ").");
    return;
  }

  var valores = hoja.getDataRange().getValues();

  // Búsqueda por CONTIENE (no exacta): la columna de RTI en tu captura aparece como "Vig. RTI
  // B76" (parece faltarle el "7" final, truncado o typo real en la hoja) -> en vez de exigir el
  // nombre exacto, alcanza con que el encabezado contenga "VIG" + "RTI" (o "VIG" + "LC" para la
  // de Line Check), así tolera ese tipo de variación sin depender del texto exacto.
  var filaHeaderIdx = -1, colRTI = -1, colLC = -1, colProgramar = -1;
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    var idxRTI = indiceColumnaPorHeaderContiene_(fila, ["VIG", "RTI"]);
    var idxLC = indiceColumnaPorHeaderContiene_(fila, ["VIG", "LC"]);
    var idxProg = indiceColumnaPorHeaderGenerico_(fila, "Programar");
    if (idxRTI !== -1 && idxLC !== -1 && idxProg !== -1) {
      filaHeaderIdx = i; colRTI = idxRTI; colLC = idxLC; colProgramar = idxProg;
      break;
    }
  }
  if (filaHeaderIdx === -1) {
    SpreadsheetApp.getUi().alert("No encontré las columnas '" + nombreColRTI + "' / '" + nombreColLC + "' / 'Programar' en Archivo 9 (" + etiquetaFlota + ") -> revisar encabezados reales.");
    return;
  }

  var hoy = new Date();
  var hoyAnio = hoy.getFullYear(), hoyMes = hoy.getMonth() + 1;

  var columnaProgramar = [];
  var contadorSi = 0, contadorNo = 0, contadorNoDeterminable = 0;

  for (var r = filaHeaderIdx + 1; r < valores.length; r++) {
    var fila2 = valores[r];
    if (!fila2.some(function (v) { return String(v || "").trim() !== ""; })) {
      columnaProgramar.push([valores[r][colProgramar]]); // fila vacía -> no tocar
      continue;
    }

    var vigRTI = parsearMesAnioAbrev_(fila2[colRTI]);
    var vigLC = parsearMesAnioAbrev_(fila2[colLC]);

    if (!vigRTI || !vigLC) {
      columnaProgramar.push(["No"]);
      contadorNoDeterminable++;
      continue;
    }

    var rtiVencida = (vigRTI.anio < hoyAnio) || (vigRTI.anio === hoyAnio && vigRTI.mes < hoyMes);
    var lcVencidaOPorVencer = (vigLC.anio < hoyAnio) || (vigLC.anio === hoyAnio && vigLC.mes <= hoyMes);

    var programar = (!rtiVencida && lcVencidaOPorVencer) ? "Si" : "No";
    columnaProgramar.push([programar]);
    if (programar === "Si") contadorSi++; else contadorNo++;
  }

  var rango = hoja.getRange(filaHeaderIdx + 2, colProgramar + 1, columnaProgramar.length, 1);
  rango.setValues(columnaProgramar);

  SpreadsheetApp.getUi().alert(
    "Programar (" + etiquetaFlota + ") recalculado.\n" +
    "Sí: " + contadorSi + "\n" +
    "No: " + contadorNo + "\n" +
    "No determinable (vigencia ilegible, ej. '#N/A' -> se dejó 'No'): " + contadorNoDeterminable + "\n\n" +
    "Lógica usada: 'Sí' si " + nombreColLC + " está vencida o vence este mes Y " + nombreColRTI + " NO está vencida (estrictamente en el pasado). Revisa si esto coincide con tu criterio real."
  );
}

var MESES_ABREV_ES_ = {
  "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7,
  "ago": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dic": 12,
};

// BUG REAL encontrado 2026-10-02 (reportado por Fernando: 321 de 321 filas salían "no
// determinable"): las celdas "ago-27"/"feb-26"/etc. de las vigencias son, otra vez, objetos
// `Date` reales con un formato de visualización "mmm-aa" aplicado — NO texto plano — mismo
// patrón que ya rompió el cruce de fechas de la Matriz. `String(unaFecha)` nunca da "ago-27",
// da algo como "Sun Aug 01 2027 ...". Se revisa `instanceof Date` primero, igual que
// `parsearFechaCelda_`.
function parsearMesAnioAbrev_(valor) {
  if (valor instanceof Date) {
    return { anio: valor.getFullYear(), mes: valor.getMonth() + 1 };
  }
  var s = String(valor || "").trim().toLowerCase();
  var m = s.match(/^([a-záéíóú]+)\.?-?\s*(\d{2,4})$/);
  if (!m) return null;
  var mes = MESES_ABREV_ES_[m[1]];
  if (!mes) return null;
  var anioTxt = m[2];
  var anio = anioTxt.length === 2 ? 2000 + parseInt(anioTxt, 10) : parseInt(anioTxt, 10);
  return { anio: anio, mes: mes };
}

function seleccionarTripulantesB767() {
  var ID_ARCHIVO_9 = "1d95aUJtNVAtHd3tECTcsc2WHM8b557Jbl1DcCDsJGuo";
  var GID_ARCHIVO_9 = 1427213307; // pestaña "LCK 767" VIVA (gid corregido 2026-10-02 — el anterior, 1437673054, era "Copia de 9. Programación..." estática)

  var ID_ARCHIVO_10 = "1NZN565fOJUtoETQvvPzdHpRvyHp4stY2hsrqtjNjSEU";
  var GID_ARCHIVO_10 = 1025385274; // pestaña "prueba de LCK 767"

  var FILA_INICIO_BP_ARCHIVO_10 = 4; // confirmado: BP se pega desde la fila 4

  var ssArchivo9 = SpreadsheetApp.openById(ID_ARCHIVO_9);
  var hojaArchivo9 = ssArchivo9.getSheets().find(function (h) { return h.getSheetId() === GID_ARCHIVO_9; });
  if (!hojaArchivo9) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + GID_ARCHIVO_9 + " en Archivo 9.");
    return;
  }

  var valoresA9 = hojaArchivo9.getDataRange().getValues();

  // Buscar la columna cuyo encabezado sea exactamente `nombre`, ignorando mayúsculas/minúsculas
  // y espacios extra (la hoja real tiene "Programar" en una pestaña y "PROGRAMAR" en otra).
  function indiceColumnaPorHeader(fila, nombre) {
    var buscado = nombre.trim().toUpperCase();
    for (var j = 0; j < fila.length; j++) {
      if (String(fila[j] || "").trim().toUpperCase() === buscado) return j;
    }
    return -1;
  }

  // Buscar la fila real de encabezado (puede haber notas/títulos arriba, ej. "VER SI
  // CORRESPONDE REENT + RECA") -> no asumir una fila fija.
  var filaHeaderIdx = -1;
  var colBP = -1, colProgramar = -1;
  for (var i = 0; i < valoresA9.length; i++) {
    var fila = valoresA9[i];
    var idxBP = indiceColumnaPorHeader(fila, "BP");
    var idxProgramar = indiceColumnaPorHeader(fila, "Programar");
    if (idxBP !== -1 && idxProgramar !== -1) {
      filaHeaderIdx = i;
      colBP = idxBP;
      colProgramar = idxProgramar;
      break;
    }
  }

  if (filaHeaderIdx === -1) {
    SpreadsheetApp.getUi().alert("No encontré una fila con 'BP' y 'PROGRAMAR' en Archivo 9 (LCK 767) -> revisar estructura real de la hoja.");
    return;
  }

  var bpsDemanda = [];
  for (var r = filaHeaderIdx + 1; r < valoresA9.length; r++) {
    var filaDatos = valoresA9[r];
    var bp = String(filaDatos[colBP] || "").replace(/^'/, "").trim();
    var programar = String(filaDatos[colProgramar] || "").trim().toLowerCase();
    if (!bp) continue;
    if (programar === "si" || programar === "sí") {
      bpsDemanda.push(bp);
    }
  }

  var ssArchivo10 = SpreadsheetApp.openById(ID_ARCHIVO_10);
  var hojaArchivo10 = ssArchivo10.getSheets().find(function (h) { return h.getSheetId() === GID_ARCHIVO_10; });
  if (!hojaArchivo10) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + GID_ARCHIVO_10 + " en Archivo 10.");
    return;
  }

  // Limpiar filas viejas de la columna A (por si la nueva lista es más corta que la anterior).
  var ultimaFilaConDatos = hojaArchivo10.getLastRow();
  if (ultimaFilaConDatos >= FILA_INICIO_BP_ARCHIVO_10) {
    var numFilasABorrar = ultimaFilaConDatos - FILA_INICIO_BP_ARCHIVO_10 + 1;
    hojaArchivo10.getRange(FILA_INICIO_BP_ARCHIVO_10, 1, numFilasABorrar, 1).clearContent();
  }

  if (bpsDemanda.length > 0) {
    var valoresBP = bpsDemanda.map(function (bp) { return [Number(bp)]; });
    var rangoDestino = hojaArchivo10.getRange(FILA_INICIO_BP_ARCHIVO_10, 1, valoresBP.length, 1);
    rangoDestino.setNumberFormat("0"); // forzar NUMERO, evita el bug de apóstrofe/texto vs VLOOKUP numérico
    rangoDestino.setValues(valoresBP);
  }

  SpreadsheetApp.getUi().alert(
    "Selección B767 completada.\n" +
    "Tripulantes con PROGRAMAR = Sí: " + bpsDemanda.length + "\n" +
    "BP pegados en '" + hojaArchivo10.getName() + "' desde la fila " + FILA_INICIO_BP_ARCHIVO_10 + "."
  );
}

// ============================================================================
// 2. BÚSQUEDA DE VUELOS (pairings B767) + hojas "Vuelos" y "Resumen"
// ============================================================================

function armarPairingsVuelosB767() {
  var PROJECT_ID_FACTURACION = "datadem-home"; // mismo que Colab; avisar si usas otro
  var MES_OBJETIVO = 10;
  var ANIO_OBJETIVO = 2026;
  var CUPOS_POR_VUELO = 5; // 1 TJ + 4 TC (confirmado)

  var ID_ARCHIVO_DESTINO = "1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY";
  var NOMBRE_HOJA_VUELOS = "Vuelos";
  var NOMBRE_HOJA_RESUMEN = "Resumen";

  var filasCrudas = consultarBigQueryWB767_(PROJECT_ID_FACTURACION, MES_OBJETIVO, ANIO_OBJETIVO);
  Logger.log("Filas crudas descargadas: " + filasCrudas.length);
  if (filasCrudas.length > 0) Logger.log("Ejemplo de fila cruda: " + JSON.stringify(filasCrudas[0]));

  var resultado = cargarYFiltrarWB_(filasCrudas, MES_OBJETIVO, ANIO_OBJETIVO);
  var validos = resultado.validos;
  var incompletos = resultado.incompletos;
  Logger.log("Piernas válidas: " + validos.length + " | pairings incompletos descartados: " + incompletos.length);

  var pairingsPorPk = armarPairingsPorPk_(validos);
  var pks = Object.keys(pairingsPorPk);
  Logger.log("Pairings B767 completos armados: " + pks.length);

  var ss = SpreadsheetApp.openById(ID_ARCHIVO_DESTINO);
  var hojaVuelos = obtenerOCrearHoja_(ss, NOMBRE_HOJA_VUELOS);
  var hojaResumen = obtenerOCrearHoja_(ss, NOMBRE_HOJA_RESUMEN);

  var infoBloques = escribirHojaVuelosB767_(hojaVuelos, pairingsPorPk, CUPOS_POR_VUELO);
  escribirHojaResumenB767_(hojaResumen, infoBloques, NOMBRE_HOJA_VUELOS);

  SpreadsheetApp.getUi().alert(
    "Búsqueda de vuelos B767 completada.\n" +
    "Pairings válidos encontrados: " + pks.length + "\n" +
    "Pairings incompletos descartados (1 sola pierna): " + Object.keys(groupByPk_(incompletos)).length + "\n" +
    "Hojas '" + NOMBRE_HOJA_VUELOS + "' y '" + NOMBRE_HOJA_RESUMEN + "' actualizadas en el archivo de pairings.\n" +
    "(Actividad ya quedó fija en 'LCK B767'. Corre asignarInstructoresPorEquidadB767() para llenar Instructor, y luego subirAsignacionesAVisualB767() para subirlo a la matriz visual.)"
  );
}

function obtenerOCrearHoja_(ss, nombre) {
  var hoja = ss.getSheetByName(nombre);
  if (hoja) {
    hoja.clear();
  } else {
    hoja = ss.insertSheet(nombre);
  }
  return hoja;
}

function groupByPk_(filas) {
  var out = {};
  filas.forEach(function (f) { out[f._pk] = true; });
  return out;
}

// ---- BigQuery ----

function consultarBigQueryWB767_(projectId, mesObjetivo, anioObjetivo) {
  var query = [
    "SELECT",
    "  pairing_id                       AS trip,",
    "  pairing_start_date               AS fecha_inicio_trip,",
    "  flight_start_date_local_time     AS inicio_vuelo_lt,",
    "  flight_month_description         AS mes,",
    "  duty_calendar_day_number         AS dia_duty,",
    "  flight_number                    AS vuelo,",
    "  departure_airport_code           AS dep,",
    "  arrival_airport_code             AS arr,",
    "  flight_departure_time_crew_base  AS std_hb,",
    "  flight_arrival_hour_block_time   AS sta_hb,",
    "  flight_block_time                AS hbt,",
    "  subfleet_code                    AS sub_fleet,",
    "  is_crew_passenger                AS pax,",
    "  duty_presentation_date_at        AS presentacion_duty_date_lt",
    "FROM `operations-data-prod.carmen_gold.crew_pairing_carmen_system`",
    "WHERE",
    "  flight_start_date_local_time BETWEEN DATE '2026-09-01' AND DATE '2026-10-31'",
    "  AND subsidiary_code IN ('LP')",
    "  AND load_type_code = 'FP'",
    "  AND crew_range_type_code = 'SAB'",
    "  AND subfleet_code IN ('763')", // B767 (corregido el typo '762' de consulta BQ WB.sql)
    "QUALIFY",
    "  CASE",
    "    WHEN load_type_code = 'FP' AND",
    "         DATE(ingestion_datetime) = MAX(CASE WHEN load_type_code = 'FP' THEN DATE(ingestion_datetime) END)",
    "           OVER (PARTITION BY subsidiary_code, fleet_type_code, crew_range_type_code,",
    "                              reference_month_number, reference_year)",
    "      THEN 0",
    "    WHEN load_type_code = 'ES' AND",
    "         MAX(CASE WHEN load_type_code = 'FP' THEN 0 ELSE 0 END)",
    "           OVER (PARTITION BY subsidiary_code, fleet_type_code, crew_range_type_code,",
    "                              reference_month_number, reference_year) = -1 AND",
    "         DATE(ingestion_datetime) = MAX(CASE WHEN load_type_code = 'ES' THEN DATE(ingestion_datetime) END)",
    "           OVER (PARTITION BY subsidiary_code, fleet_type_code, crew_range_type_code,",
    "                              reference_month_number, reference_year)",
    "      THEN 0",
    "    ELSE -1",
    "  END = 0",
    "ORDER BY pairing_id ASC",
  ].join("\n");

  var request = { query: query, useLegacySql: false, timeoutMs: 30000 };
  var resultado = BigQuery.Jobs.query(request, projectId);
  var jobId = resultado.jobReference.jobId;

  while (!resultado.jobComplete) {
    Utilities.sleep(1000);
    resultado = BigQuery.Jobs.getQueryResults(projectId, jobId);
  }

  var nombresCampos = resultado.schema.fields.map(function (f) { return f.name; });

  function filaAObjeto(fila) {
    var obj = {};
    for (var i = 0; i < nombresCampos.length; i++) {
      obj[nombresCampos[i]] = fila.f[i].v;
    }
    return obj;
  }

  var filas = (resultado.rows || []).map(filaAObjeto);
  var pageToken = resultado.pageToken;
  while (pageToken) {
    var pagina = BigQuery.Jobs.getQueryResults(projectId, jobId, { pageToken: pageToken });
    filas = filas.concat((pagina.rows || []).map(filaAObjeto));
    pageToken = pagina.pageToken;
  }

  return filas;
}

// ---- Parseo de fechas/horas que vienen de BigQuery como texto ----
// BigQuery REST devuelve DATETIME/DATE/TIME como strings; el separador fecha/hora puede venir
// con "T" o con espacio según la versión de la API -> se aceptan ambos. AVISAR si algún campo
// viene en otro formato (ej. TIMESTAMP como epoch numérico) para ajustar esto.
function parsearFechaHoraBQ_(valor) {
  if (!valor) return null;
  var texto = String(valor).trim().replace(" ", "T");
  var partes = texto.split("T");
  var fechaParte = partes[0];
  var horaParte = partes[1] || "00:00:00";
  var fp = fechaParte.split("-");
  var hp = horaParte.split(":");
  var seg = hp[2] ? parseFloat(hp[2]) : 0;
  return new Date(
    parseInt(fp[0], 10), parseInt(fp[1], 10) - 1, parseInt(fp[2], 10),
    parseInt(hp[0], 10), parseInt(hp[1], 10), Math.floor(seg)
  );
}

function parsearFechaBQ_(valor) {
  if (!valor) return null;
  var fp = String(valor).trim().split("-");
  return new Date(parseInt(fp[0], 10), parseInt(fp[1], 10) - 1, parseInt(fp[2], 10));
}

function formatearDDMMYYYY_(d) {
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  return dd + "/" + mm + "/" + d.getFullYear();
}

var DIAS_SEMANA_ES_ = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
var DIAS_OK_ = { domingo: false, lunes: true, martes: true, "miércoles": true, jueves: true, viernes: true, "sábado": false };
var ALLOWED_ROUTES_ = {
  "LIM|MIA": true, "MIA|LIM": true, "LIM|SCL": true, "SCL|LIM": true,
};
var ALLOWED_FLIGHTS_ = { 2480: true, 2481: true, 2695: true, 2694: true, 2698: true, 2699: true, 2413: true, 2412: true, 2697: true, 2696: true };

// ---- Filtrado (puerto de `generar_reporte_pairings.py` / `cargar_y_filtrar_wb`) ----
function cargarYFiltrarWB_(filasCrudas, mesObjetivo, anioObjetivo) {
  // 1. Normalizar cada pierna
  var piernas = filasCrudas.map(function (f) {
    var fechaVueloDt = parsearFechaHoraBQ_(f.inicio_vuelo_lt);
    var fechaPresDt = parsearFechaHoraBQ_(f.presentacion_duty_date_lt);
    var diaSemanaVuelo = DIAS_SEMANA_ES_[fechaVueloDt.getDay()];
    var diaSemanaPres = fechaPresDt ? DIAS_SEMANA_ES_[fechaPresDt.getDay()] : null;
    return {
      _pk: String(f.trip) + "|" + String(f.fecha_inicio_trip),
      trip: String(f.trip),
      fechaVueloDt: fechaVueloDt,
      diaSemana: diaSemanaVuelo,
      diaDuty: parseInt(f.dia_duty, 10),
      vuelo: parseInt(f.vuelo, 10),
      dep: f.dep, arr: f.arr,
      std: f.std_hb, sta: f.sta_hb, hbt: f.hbt,
      subFleet: String(f.sub_fleet),
      legDiaOk: !!DIAS_OK_[diaSemanaVuelo],
      legPresOk: diaSemanaPres !== "domingo",
      legRutaOk: !!ALLOWED_ROUTES_[f.dep + "|" + f.arr] && !!ALLOWED_FLIGHTS_[parseInt(f.vuelo, 10)],
    };
  });

  // 2. Agrupar por _pk
  var porPk = {};
  piernas.forEach(function (p) {
    (porPk[p._pk] = porPk[p._pk] || []).push(p);
  });

  var validos = [];
  var incompletosPks = {};

  Object.keys(porPk).forEach(function (pk) {
    var grupo = porPk[pk];
    var diaOk = grupo.every(function (p) { return p.legDiaOk; });
    var presOk = grupo.every(function (p) { return p.legPresOk; });
    var rutaOk = grupo.every(function (p) { return p.legRutaOk; });

    var minDiaDuty = Math.min.apply(null, grupo.map(function (p) { return p.diaDuty; }));
    var primeraPierna = grupo.filter(function (p) { return p.diaDuty === minDiaDuty; })[0];
    var mesOk = primeraPierna.fechaVueloDt.getMonth() + 1 === mesObjetivo &&
                primeraPierna.fechaVueloDt.getFullYear() === anioObjetivo;

    var diaDutyVals = grupo.map(function (p) { return p.diaDuty; })
      .filter(function (v, i, arr) { return arr.indexOf(v) === i; })
      .sort(function (a, b) { return a - b; });
    var rangoOk = diaDutyVals.length > 0 && (diaDutyVals[diaDutyVals.length - 1] - diaDutyVals[0]) <= 2;
    var contiguo = true;
    for (var i = 1; i < diaDutyVals.length; i++) {
      if (diaDutyVals[i] - diaDutyVals[i - 1] !== 1) { contiguo = false; break; }
    }
    var diaDutyOk = rangoOk && contiguo;

    var tripValido = diaOk && mesOk && presOk && rutaOk && diaDutyOk;

    if (tripValido) {
      grupo.sort(function (a, b) { return a.diaDuty - b.diaDuty; });
      grupo.forEach(function (p) { validos.push(p); });
    }
  });

  // 3. Descartar pairings con menos de 2 piernas (ej. ida sin vuelta por corte de mes en BQ)
  var countPorPk = {};
  validos.forEach(function (p) { countPorPk[p._pk] = (countPorPk[p._pk] || 0) + 1; });

  var validosCompletos = [];
  var incompletos = [];
  validos.forEach(function (p) {
    if (countPorPk[p._pk] >= 2) validosCompletos.push(p);
    else incompletos.push(p);
  });

  return { validos: validosCompletos, incompletos: incompletos };
}

function armarPairingsPorPk_(validos) {
  var porPk = {};
  validos.forEach(function (p) {
    (porPk[p._pk] = porPk[p._pk] || []).push(p);
  });
  var out = {};
  Object.keys(porPk).forEach(function (pk) {
    var piernas = porPk[pk].sort(function (a, b) { return a.diaDuty - b.diaDuty; });
    if (piernas.length === 2) out[pk] = piernas; // formato esperado: ida + vuelta
    // si algún día aparece un pairing de 3 piernas, queda fuera -> revisar manualmente (no se asume)
  });
  return out;
}

// Confirmado por Fernando (2026-10-02): esta hoja "Vuelos" es SOLO para buscar vuelos de LCK
// B767 -> la única actividad válida es "LCK B767" (nada de Reentrenamiento/Chequeo/etc. acá),
// así que se escribe directo en vez de dejar un desplegable para elegir a mano.
var ACTIVIDAD_UNICA_B767_ = "LCK B767";

// Instructores IDE B767 = OK, leídos en vivo del Rol de Instructores (mismo criterio que
// `seleccionarTripulantesB767`, para no duplicar una lista fija que se desactualiza).
function obtenerInstructoresIdeB767_() {
  var ID_ROL = "1yMvgb_O4qxpCCE4bAqD4XhW2GQI9ZObf2EAnymXaReE";
  var GID_ROL = 1933640306;
  var ss = SpreadsheetApp.openById(ID_ROL);
  var hoja = ss.getSheets().find(function (h) { return h.getSheetId() === GID_ROL; });
  if (!hoja) return [];

  var valores = hoja.getDataRange().getValues();
  if (valores.length === 0) return [];
  var header = valores[0];
  var colIde = header.indexOf("IDE B767");
  var colNombre = header.indexOf("Nombre");
  if (colIde === -1 || colNombre === -1) return [];

  var nombres = [];
  for (var i = 1; i < valores.length; i++) {
    var ide = String(valores[i][colIde] || "").trim().toUpperCase();
    var nombre = String(valores[i][colNombre] || "").trim();
    if (ide === "OK" && nombre) nombres.push(nombre);
  }
  return nombres;
}

// ---- Hoja "Vuelos" (puerto de `construir_reporte_bloques`, SIN asignar instructor) ----
// Layout real de columnas (empieza en B): B=Pairing ID, C=FECHA REAL, D=Day of Week,
// E=Flight No, F=Dep Stn, G=Arr Stn, H=STD, I=STA, J=AC Type, K=HBT, L=DIA_DUTY.
//
// IMPORTANTE DE RENDIMIENTO: la primera versión de esta función hacía una llamada a
// `getRange().setXxx()` POR CADA celda/nota/validación/color (cientos de llamadas para 30
// pairings) -> Apps Script se queda "cargando" varios minutos porque cada llamada es un
// round-trip a la API de Sheets. Se reescribió para armar todo en memoria (arrays del tamaño
// de toda la hoja) y escribir con un puñado de llamadas `setValues/setBackgrounds/setFontWeights/
// setNotes/setDataValidations` al final — mismo patrón "cargar a memoria, escribir una vez" que
// ya usa `4. RTI copia.gs`.
function escribirHojaVuelosB767_(hoja, pairingsPorPk, cuposPorVuelo) {
  var HEADERS = ["Pairing ID", "FECHA REAL", "Day of Week", "Flight No", "Dep Stn", "Arr Stn",
    "STD", "STA", "AC Type", "HBT", "DIA_DUTY"];
  var COL_INSTRUCTOR = 15; // O
  var COL_ACTIVIDAD = 17;  // Q
  var NUM_COLS = 17; // hasta Q

  var nombresInstructores = obtenerInstructoresIdeB767_();
  var reglaInstructor = nombresInstructores.length > 0
    ? SpreadsheetApp.newDataValidation().requireValueInList(nombresInstructores, true).setAllowInvalid(true).build()
    : null;

  // Primero se calculan TODAS las posiciones de fila (sin tocar la hoja todavía) para saber
  // cuántas filas en total hacen falta y poder armar los arrays del tamaño correcto.
  var pks = Object.keys(pairingsPorPk);
  var posiciones = [];
  var fila = 5;
  pks.forEach(function (pk) {
    var preRow = fila - 1, headerRow = fila, leg1Row = fila + 1, leg2Row = fila + 2,
        postRow1 = fila + 3, postRow2 = fila + 4;
    posiciones.push({ pk: pk, preRow: preRow, headerRow: headerRow, leg1Row: leg1Row, leg2Row: leg2Row, postRow1: postRow1, postRow2: postRow2 });
    fila = postRow2 + 1 + 2;
  });
  var numFilas = Math.max(fila - 1, 3);

  // Arrays del tamaño completo de la hoja (filas x NUM_COLS), 1-indexados restando 1 al mapear.
  function gridVacio(valorPorDefecto) {
    var g = [];
    for (var r = 0; r < numFilas; r++) {
      var fila2 = [];
      for (var c = 0; c < NUM_COLS; c++) fila2.push(valorPorDefecto);
      g.push(fila2);
    }
    return g;
  }
  var contenido = gridVacio("");
  var fondos = gridVacio(null);
  var pesos = gridVacio("normal");
  var notas = gridVacio("");
  var validaciones = gridVacio(null);

  function set(grid, row1, col1, val) { grid[row1 - 1][col1 - 1] = val; }

  set(contenido, 1, 2, "Comenzar asignando vuelos los Jueves y Viernes (porque el SAB es DO)");
  set(pesos, 1, 2, "bold");
  set(contenido, 2, 2, "LCK de ida (porque va OP) y de retorno DGAC o RECA");
  set(pesos, 2, 2, "bold");

  var infoBloques = []; // {pk, filaHeader, filaIda, filaVuelta, cupos}

  posiciones.forEach(function (pos) {
    var piernas = pairingsPorPk[pos.pk];
    var ida = piernas[0], vta = piernas[1];
    var preRow = pos.preRow, headerRow = pos.headerRow, leg1Row = pos.leg1Row,
        leg2Row = pos.leg2Row, postRow1 = pos.postRow1, postRow2 = pos.postRow2;

    for (var j = 0; j < HEADERS.length; j++) {
      set(contenido, headerRow, 2 + j, HEADERS[j]);
      set(pesos, headerRow, 2 + j, "bold");
    }

    set(fondos, headerRow, COL_INSTRUCTOR, "#FFC000");
    set(pesos, headerRow, COL_INSTRUCTOR, "bold");
    set(notas, headerRow, COL_INSTRUCTOR, "Elegir el instructor de la lista (asignación por equidad: pendiente)");
    set(validaciones, headerRow, COL_INSTRUCTOR, reglaInstructor);

    [[leg1Row, ida], [leg2Row, vta]].forEach(function (par) {
      var r = par[0], p = par[1];
      var valoresFila = [p.trip, formatearDDMMYYYY_(p.fechaVueloDt), p.diaSemana, p.vuelo, p.dep, p.arr,
        String(p.std), String(p.sta), p.subFleet, String(p.hbt), p.diaDuty];
      for (var k = 0; k < valoresFila.length; k++) set(contenido, r, 2 + k, valoresFila[k]);
    });

    set(contenido, leg2Row, COL_INSTRUCTOR, '=IF(O' + headerRow + '="","",O' + headerRow + ')');

    // Actividad fija (única válida en esta hoja) + ruta (Dep-Arr = F-G) + vuelo (LA E, STD/STA
    // en H/I) -> leídas en orden de fila (preRow..postRow2) arman exactamente el texto de 6
    // líneas que va a la celda de la matriz visual (confirmado por Fernando: "LCK B767 / -ruta
    // ida / -vuelo ida / LCK B767 / -ruta vuelta / -vuelo vuelta").
    set(contenido, preRow, COL_ACTIVIDAD, ACTIVIDAD_UNICA_B767_);
    set(contenido, headerRow, COL_ACTIVIDAD, '="- "&F' + leg1Row + '&"-"&G' + leg1Row);
    set(contenido, leg1Row, COL_ACTIVIDAD, '="- LA "&E' + leg1Row + '&" ("&LEFT(H' + leg1Row + ',5)&"-"&LEFT(I' + leg1Row + ',5)&" hrs)"');
    set(contenido, leg2Row, COL_ACTIVIDAD, '=IF(Q' + preRow + '="","",Q' + preRow + ')');
    set(contenido, postRow1, COL_ACTIVIDAD, '="- "&F' + leg2Row + '&"-"&G' + leg2Row);
    set(contenido, postRow2, COL_ACTIVIDAD, '="- LA "&E' + leg2Row + '&" ("&LEFT(H' + leg2Row + ',5)&"-"&LEFT(I' + leg2Row + ',5)&" hrs)"');

    infoBloques.push({ pk: pos.pk, headerRow: headerRow, leg1Row: leg1Row, leg2Row: leg2Row, cupos: cuposPorVuelo });
  });

  // Escribir todo de una sola vez (5 llamadas en total, sin importar cuántos pairings haya).
  var rango = hoja.getRange(1, 1, numFilas, NUM_COLS);
  rango.setValues(contenido);
  rango.setBackgrounds(fondos);
  rango.setFontWeights(pesos);
  rango.setNotes(notas);
  rango.setDataValidations(validaciones);

  hoja.setFrozenRows(3);
  return infoBloques;
}

// ---- Hoja "Resumen" (puerto de la hoja "Resumen Final", por fórmula) ----
// Igual que en "Vuelos": se arma todo en un solo array y se escribe con UNA llamada, en vez de
// una `setValues()` por fila.
function escribirHojaResumenB767_(hoja, infoBloques, nombreHojaVuelos) {
  var headers = ["Pairing ID", "Fecha", "Día Sem", "Vuelo", "Ruta", "Instructor", "Actividad", "AC Type", "Cupos"];
  var P = "'" + nombreHojaVuelos + "'!";

  var filas = [headers];
  infoBloques.forEach(function (info) {
    var r1 = info.leg1Row, r2 = info.leg2Row, rh = info.headerRow;
    filas.push([
      "=" + P + "B" + r1,
      "=" + P + "C" + r1,
      "=" + P + "D" + r1,
      "=" + P + "E" + r1 + '&"/"&' + P + "E" + r2,
      "=" + P + "F" + r1 + '&"-"&' + P + "G" + r1 + '&"-"&' + P + "F" + r1,
      '=IF(' + P + "O" + rh + '="","",' + P + "O" + rh + ")",
      '=IF(' + P + "Q" + (rh - 1) + '="","",' + P + "Q" + (rh - 1) + ")",
      "=" + P + "J" + r1, // AC Type está en J, no en I (I es STA)
      info.cupos,
    ]);
  });

  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}

// ============================================================================
// 3. ASIGNACIÓN DE INSTRUCTOR POR EQUIDAD (columna "Q B767" del archivo de equidad)
// ============================================================================
//
// Confirmado por Fernando (2026-10-02): la equidad se mide por la columna "Q B767" (cantidad
// de Launch Checks B767 ya dictados en el período) del archivo de equidad -> se prioriza
// siempre al instructor con el número MÁS BAJO. Solo cuentan los instructores cuya columna
// "HAB B767" contenga "B767" (cubre tanto "Instructor B767 IDE" como "Instructor B767/B787 -
// IDE").
//
// **Corrección 2026-10-02 (reportada por Fernando contra su Matriz real de octubre):** la
// primera versión solo evitaba repetir instructor en días ADYACENTES dentro de esta misma
// corrida, pero muchos instructores tienen la mayoría del mes en VACACIONES/FDS/DO/FERIADO/
// IOSA/etc. en la Matriz real -> podía "asignar" a alguien que en realidad no puede trabajar
// ese día. Ahora se cruza cada candidato contra la Matriz real (misma hoja que usan los demás
// scripts, `19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk`, pestaña **"Visua_Octubre_2026"** —
// confirmado 2026-10-02: esa es la pestaña vigente/mantenida por los scripts 1-4, no
// "Octubre 2026" que es la copia vieja/manual) y solo se asigna si esa fecha está en blanco o
// dice "B" (disponible). Si nadie habilitado está disponible esa fecha, el pairing se deja SIN
// asignar (no se inventa una asignación) y se reporta en el resumen final. También se corrigió
// el parseo de fecha (ver `parsearFechaCelda_`) y se agregó matching difuso de nombres (ver
// `nombresCoinciden_`) — ambos bugs reales que hacían fallar el 100% de las asignaciones.
function asignarInstructoresPorEquidadB767() {
  var ID_ARCHIVO_DESTINO = "1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY";
  var NOMBRE_HOJA_VUELOS = "Vuelos";
  var COL_INSTRUCTOR = 15; // O

  var ID_EQUIDAD = "19eTaqRHV1zWGvg2Tga10bzQThUmXZy9Kj02M9VFX320";
  var GID_EQUIDAD = 290322074;

  var ID_MATRIZ = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var NOMBRE_HOJA_MATRIZ = "Visua_Octubre_2026";

  var instructores = obtenerInstructoresEquidadB767_(ID_EQUIDAD, GID_EQUIDAD);
  if (instructores.length === 0) {
    SpreadsheetApp.getUi().alert("No encontré instructores con 'HAB B767' en el archivo de equidad -> revisar estructura real de esa hoja.");
    return;
  }

  var matrizInfo = obtenerDisponibilidadMatriz_(ID_MATRIZ, NOMBRE_HOJA_MATRIZ);
  if (!matrizInfo) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña '" + NOMBRE_HOJA_MATRIZ + "' -> no puedo verificar disponibilidad real, me detengo (no voy a asignar a ciegas).");
    return;
  }

  var ss = SpreadsheetApp.openById(ID_ARCHIVO_DESTINO);
  var hojaVuelos = ss.getSheetByName(NOMBRE_HOJA_VUELOS);
  if (!hojaVuelos) {
    SpreadsheetApp.getUi().alert("No encontré la hoja '" + NOMBRE_HOJA_VUELOS + "' -> corre primero armarPairingsVuelosB767().");
    return;
  }

  var valores = hojaVuelos.getDataRange().getValues();

  // Detectar cada bloque por su fila de encabezado ("Pairing ID" en columna B, índice 1) y
  // tomar la fecha de ida (columna C de la fila siguiente) y de vuelta (columna C 2 filas más
  // abajo) -> hay que estar disponible AMBOS días si son distintos (pairing multi-día tipo MIA).
  var bloques = [];
  for (var i = 0; i < valores.length; i++) {
    if (valores[i][1] === "Pairing ID") {
      var filaIdaIdx = i + 1, filaVueltaIdx = i + 2;
      var fechaIdaStr = valores[filaIdaIdx] ? valores[filaIdaIdx][2] : null;
      var fechaVueltaStr = valores[filaVueltaIdx] ? valores[filaVueltaIdx][2] : null;
      if (fechaIdaStr) {
        var fechaIda = parsearDDMMYYYY_(fechaIdaStr);
        var fechaVuelta = fechaVueltaStr ? parsearDDMMYYYY_(fechaVueltaStr) : fechaIda;
        bloques.push({ headerRowNum: i + 1, fecha: fechaIda, fechas: fechaIda === fechaVuelta ? [fechaIda] : [fechaIda, fechaVuelta] });
      }
    }
  }
  if (bloques.length === 0) {
    SpreadsheetApp.getUi().alert("No encontré bloques de pairings en '" + NOMBRE_HOJA_VUELOS + "' -> revisar que armarPairingsVuelosB767() ya haya corrido.");
    return;
  }
  bloques.sort(function (a, b) { return a.fecha - b.fecha; });

  var pool = instructores.map(function (x) { return { nombre: x.nombre, qB767: x.qB767 }; });
  var fechasPorInstructor = {};
  var asignaciones = [];
  var sinInstructorDisponible = [];
  var nombresNoEncontradosEnMatriz = {};

  bloques.forEach(function (bloque) {
    pool.sort(function (a, b) { return a.qB767 - b.qB767; }); // menor Q B767 primero = más necesitado
    var elegido = null;

    for (var k = 0; k < pool.length; k++) {
      var candidato = pool[k];
      var fechasPrevias = fechasPorInstructor[candidato.nombre] || [];
      var ocupaDiaAdyacente = bloque.fechas.some(function (fb) {
        return fechasPrevias.some(function (f) { return Math.abs(fb - f) <= 86400000; });
      });
      if (ocupaDiaAdyacente) continue;

      var disponibleTodasLasFechas = true, desconocido = false;
      for (var fi = 0; fi < bloque.fechas.length; fi++) {
        var disp = estaDisponibleEnFecha_(matrizInfo, candidato.nombre, bloque.fechas[fi]);
        if (disp === null) { desconocido = true; break; }
        if (!disp) { disponibleTodasLasFechas = false; break; }
      }
      if (desconocido) { nombresNoEncontradosEnMatriz[candidato.nombre] = true; continue; }
      if (!disponibleTodasLasFechas) continue;

      elegido = candidato;
      break;
    }

    if (!elegido) {
      sinInstructorDisponible.push(bloque.headerRowNum);
      return; // no se asigna nada -> mejor dejarlo en blanco que inventar
    }

    asignaciones.push({ headerRowNum: bloque.headerRowNum, nombre: elegido.nombre });
    elegido.qB767 += 1;
    bloque.fechas.forEach(function (f) {
      (fechasPorInstructor[elegido.nombre] = fechasPorInstructor[elegido.nombre] || []).push(f);
    });
  });

  var rangoO = hojaVuelos.getRange(1, COL_INSTRUCTOR, valores.length, 1);
  var columnaO = rangoO.getValues();
  asignaciones.forEach(function (a) { columnaO[a.headerRowNum - 1][0] = a.nombre; });
  rangoO.setValues(columnaO);

  var conteoFinal = {};
  asignaciones.forEach(function (a) { conteoFinal[a.nombre] = (conteoFinal[a.nombre] || 0) + 1; });
  var resumenConteo = Object.keys(conteoFinal).map(function (n) { return n + ": " + conteoFinal[n]; }).join("\n");

  var avisoSinDisponible = sinInstructorDisponible.length > 0
    ? "\n\nSIN INSTRUCTOR DISPONIBLE (ningún habilitado libre esa fecha, revisar a mano): filas " + sinInstructorDisponible.join(", ")
    : "";
  var avisoNoEncontrados = Object.keys(nombresNoEncontradosEnMatriz).length > 0
    ? "\n\nAVISO: estos nombres del archivo de equidad no los encontré en la Matriz (revisar que el nombre coincida exactamente): " + Object.keys(nombresNoEncontradosEnMatriz).join(", ")
    : "";

  SpreadsheetApp.getUi().alert(
    "Asignación por equidad completada (verificada contra disponibilidad real en la Matriz).\n" +
    "Pairings asignados: " + asignaciones.length + " de " + bloques.length + "\n\n" +
    "Reparto de esta corrida:\n" + resumenConteo +
    avisoSinDisponible + avisoNoEncontrados + "\n\n" +
    "(Actividad sigue en blanco para elegir a mano.)"
  );
}

// ---- Parseo de fecha "a prueba de todo" ----
// BUG REAL encontrado 2026-10-02: la primera versión solo sabía parsear texto "dd/mm/yyyy",
// pero tanto la Matriz real como la propia columna "FECHA REAL" que esta hoja escribe (porque
// Sheets convierte automáticamente un texto con forma de fecha a un valor de fecha real al
// escribirlo con `setValues`) vienen como OBJETOS `Date` de verdad al leerlos de vuelta con
// `getValues()` -> por eso el cruce fallaba para el 100% de los pairings (ninguna fecha
// coincidía nunca). Mismo problema que ya resolvía `parsearAFechaObj` en `4. RTI copia.gs`
// (que si maneja ambos casos) -> esta versión unifica ambos casos para todo el archivo.
function parsearFechaCelda_(valor) {
  if (valor instanceof Date) {
    return new Date(valor.getFullYear(), valor.getMonth(), valor.getDate()).getTime();
  }
  var s = String(valor || "").trim();
  var p = s.split("/");
  if (p.length !== 3) return null;
  var d = parseInt(p[0], 10), m = parseInt(p[1], 10), a = parseInt(p[2], 10);
  if (!d || !m || !a) return null;
  return new Date(a, m - 1, d).getTime();
}

// Alias usado en varios lados del archivo (misma función, un solo parser para todo).
function parsearDDMMYYYY_(s) { return parsearFechaCelda_(s); }

// ---- Disponibilidad real en la Matriz (confirmado 2026-10-02: hay que revisar vacaciones/
// FDS/DO/FERIADO/etc., no solo la adyacencia dentro de esta corrida) ----
// Misma estructura que usan los demás scripts de la Matriz: fila 2 = fechas desde columna C,
// fila 3+ = instructores (BP en A, Nombre en B). Se busca la pestaña por NOMBRE (no por gid):
// confirmado por Fernando que el destino real es "Visua_Octubre_2026" (la pestaña que ya
// mantienen los scripts 1-4, no "Octubre 2026" que es la copia vieja/manual).
function obtenerDisponibilidadMatriz_(idMatriz, nombreHoja) {
  var ss = SpreadsheetApp.openById(idMatriz);
  var hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) return null;

  var FILA_ENCABEZADO_FECHAS = 2, FILA_PRIMER_INSTRUCTOR = 3, COL_PRIMERA_FECHA = 3;
  var valores = hoja.getDataRange().getValues();

  var filaFechas = valores[FILA_ENCABEZADO_FECHAS - 1] || [];
  var fechasPorColumna = {}; // índice de columna (0-based) -> timestamp
  for (var j = COL_PRIMERA_FECHA - 1; j < filaFechas.length; j++) {
    var ts = parsearFechaCelda_(filaFechas[j]);
    if (ts !== null) fechasPorColumna[j] = ts;
  }

  var filas = []; // [{nombre, filaIdx}] -> lista (no dict) porque el matching es difuso, no exacto
  for (var r = FILA_PRIMER_INSTRUCTOR - 1; r < valores.length; r++) {
    var nombre = String(valores[r][1] || "").trim(); // columna B = Nombre
    if (nombre) filas.push({ nombre: nombre, filaIdx: r });
  }

  return { hoja: hoja, valores: valores, fechasPorColumna: fechasPorColumna, filas: filas };
}

// true = disponible (celda vacía o "B"), false = ocupado (VACACIONES/FDS/DO/FERIADO/etc.),
// null = no se pudo verificar (instructor o fecha no encontrados en la Matriz).
function estaDisponibleEnFecha_(matrizInfo, nombreInstructor, fechaTimestamp) {
  var filaInfo = buscarFilaPorNombreDifuso_(matrizInfo.filas, nombreInstructor);
  if (!filaInfo) return null;

  for (var colIdx in matrizInfo.fechasPorColumna) {
    if (matrizInfo.fechasPorColumna[colIdx] === fechaTimestamp) {
      var valorCelda = String(matrizInfo.valores[filaInfo.filaIdx][colIdx] || "").trim().toUpperCase();
      return valorCelda === "" || valorCelda === "B";
    }
  }
  return null;
}

// ---- Matching difuso de nombres (confirmado necesario por Fernando, 2026-10-02: el mismo
// instructor puede aparecer como "Karen Santa Cruz" en un archivo y "Karen Cruz" en otro,
// "Fiorella Ruiz" vs "Fiore", "Jennifert Acurio" vs "Jennifer", etc.) ----
// Regla: se normaliza (sin tildes, minúsculas), se parte en palabras, y coincide si CADA
// palabra del nombre más corto es prefijo (o está contenida en) alguna palabra del más largo.
// Mismo espíritu que la tabla de alias de NB (Sebas/Fio/Fiore/Cris), pero genérico en vez de
// una lista fija, porque acá las variaciones vienen de archivos distintos, no de texto libre.
function normalizarNombreGenerico_(s) {
  return String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

function nombresCoinciden_(nombreA, nombreB) {
  var a = normalizarNombreGenerico_(nombreA);
  var b = normalizarNombreGenerico_(nombreB);
  if (!a || !b) return false;
  if (a === b) return true;

  var tokensA = a.split(/\s+/).filter(Boolean);
  var tokensB = b.split(/\s+/).filter(Boolean);
  var corto = tokensA.length <= tokensB.length ? tokensA : tokensB;
  var largo = tokensA.length <= tokensB.length ? tokensB : tokensA;
  if (corto.length === 0) return false;

  return corto.every(function (tc) {
    return largo.some(function (tl) { return tl.indexOf(tc) === 0 || tc.indexOf(tl) === 0; });
  });
}

function buscarFilaPorNombreDifuso_(filas, nombreBuscado) {
  for (var i = 0; i < filas.length; i++) {
    if (nombresCoinciden_(filas[i].nombre, nombreBuscado)) return filas[i];
  }
  return null;
}

// ============================================================================
// 3b. SUBIR LAS ASIGNACIONES A LA MATRIZ VISUAL ("Visua_Octubre_2026")
// ============================================================================
//
// Confirmado por Fernando (2026-10-02): el "producto final" es la matriz visual con el texto
// de 6 líneas en la celda [instructor, fecha] correspondiente:
//   LCK B767
//   - LIM-SCL
//   - LA 2413 (12:05-15:45 hrs)
//   LCK B767
//   - SCL-LIM
//   - LA 2412 (17:10-21:00 hrs)
// Ese texto es EXACTAMENTE la columna Q de "Vuelos" leída de corrido desde la fila anterior al
// encabezado hasta la última fila del bloque (preRow..postRow2) — no hace falta reconstruirlo,
// solo concatenar esas 6 celdas. Corre esto DESPUÉS de `asignarInstructoresPorEquidadB767()`
// (necesita el Instructor ya escrito en columna O). Si el pairing es multi-día (LIM-MIA-LIM),
// escribe el mismo texto completo en la celda de ida Y en la de vuelta (confirmado en sesiones
// anteriores: ambos días quedan marcados para ese instructor).
function subirAsignacionesAVisualB767() {
  var ID_ARCHIVO_VUELOS = "1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY";
  var NOMBRE_HOJA_VUELOS = "Vuelos";
  var COL_INSTRUCTOR = 15; // O
  var COL_ACTIVIDAD = 17;  // Q

  var ID_MATRIZ = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var NOMBRE_HOJA_MATRIZ = "Visua_Octubre_2026";

  var ssVuelos = SpreadsheetApp.openById(ID_ARCHIVO_VUELOS);
  var hojaVuelos = ssVuelos.getSheetByName(NOMBRE_HOJA_VUELOS);
  if (!hojaVuelos) {
    SpreadsheetApp.getUi().alert("No encontré la hoja '" + NOMBRE_HOJA_VUELOS + "' -> corre primero armarPairingsVuelosB767() y asignarInstructoresPorEquidadB767().");
    return;
  }
  var valores = hojaVuelos.getDataRange().getValues();

  var matrizInfo = obtenerDisponibilidadMatriz_(ID_MATRIZ, NOMBRE_HOJA_MATRIZ);
  if (!matrizInfo) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña '" + NOMBRE_HOJA_MATRIZ + "' -> no puedo escribir ahí.");
    return;
  }

  var bloques = [];
  for (var i = 0; i < valores.length; i++) {
    if (valores[i][1] !== "Pairing ID") continue;
    var preRowIdx = i - 1, headerRowIdx = i, leg1RowIdx = i + 1, leg2RowIdx = i + 2,
        postRow1Idx = i + 3, postRow2Idx = i + 4;

    var nombreInstructor = String(valores[headerRowIdx][COL_INSTRUCTOR - 1] || "").trim();
    if (!nombreInstructor) continue; // sin instructor asignado todavía -> saltar, no inventar

    var fechaIda = valores[leg1RowIdx] ? parsearFechaCelda_(valores[leg1RowIdx][2]) : null;
    if (fechaIda === null) continue;
    var fechaVuelta = valores[leg2RowIdx] ? parsearFechaCelda_(valores[leg2RowIdx][2]) : fechaIda;

    var textoVisual = [preRowIdx, headerRowIdx, leg1RowIdx, leg2RowIdx, postRow1Idx, postRow2Idx]
      .map(function (idx) { return valores[idx] ? String(valores[idx][COL_ACTIVIDAD - 1] || "") : ""; })
      .join("\n");

    bloques.push({
      nombreInstructor: nombreInstructor,
      fechas: (fechaVuelta !== null && fechaVuelta !== fechaIda) ? [fechaIda, fechaVuelta] : [fechaIda],
      texto: textoVisual,
    });
  }

  if (bloques.length === 0) {
    SpreadsheetApp.getUi().alert("No encontré ningún pairing con instructor ya asignado en '" + NOMBRE_HOJA_VUELOS + "' -> corre primero asignarInstructoresPorEquidadB767().");
    return;
  }

  // Igual que en los demás scripts de la Matriz: cargar todo a memoria, mutar, escribir una vez.
  var grid = matrizInfo.valores;
  var noEncontrados = {};
  var celdasEscritas = 0;

  bloques.forEach(function (bloque) {
    var filaInfo = buscarFilaPorNombreDifuso_(matrizInfo.filas, bloque.nombreInstructor);
    if (!filaInfo) { noEncontrados[bloque.nombreInstructor] = true; return; }

    bloque.fechas.forEach(function (fechaTs) {
      for (var colIdx in matrizInfo.fechasPorColumna) {
        if (matrizInfo.fechasPorColumna[colIdx] === fechaTs) {
          grid[filaInfo.filaIdx][colIdx] = bloque.texto;
          celdasEscritas++;
          break;
        }
      }
    });
  });

  matrizInfo.hoja.getRange(1, 1, grid.length, grid[0].length).setValues(grid);

  var avisoNoEncontrados = Object.keys(noEncontrados).length > 0
    ? "\n\nAVISO: no encontré fila para estos instructores en '" + NOMBRE_HOJA_MATRIZ + "' (revisar que el nombre coincida): " + Object.keys(noEncontrados).join(", ")
    : "";

  SpreadsheetApp.getUi().alert(
    "Subida a la matriz visual completada.\n" +
    "Celdas escritas: " + celdasEscritas + " (de " + bloques.length + " pairings con instructor asignado)." +
    avisoNoEncontrados
  );
}

function indiceColumnaPorHeaderGenerico_(fila, nombre) {
  var buscado = nombre.trim().toUpperCase();
  for (var j = 0; j < fila.length; j++) {
    if (String(fila[j] || "").trim().toUpperCase() === buscado) return j;
  }
  return -1;
}

// Busca una columna cuyo encabezado CONTENGA todas las palabras clave dadas (no exige texto
// exacto) -> tolera variaciones como "Vig. RTI B76" en vez de "Vig. RTI B767".
function indiceColumnaPorHeaderContiene_(fila, palabrasClave) {
  for (var j = 0; j < fila.length; j++) {
    var texto = String(fila[j] || "").trim().toUpperCase();
    if (!texto) continue;
    var todasPresentes = palabrasClave.every(function (p) { return texto.indexOf(p.toUpperCase()) !== -1; });
    if (todasPresentes) return j;
  }
  return -1;
}

// ============================================================================
// 4. "INS A CONSIDERAR" por tripulante en Archivo 10 (columna AB bloqueada -> columna AG)
// ============================================================================
//
// Equivalente WB del cruce "INS FINAL" -> "INS F a considerar"/"Grupo" que ya existe para NB.
// Confirmado por Fernando (2026-10-02): en "prueba de LCK 767", la columna "INS FINAL 1 (NO
// LCK)" ya trae el GRUPO bloqueado para ese tripulante (texto "Grupo 1", "Grupo 4", etc. — no
// nombres sueltos como en NB, alguien más ya resolvió eso), y hay que escribir en "INFO INS A
// CONSIDERAR" los nombres de los integrantes de los grupos que NO están bloqueados.
//
// Composición real de los 3 grupos B767 (dada directamente por Fernando, 2026-10-02 — igual
// que en NB, esto puede cambiar mes a mes, revisar antes de confiar en esta lista si pasa
// tiempo):
var GRUPOS_B767_DEFINIDOS_ = {
  1: ["Sebastian", "Erika", "Claudia"],
  2: ["Javier", "Jefferson", "Jennifert", "Patricia"],
  3: ["Jazmin", "Mariella", "Gabriela", "Karen"],
};
// Fernando: "no veo grupo 4, así que no sé si colocarlo" -> si una fila bloquea "Grupo 4" (u
// otro número fuera de 1-3), NO se inventa su composición: no se excluye a nadie de ese grupo
// (porque no se sabe quiénes son) y se reporta aparte para que confirme si sigue vigente.

function calcularInsAConsiderarB767() {
  var ID_ARCHIVO_10 = "1NZN565fOJUtoETQvvPzdHpRvyHp4stY2hsrqtjNjSEU";
  var GID_ARCHIVO_10 = 1025385274; // pestaña "prueba de LCK 767"

  var ss = SpreadsheetApp.openById(ID_ARCHIVO_10);
  var hoja = ss.getSheets().find(function (h) { return h.getSheetId() === GID_ARCHIVO_10; });
  if (!hoja) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + GID_ARCHIVO_10 + " en Archivo 10.");
    return;
  }

  var valores = hoja.getDataRange().getValues();

  var filaHeaderIdx = -1, colBloqueado = -1, colConsiderar = -1, colGrupoElegible = -1;
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    var idxBloq = indiceColumnaPorHeaderGenerico_(fila, "INS FINAL 1 (NO LCK)");
    var idxCons = indiceColumnaPorHeaderGenerico_(fila, "INFO INS A CONSIDERAR");
    if (idxBloq !== -1 && idxCons !== -1) {
      filaHeaderIdx = i;
      colBloqueado = idxBloq;
      colConsiderar = idxCons;
      colGrupoElegible = indiceColumnaPorHeaderGenerico_(fila, "Grupo"); // columna aparte, puede no existir
      break;
    }
  }
  if (filaHeaderIdx === -1) {
    SpreadsheetApp.getUi().alert("No encontré las columnas 'INS FINAL 1 (NO LCK)' / 'INFO INS A CONSIDERAR' en '" + hoja.getName() + "' -> revisar encabezados reales (puede que el texto exacto haya cambiado).");
    return;
  }

  var columnaConsiderar = [];
  var columnaGrupo = [];
  var gruposDesconocidos = {};
  var filasConDatos = 0;

  for (var r = filaHeaderIdx + 1; r < valores.length; r++) {
    var filaActual = valores[r];
    var textoBloqueado = String(filaActual[colBloqueado] || "").trim();

    if (!textoBloqueado && !filaActual.some(function (v) { return String(v || "").trim() !== ""; })) {
      columnaConsiderar.push([""]);
      columnaGrupo.push([""]);
      continue; // fila totalmente vacía -> no tocar
    }
    filasConDatos++;

    var grupoBloqueadoNum = null;
    var m = textoBloqueado.match(/grupo\s*(\d+)/i);
    if (m) grupoBloqueadoNum = parseInt(m[1], 10);

    if (grupoBloqueadoNum !== null && !GRUPOS_B767_DEFINIDOS_[grupoBloqueadoNum]) {
      gruposDesconocidos[textoBloqueado] = (gruposDesconocidos[textoBloqueado] || 0) + 1;
    }

    var gruposElegibles = [1, 2, 3].filter(function (g) { return g !== grupoBloqueadoNum; });
    var textoConsiderar = gruposElegibles.map(function (g) { return GRUPOS_B767_DEFINIDOS_[g].join(", "); }).join(" / ");
    var textoGrupo = gruposElegibles.length ? "Grupo " + gruposElegibles.join("/") : "SIN GRUPO";

    columnaConsiderar.push([textoConsiderar]);
    columnaGrupo.push([textoGrupo]);
  }

  hoja.getRange(filaHeaderIdx + 2, colConsiderar + 1, columnaConsiderar.length, 1).setValues(columnaConsiderar);
  if (colGrupoElegible !== -1) {
    hoja.getRange(filaHeaderIdx + 2, colGrupoElegible + 1, columnaGrupo.length, 1).setValues(columnaGrupo);
  }

  var avisoGrupoDesconocido = Object.keys(gruposDesconocidos).length > 0
    ? "\n\nAVISO: " + Object.keys(gruposDesconocidos).length + " valor(es) de bloqueo que no reconozco (ej. 'Grupo 4') -> no excluí a nadie de ese grupo porque no tengo sus integrantes. Valores encontrados: " + Object.keys(gruposDesconocidos).join(", ") + ". Confírmame si siguen vigentes y quiénes son."
    : "";

  SpreadsheetApp.getUi().alert(
    "'INS a considerar' calculado para " + filasConDatos + " tripulante(s) en '" + hoja.getName() + "'.\n" +
    "Grupos usados: Grupo 1 = Sebastian/Erika/Claudia · Grupo 2 = Javier/Jefferson/Jennifert/Patricia · Grupo 3 = Jazmin/Mariella/Gabriela/Karen." +
    avisoGrupoDesconocido
  );
}

// Lee BP/INST/HAB B767/Q B767 del archivo de equidad, filtrando solo a los instructores cuya
// columna "HAB B767" mencione B767 (incluye "Instructor B767 IDE" y "Instructor B767/B787 -
// IDE" -> ambos pueden dictar B767, confirmado por Fernando).
function obtenerInstructoresEquidadB767_(idArchivo, gid) {
  var ss = SpreadsheetApp.openById(idArchivo);
  var hoja = ss.getSheets().find(function (h) { return h.getSheetId() === gid; });
  if (!hoja) return [];

  var valores = hoja.getDataRange().getValues();
  var filaHeaderIdx = -1, colNombre = -1, colHab = -1, colQ = -1;
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    var idxInst = indiceColumnaPorHeaderGenerico_(fila, "INST");
    var idxHab = indiceColumnaPorHeaderGenerico_(fila, "HAB B767");
    var idxQ = indiceColumnaPorHeaderGenerico_(fila, "Q B767");
    if (idxInst !== -1 && idxHab !== -1 && idxQ !== -1) {
      filaHeaderIdx = i; colNombre = idxInst; colHab = idxHab; colQ = idxQ;
      break;
    }
  }
  if (filaHeaderIdx === -1) return [];

  var out = [];
  for (var r = filaHeaderIdx + 1; r < valores.length; r++) {
    var nombre = String(valores[r][colNombre] || "").trim();
    var hab = String(valores[r][colHab] || "").trim().toUpperCase();
    if (!nombre || hab.indexOf("B767") === -1) continue;
    var q = parseFloat(String(valores[r][colQ] || "0").replace(",", ".")) || 0;
    out.push({ nombre: nombre, qB767: q });
  }
  return out;
}
