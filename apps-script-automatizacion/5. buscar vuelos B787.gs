/*
Pipeline completo de B787 (2026-10-02), mismos 4 pasos que B767, en el mismo orden:
`seleccionarTripulantesB787()` -> `armarPairingsVuelosB787()` -> `asignarInstructoresB787()` ->
`subirAsignacionesAVisualB787()`.

Reutiliza SIN DUPLICAR las funciones genéricas ya construidas y probadas en
"5. buscar vuelos B767.gs" (mismo proyecto de Apps Script, mismo scope global): `cargarYFiltrarWB_`,
`armarPairingsPorPk_`, `parsearFechaHoraBQ_`, `parsearFechaCelda_`, `formatearDDMMYYYY_`,
`obtenerDisponibilidadMatriz_`, `estaDisponibleEnFecha_`, `nombresCoinciden_`,
`buscarFilaPorNombreDifuso_`, `indiceColumnaPorHeaderGenerico_`. Solo se duplica lo que
realmente cambia por flota (query de BigQuery con otra subflota, cupos, nombre de hoja, nombre
de columna IDE), igual criterio que ya se usó entre los dos archivos de selección de
tripulantes.

### Diferencias confirmadas con B767 (Fernando, 2026-10-02)
- B787 solo vuela la ruta LIM-SCL-LIM (vuelta el mismo día) — no hay pairings multi-día tipo
  MIA para esta flota, así que el caso de "2 celdas en la Matriz" simplemente nunca se activa
  acá (el código genérico ya lo contempla, no hace falta código aparte).
- **No hay archivo de equidad para B787** ("no sé si equidad aquí aplica ya" — Fernando no está
  seguro y no dio un archivo con un contador tipo "Q B787"). Mientras no exista ese archivo,
  `asignarInstructoresB787()` reparte por **round-robin dentro de la misma corrida** (prioriza
  al instructor con MENOS asignaciones en esta corrida, no un histórico acumulado entre meses)
  — mismo principio de variedad que ya se usaba en el reparto original de la Matriz NB, pero
  sin inventar un contador de equidad entre meses que no existe. Si más adelante aparece un
  archivo de equidad B787, avisar para adaptarlo igual que `asignarInstructoresPorEquidadB767`.
- Cupos por vuelo B787 = 6 (confirmado en sesión anterior, "Dotación por flota" del manual).
- Las hojas de este flota se llaman **"Vuelos B787"/"Resumen B787"** (no "Vuelos"/"Resumen" a
  secas como en B767) para poder convivir en el mismo archivo de pairings sin pisarse — el
  archivo va a terminar con 6 hojas en total (B767/B787/A320 x Vuelos/Resumen).

### Qué hace `seleccionarTripulantesB787()`
1. Lee Archivo 9, pestaña "LCK 787" (gid=1122326179): busca la fila real de encabezados
   buscando "BP" y "PROGRAMAR" como texto exacto.
2. Junta BP + Nombre de los tripulantes cuyo PROGRAMAR sea "Si"/"Sí".
3. Escribe en Archivo 10, pestaña "prueba de LCK 787" (gid=16355364): BP en columna A y
   Nombre en columna C, ambos empezando en la fila 4 (confirmado por Fernando — a diferencia
   de B767, donde solo se confirmó la columna A).
4. Limpia filas sobrantes de A y C si la nueva lista es más corta que la anterior.

### Importante — confirmar antes de usar en serio
- Solo escribe A (BP) y C (Nombre). La columna B (entre medio) y cualquier otra columna
  llenada a mano o por fórmula no se toca — revisa que sigan alineadas si el orden de
  tripulantes cambió respecto a la corrida anterior.
- No toca la Matriz ni asigna "coordinador" — falta la regla que Fernando va a indicar.
*/

// ============================================================================
// 0. CALCULAR "Programar" (Sí/No) en Archivo 9, a partir de las vigencias
// ============================================================================
// Mismo caso que B767 (ver ese archivo para el detalle completo de la lógica e interpretación)
// — reutiliza `calcularProgramarWB_` (definida ahí, mismo scope global) con los nombres de
// columna de B787 ("Vig. RTI B787"/"Vig. LC B787").
function calcularProgramarB787() {
  var ID_ARCHIVO_9 = "1d95aUJtNVAtHd3tECTcsc2WHM8b557Jbl1DcCDsJGuo";
  var GID_ARCHIVO_9 = 107709571; // pestaña "LCK 787" viva

  calcularProgramarWB_(ID_ARCHIVO_9, GID_ARCHIVO_9, "Vig. RTI B787", "Vig. LC B787", "787");
}

function seleccionarTripulantesB787() {
  var ID_ARCHIVO_9 = "1d95aUJtNVAtHd3tECTcsc2WHM8b557Jbl1DcCDsJGuo";
  var GID_ARCHIVO_9 = 107709571; // pestaña "LCK 787" VIVA (gid corregido 2026-10-02 — el anterior, 1122326179, era una copia estática)

  var ID_ARCHIVO_10 = "1NZN565fOJUtoETQvvPzdHpRvyHp4stY2hsrqtjNjSEU";
  var GID_ARCHIVO_10 = 16355364; // pestaña "prueba de LCK 787"

  var FILA_INICIO_ARCHIVO_10 = 4; // confirmado: BP (col A) y Nombre (col C) se pegan desde la fila 4
  var COL_BP_DESTINO = 1;  // A
  var COL_NOMBRE_DESTINO = 3; // C

  var ssArchivo9 = SpreadsheetApp.openById(ID_ARCHIVO_9);
  var hojaArchivo9 = ssArchivo9.getSheets().find(function (h) { return h.getSheetId() === GID_ARCHIVO_9; });
  if (!hojaArchivo9) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + GID_ARCHIVO_9 + " en Archivo 9.");
    return;
  }

  var valoresA9 = hojaArchivo9.getDataRange().getValues();

  // Buscar columna por encabezado ignorando mayúsculas/minúsculas y espacios extra (la pestaña
  // gemela de B767 tiene "Programar" en vez de "PROGRAMAR" -> misma búsqueda robusta acá).
  function indiceColumnaPorHeader(fila, nombre) {
    var buscado = nombre.trim().toUpperCase();
    for (var j = 0; j < fila.length; j++) {
      if (String(fila[j] || "").trim().toUpperCase() === buscado) return j;
    }
    return -1;
  }

  var filaHeaderIdx = -1;
  var colBP = -1, colProgramar = -1, colNombre = -1;
  for (var i = 0; i < valoresA9.length; i++) {
    var fila = valoresA9[i];
    var idxBP = indiceColumnaPorHeader(fila, "BP");
    var idxProgramar = indiceColumnaPorHeader(fila, "Programar");
    if (idxBP !== -1 && idxProgramar !== -1) {
      filaHeaderIdx = i;
      colBP = idxBP;
      colProgramar = idxProgramar;
      colNombre = indiceColumnaPorHeader(fila, "Nombre"); // puede no existir -> se valida abajo
      break;
    }
  }

  if (filaHeaderIdx === -1) {
    SpreadsheetApp.getUi().alert("No encontré una fila con 'BP' y 'PROGRAMAR' en Archivo 9 (LCK 787) -> revisar estructura real de la hoja.");
    return;
  }
  if (colNombre === -1) {
    SpreadsheetApp.getUi().alert("No encontré una columna 'Nombre' en Archivo 9 (LCK 787) -> revisar encabezado real (debe decir exactamente 'Nombre').");
    return;
  }

  var filasDemanda = []; // [bp, nombre]
  for (var r = filaHeaderIdx + 1; r < valoresA9.length; r++) {
    var filaDatos = valoresA9[r];
    var bp = String(filaDatos[colBP] || "").replace(/^'/, "").trim();
    var nombre = String(filaDatos[colNombre] || "").trim();
    var programar = String(filaDatos[colProgramar] || "").trim().toLowerCase();
    if (!bp) continue;
    if (programar === "si" || programar === "sí") {
      filasDemanda.push([bp, nombre]);
    }
  }

  var ssArchivo10 = SpreadsheetApp.openById(ID_ARCHIVO_10);
  var hojaArchivo10 = ssArchivo10.getSheets().find(function (h) { return h.getSheetId() === GID_ARCHIVO_10; });
  if (!hojaArchivo10) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + GID_ARCHIVO_10 + " en Archivo 10.");
    return;
  }

  var ultimaFilaConDatos = hojaArchivo10.getLastRow();
  if (ultimaFilaConDatos >= FILA_INICIO_ARCHIVO_10) {
    var numFilasABorrar = ultimaFilaConDatos - FILA_INICIO_ARCHIVO_10 + 1;
    hojaArchivo10.getRange(FILA_INICIO_ARCHIVO_10, COL_BP_DESTINO, numFilasABorrar, 1).clearContent();
    hojaArchivo10.getRange(FILA_INICIO_ARCHIVO_10, COL_NOMBRE_DESTINO, numFilasABorrar, 1).clearContent();
  }

  if (filasDemanda.length > 0) {
    var valoresBP = filasDemanda.map(function (f) { return [Number(f[0])]; });
    var valoresNombre = filasDemanda.map(function (f) { return [f[1]]; });

    var rangoBP = hojaArchivo10.getRange(FILA_INICIO_ARCHIVO_10, COL_BP_DESTINO, valoresBP.length, 1);
    rangoBP.setNumberFormat("0");
    rangoBP.setValues(valoresBP);

    hojaArchivo10.getRange(FILA_INICIO_ARCHIVO_10, COL_NOMBRE_DESTINO, valoresNombre.length, 1).setValues(valoresNombre);
  }

  SpreadsheetApp.getUi().alert(
    "Selección B787 completada.\n" +
    "Tripulantes con PROGRAMAR = Sí: " + filasDemanda.length + "\n" +
    "BP (col A) y Nombre (col C) pegados en '" + hojaArchivo10.getName() + "' desde la fila " + FILA_INICIO_ARCHIVO_10 + "."
  );
}

// ============================================================================
// 2. BÚSQUEDA DE VUELOS (pairings B787) + hojas "Vuelos B787" y "Resumen B787"
// ============================================================================
// Mismo query/filtrado que B767 (ver `cargarYFiltrarWB_` en el otro archivo), cambiando solo
// la subflota (788/789) y los cupos (6).

function armarPairingsVuelosB787() {
  var PROJECT_ID_FACTURACION = "datadem-home";
  var MES_OBJETIVO = 10;
  var ANIO_OBJETIVO = 2026;
  var CUPOS_POR_VUELO = 6; // confirmado: 6 tripulantes/vuelo en B787

  var ID_ARCHIVO_DESTINO = "1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY";
  var NOMBRE_HOJA_VUELOS = "Vuelos B787";
  var NOMBRE_HOJA_RESUMEN = "Resumen B787";

  var filasCrudas = consultarBigQueryWB787_(PROJECT_ID_FACTURACION, MES_OBJETIVO, ANIO_OBJETIVO);
  Logger.log("Filas crudas descargadas: " + filasCrudas.length);
  if (filasCrudas.length > 0) Logger.log("Ejemplo de fila cruda: " + JSON.stringify(filasCrudas[0]));

  var resultado = cargarYFiltrarWB_(filasCrudas, MES_OBJETIVO, ANIO_OBJETIVO);
  Logger.log("Piernas válidas: " + resultado.validos.length + " | pairings incompletos descartados: " + resultado.incompletos.length);

  var pairingsPorPk = armarPairingsPorPk_(resultado.validos);
  var pks = Object.keys(pairingsPorPk);
  Logger.log("Pairings B787 completos armados: " + pks.length);

  var ss = SpreadsheetApp.openById(ID_ARCHIVO_DESTINO);
  var hojaVuelos = obtenerOCrearHoja_(ss, NOMBRE_HOJA_VUELOS);
  var hojaResumen = obtenerOCrearHoja_(ss, NOMBRE_HOJA_RESUMEN);

  var infoBloques = escribirHojaVuelosB787_(hojaVuelos, pairingsPorPk, CUPOS_POR_VUELO);
  escribirHojaResumenB787_(hojaResumen, infoBloques, NOMBRE_HOJA_VUELOS);

  SpreadsheetApp.getUi().alert(
    "Búsqueda de vuelos B787 completada.\n" +
    "Pairings válidos encontrados: " + pks.length + "\n" +
    "Hojas '" + NOMBRE_HOJA_VUELOS + "' y '" + NOMBRE_HOJA_RESUMEN + "' actualizadas.\n" +
    "(Actividad ya quedó fija en 'LCK B787'. Corre asignarInstructoresB787() para llenar Instructor, y luego subirAsignacionesAVisualB787() para subirlo a la matriz visual.)"
  );
}

function consultarBigQueryWB787_(projectId, mesObjetivo, anioObjetivo) {
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
    "  AND subfleet_code IN ('788', '789')", // B787
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
    for (var i = 0; i < nombresCampos.length; i++) obj[nombresCampos[i]] = fila.f[i].v;
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

// Único valor de actividad válido en esta hoja (igual criterio confirmado para B767).
var ACTIVIDAD_UNICA_B787_ = "LCK B787";

function obtenerInstructoresIdeB787_() {
  var ID_ROL = "1yMvgb_O4qxpCCE4bAqD4XhW2GQI9ZObf2EAnymXaReE";
  var GID_ROL = 1933640306;
  var ss = SpreadsheetApp.openById(ID_ROL);
  var hoja = ss.getSheets().find(function (h) { return h.getSheetId() === GID_ROL; });
  if (!hoja) return [];

  var valores = hoja.getDataRange().getValues();
  if (valores.length === 0) return [];
  var header = valores[0];
  var colIde = header.indexOf("IDE B787");
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

// Mismo layout de columnas y mismo patrón de "cargar todo a memoria, escribir una vez" que la
// versión de B767 (ver esa función para el detalle de por qué).
function escribirHojaVuelosB787_(hoja, pairingsPorPk, cuposPorVuelo) {
  var HEADERS = ["Pairing ID", "FECHA REAL", "Day of Week", "Flight No", "Dep Stn", "Arr Stn",
    "STD", "STA", "AC Type", "HBT", "DIA_DUTY"];
  var COL_INSTRUCTOR = 15; // O
  var COL_ACTIVIDAD = 17;  // Q
  var NUM_COLS = 17;

  var nombresInstructores = obtenerInstructoresIdeB787_();
  var reglaInstructor = nombresInstructores.length > 0
    ? SpreadsheetApp.newDataValidation().requireValueInList(nombresInstructores, true).setAllowInvalid(true).build()
    : null;

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

  function gridVacio(valorPorDefecto) {
    var g = [];
    for (var r = 0; r < numFilas; r++) {
      var f2 = [];
      for (var c = 0; c < NUM_COLS; c++) f2.push(valorPorDefecto);
      g.push(f2);
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

  var infoBloques = [];
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
    set(notas, headerRow, COL_INSTRUCTOR, "Elegir el instructor de la lista");
    set(validaciones, headerRow, COL_INSTRUCTOR, reglaInstructor);

    [[leg1Row, ida], [leg2Row, vta]].forEach(function (par) {
      var r = par[0], p = par[1];
      var valoresFila = [p.trip, formatearDDMMYYYY_(p.fechaVueloDt), p.diaSemana, p.vuelo, p.dep, p.arr,
        String(p.std), String(p.sta), p.subFleet, String(p.hbt), p.diaDuty];
      for (var k = 0; k < valoresFila.length; k++) set(contenido, r, 2 + k, valoresFila[k]);
    });

    set(contenido, leg2Row, COL_INSTRUCTOR, '=IF(O' + headerRow + '="","",O' + headerRow + ')');

    set(contenido, preRow, COL_ACTIVIDAD, ACTIVIDAD_UNICA_B787_);
    set(contenido, headerRow, COL_ACTIVIDAD, '="- "&F' + leg1Row + '&"-"&G' + leg1Row);
    set(contenido, leg1Row, COL_ACTIVIDAD, '="- LA "&E' + leg1Row + '&" ("&LEFT(H' + leg1Row + ',5)&"-"&LEFT(I' + leg1Row + ',5)&" hrs)"');
    set(contenido, leg2Row, COL_ACTIVIDAD, '=IF(Q' + preRow + '="","",Q' + preRow + ')');
    set(contenido, postRow1, COL_ACTIVIDAD, '="- "&F' + leg2Row + '&"-"&G' + leg2Row);
    set(contenido, postRow2, COL_ACTIVIDAD, '="- LA "&E' + leg2Row + '&" ("&LEFT(H' + leg2Row + ',5)&"-"&LEFT(I' + leg2Row + ',5)&" hrs)"');

    infoBloques.push({ pk: pos.pk, headerRow: headerRow, leg1Row: leg1Row, leg2Row: leg2Row, cupos: cuposPorVuelo });
  });

  var rango = hoja.getRange(1, 1, numFilas, NUM_COLS);
  rango.setValues(contenido);
  rango.setBackgrounds(fondos);
  rango.setFontWeights(pesos);
  rango.setNotes(notas);
  rango.setDataValidations(validaciones);
  hoja.setFrozenRows(3);
  return infoBloques;
}

function escribirHojaResumenB787_(hoja, infoBloques, nombreHojaVuelos) {
  var headers = ["Pairing ID", "Fecha", "Día Sem", "Vuelo", "Ruta", "Instructor", "Actividad", "AC Type", "Cupos"];
  var P = "'" + nombreHojaVuelos + "'!";

  var filas = [headers];
  infoBloques.forEach(function (info) {
    var r1 = info.leg1Row, r2 = info.leg2Row, rh = info.headerRow;
    filas.push([
      "=" + P + "B" + r1, "=" + P + "C" + r1, "=" + P + "D" + r1,
      "=" + P + "E" + r1 + '&"/"&' + P + "E" + r2,
      "=" + P + "F" + r1 + '&"-"&' + P + "G" + r1 + '&"-"&' + P + "F" + r1,
      '=IF(' + P + "O" + rh + '="","",' + P + "O" + rh + ")",
      '=IF(' + P + "Q" + (rh - 1) + '="","",' + P + "Q" + (rh - 1) + ")",
      "=" + P + "J" + r1,
      info.cupos,
    ]);
  });

  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}

// ============================================================================
// 3. ASIGNACIÓN DE INSTRUCTOR (round-robin + disponibilidad real) — sin equidad acumulada
// ============================================================================
// Reparte por round-robin DENTRO de esta corrida (no hay archivo de equidad B787 todavía, ver
// nota del encabezado) y verifica disponibilidad real contra "Visua_Octubre_2026" (misma
// función `obtenerDisponibilidadMatriz_`/`estaDisponibleEnFecha_` que usa B767, con matching
// difuso de nombres incluido). Si nadie habilitado está disponible esa fecha, el pairing queda
// sin asignar y se reporta — no se inventa una asignación.
function asignarInstructoresB787() {
  var ID_ARCHIVO_DESTINO = "1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY";
  var NOMBRE_HOJA_VUELOS = "Vuelos B787";
  var COL_INSTRUCTOR = 15;

  var ID_MATRIZ = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var NOMBRE_HOJA_MATRIZ = "Visua_Octubre_2026";

  var nombresInstructores = obtenerInstructoresIdeB787_();
  if (nombresInstructores.length === 0) {
    SpreadsheetApp.getUi().alert("No encontré instructores con 'IDE B787 = OK' en el Rol de Instructores.");
    return;
  }

  var matrizInfo = obtenerDisponibilidadMatriz_(ID_MATRIZ, NOMBRE_HOJA_MATRIZ);
  if (!matrizInfo) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña '" + NOMBRE_HOJA_MATRIZ + "' -> no puedo verificar disponibilidad real, me detengo.");
    return;
  }

  var ss = SpreadsheetApp.openById(ID_ARCHIVO_DESTINO);
  var hojaVuelos = ss.getSheetByName(NOMBRE_HOJA_VUELOS);
  if (!hojaVuelos) {
    SpreadsheetApp.getUi().alert("No encontré la hoja '" + NOMBRE_HOJA_VUELOS + "' -> corre primero armarPairingsVuelosB787().");
    return;
  }
  var valores = hojaVuelos.getDataRange().getValues();

  var bloques = [];
  for (var i = 0; i < valores.length; i++) {
    if (valores[i][1] === "Pairing ID") {
      var filaIdaIdx = i + 1, filaVueltaIdx = i + 2;
      var fechaIdaRaw = valores[filaIdaIdx] ? valores[filaIdaIdx][2] : null;
      if (!fechaIdaRaw) continue;
      var fechaIda = parsearFechaCelda_(fechaIdaRaw);
      var fechaVueltaRaw = valores[filaVueltaIdx] ? valores[filaVueltaIdx][2] : null;
      var fechaVuelta = fechaVueltaRaw ? parsearFechaCelda_(fechaVueltaRaw) : fechaIda;
      bloques.push({ headerRowNum: i + 1, fecha: fechaIda, fechas: (fechaVuelta !== fechaIda) ? [fechaIda, fechaVuelta] : [fechaIda] });
    }
  }
  if (bloques.length === 0) {
    SpreadsheetApp.getUi().alert("No encontré bloques de pairings en '" + NOMBRE_HOJA_VUELOS + "' -> corre primero armarPairingsVuelosB787().");
    return;
  }
  bloques.sort(function (a, b) { return a.fecha - b.fecha; });

  var conteoEstaCorrida = {};
  nombresInstructores.forEach(function (n) { conteoEstaCorrida[n] = 0; });
  var fechasPorInstructor = {};
  var asignaciones = [];
  var sinInstructorDisponible = [];

  bloques.forEach(function (bloque) {
    var candidatos = nombresInstructores.slice().sort(function (a, b) { return conteoEstaCorrida[a] - conteoEstaCorrida[b]; });
    var elegido = null;

    for (var k = 0; k < candidatos.length; k++) {
      var nombre = candidatos[k];
      var fechasPrevias = fechasPorInstructor[nombre] || [];
      var ocupaDiaAdyacente = bloque.fechas.some(function (fb) {
        return fechasPrevias.some(function (f) { return Math.abs(fb - f) <= 86400000; });
      });
      if (ocupaDiaAdyacente) continue;

      var disponibleTodasLasFechas = true, desconocido = false;
      for (var fi = 0; fi < bloque.fechas.length; fi++) {
        var disp = estaDisponibleEnFecha_(matrizInfo, nombre, bloque.fechas[fi]);
        if (disp === null) { desconocido = true; break; }
        if (!disp) { disponibleTodasLasFechas = false; break; }
      }
      if (desconocido || !disponibleTodasLasFechas) continue;

      elegido = nombre;
      break;
    }

    if (!elegido) { sinInstructorDisponible.push(bloque.headerRowNum); return; }

    asignaciones.push({ headerRowNum: bloque.headerRowNum, nombre: elegido });
    conteoEstaCorrida[elegido]++;
    bloque.fechas.forEach(function (f) {
      (fechasPorInstructor[elegido] = fechasPorInstructor[elegido] || []).push(f);
    });
  });

  var rangoO = hojaVuelos.getRange(1, COL_INSTRUCTOR, valores.length, 1);
  var columnaO = rangoO.getValues();
  asignaciones.forEach(function (a) { columnaO[a.headerRowNum - 1][0] = a.nombre; });
  rangoO.setValues(columnaO);

  var resumenConteo = Object.keys(conteoEstaCorrida)
    .filter(function (n) { return conteoEstaCorrida[n] > 0; })
    .map(function (n) { return n + ": " + conteoEstaCorrida[n]; }).join("\n");
  var avisoSinDisponible = sinInstructorDisponible.length > 0
    ? "\n\nSIN INSTRUCTOR DISPONIBLE (revisar a mano): filas " + sinInstructorDisponible.join(", ")
    : "";

  SpreadsheetApp.getUi().alert(
    "Asignación B787 completada (round-robin + disponibilidad real, sin archivo de equidad).\n" +
    "Pairings asignados: " + asignaciones.length + " de " + bloques.length + "\n\n" +
    "Reparto de esta corrida:\n" + resumenConteo + avisoSinDisponible
  );
}

// ============================================================================
// 4. SUBIR LAS ASIGNACIONES A LA MATRIZ VISUAL ("Visua_Octubre_2026")
// ============================================================================
// Mismo mecanismo que `subirAsignacionesAVisualB767()` (ver ese archivo para el detalle del
// formato de 6 líneas), adaptado a la hoja "Vuelos B787".
function subirAsignacionesAVisualB787() {
  var ID_ARCHIVO_VUELOS = "1aSTyd0KUBio7DBaSwwR_8EDAVOW06Un0N2bGlE3p_FY";
  var NOMBRE_HOJA_VUELOS = "Vuelos B787";
  var COL_INSTRUCTOR = 15;
  var COL_ACTIVIDAD = 17;

  var ID_MATRIZ = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var NOMBRE_HOJA_MATRIZ = "Visua_Octubre_2026";

  var ssVuelos = SpreadsheetApp.openById(ID_ARCHIVO_VUELOS);
  var hojaVuelos = ssVuelos.getSheetByName(NOMBRE_HOJA_VUELOS);
  if (!hojaVuelos) {
    SpreadsheetApp.getUi().alert("No encontré la hoja '" + NOMBRE_HOJA_VUELOS + "' -> corre primero armarPairingsVuelosB787() y asignarInstructoresB787().");
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
    if (!nombreInstructor) continue;

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
    SpreadsheetApp.getUi().alert("No encontré ningún pairing con instructor ya asignado en '" + NOMBRE_HOJA_VUELOS + "' -> corre primero asignarInstructoresB787().");
    return;
  }

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
    ? "\n\nAVISO: no encontré fila para estos instructores en '" + NOMBRE_HOJA_MATRIZ + "': " + Object.keys(noEncontrados).join(", ")
    : "";

  SpreadsheetApp.getUi().alert(
    "Subida a la matriz visual (B787) completada.\n" +
    "Celdas escritas: " + celdasEscritas + " (de " + bloques.length + " pairings con instructor asignado)." +
    avisoNoEncontrados
  );
}
