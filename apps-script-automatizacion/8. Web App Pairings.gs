/*
Web App (2026-10-03) — pedido urgente: una página web (Apps Script Web App) donde se elige MES
(octubre/noviembre/diciembre 2026) y FLOTA (A320 narrow body, o B767/B787 wide body), y genera
un Google Sheet NUEVO (en una carpeta nueva, dentro de tu Drive) con las hojas "Vuelos" y
"Resumen" — SOLO el formato de búsqueda de vuelos (Instructor/Actividad quedan en blanco para
que tu jefe los llene a mano). NO toca ninguno de los archivos/hojas que ya tienes.

### Cómo desplegarlo
1. Copia este archivo y "WebAppPairingsForm.html" al editor de Apps Script (del mismo proyecto
   de Matriz_Octubre_2026, o uno nuevo — no importa, es independiente).
2. "WebAppPairingsForm.html" debe crearse como archivo de tipo HTML (no .gs) con ESE nombre
   exacto (sin la extensión al nombrarlo en Apps Script).
3. Implementación > Nueva implementación > Tipo: Aplicación web. Ejecutar como "Yo", acceso
   "Cualquier usuario con el enlace de la organización" (o lo que corresponda). Deploy.
4. Abre la URL que te da el deploy -> ahí eliges mes y flota, le das "Generar", y te da el link
   al Google Sheet ya armado.

### Qué hace cada flota — "disclaimer" de reglas (para el jefe)

**Narrow Body (A320/A319, flota "320"):** 1 bloque = 2 pairings combinados en el mismo día (4
filas: ida+vuelta del pairing A, ida+vuelta del pairing B), porque un solo pairing NB no llena
un día de instructor. Reglas (manual "Traspaso FREEZE LP", Parte 2, pasos 2.9-2.15, ya
validadas en sesiones anteriores): sale de LIM después de las 08:30, cada tramo con HBT > 1h,
destinos válidos AQP/CIX/CJA/CUZ/IQT/PCL/PEM/PIU/TPP, PSV del día ≤ 11h, y el segundo pairing
del bloque debe salir entre 50min y 1h30 después de que el primero vuelve a LIM. Además de los
bloques ya armados, se agrega una columna "Posible 2do vuelo" que muestra, para CADA candidato,
qué otros pairings del mismo día también calzarían en esa ventana de conexión (para que se
pueda verificar o rearmar el emparejamiento a mano si hace falta).

**Wide Body (B767/B787):** 1 bloque = 1 pairing completo (ida+vuelta ya vienen juntos). B767
vuela LIM-MIA-LIM (ida y vuelta en fechas distintas, viaje de varios días) y LIM-SCL-LIM (mismo
día); B787 solo LIM-SCL-LIM. Reglas ya validadas en los otros archivos de este proyecto
("5. buscar vuelos B767/B787.gs"): mismas rutas/números de vuelo de entrenamiento confirmados,
lunes a viernes, presentación no domingo, `dia_duty` contiguo con rango ≤ 2.

**Importante — igual que el resto de este proyecto, sin inventar nada:** esto solo arma los
VUELOS candidatos (el "formato"). No asigna instructor, no verifica equidad, no sube nada a
ninguna matriz visual — eso es un paso aparte (ya construido para B767/B787 en los otros
archivos; para NB con este formato de "jefe llena a mano" no hace falta, según lo que pediste).

### Exclusiones de ruta por mes (AQP)
En sesiones anteriores se confirmó que AQP se excluye de las rutas válidas NB en septiembre y
octubre 2026 (por el Perumín). **Para noviembre/diciembre 2026 esto NO está confirmado** — por
default se incluye AQP en esos meses; si tu jefe sabe que sigue excluido, avísame para
ajustarlo (es una sola línea de código, `EXCLUSIONES_POR_MES_NB_` más abajo).
*/

// ============================================================================
// Helpers compartidos, copiados aquí para que este archivo sea AUTOCONTENIDO (bug real
// reportado 2026-10-03: "cargarYFiltrarWB_ is not defined" -> Fernando desplegó este Web App en
// un proyecto de Apps Script que NO tiene "5. buscar vuelos B767.gs", así que las funciones que
// se reutilizaban por scope global compartido no existían ahí). Son copia textual de las mismas
// funciones de ese archivo — si ambos archivos terminan en el mismo proyecto, no hay problema:
// son idénticas, y `function`/`var` no truenan por redeclararse en Apps Script.
// ============================================================================
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

function cargarYFiltrarWB_(filasCrudas, mesObjetivo, anioObjetivo) {
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

  var porPk = {};
  piernas.forEach(function (p) { (porPk[p._pk] = porPk[p._pk] || []).push(p); });

  var validos = [];
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
  validos.forEach(function (p) { (porPk[p._pk] = porPk[p._pk] || []).push(p); });
  var out = {};
  Object.keys(porPk).forEach(function (pk) {
    var piernas = porPk[pk].sort(function (a, b) { return a.diaDuty - b.diaDuty; });
    if (piernas.length === 2) out[pk] = piernas;
  });
  return out;
}

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('WebAppPairingsForm')
    .setTitle('Generar Pairings — NB / WB')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ============================================================================
// FLUJO UNIFICADO (2026-10-03, pedido de Fernando) — un solo panel con Mes + Filial + Flota +
// Subflota + Tipo de carga, y 3 pasos progresivos: "Ver vista previa" (base cruda, sin reglas
// de LCK) -> "Generar candidatos" (aplica las reglas NB/WB según qué subflotas se eligieron) ->
// "Generar Google Sheet" (escribe el archivo final). Reemplaza el flujo viejo de un solo
// desplegable de Flota.
//
// "Tipo de carga" SÍ se respeta en los 3 pasos (reemplaza el `load_type_code = 'FP'` que estaba
// fijo en las consultas NB/WB). "Filial" igual, en los 3 pasos. Si se eligen subflotas sin
// reglas de candidato definidas (ej. 773=B777, 330=A330) -> esas quedan FUERA de "Generar
// candidatos"/"Generar Sheet" (sí aparecen en "Ver vista previa", que es solo data cruda) y se
// avisa en el resultado -> no se inventan reglas para flotas que no se han confirmado.
// ============================================================================

// A qué "grupo de reglas" (NB o WB-767 o WB-787) pertenece cada subflota elegida.
function identificarGruposFlota_(subflotas) {
  var grupos = [];
  var subflotasNB = subflotas.filter(function (s) { return s === "319" || s === "320"; });
  if (subflotasNB.length > 0) {
    grupos.push({ clave: "NB", etiqueta: "NB A320/A319", tipo: "NB", subflotasNB: subflotasNB });
  }
  if (subflotas.indexOf("763") !== -1) {
    grupos.push({ clave: "B767", etiqueta: "WB B767", tipo: "WB", subflotasWB: ["763"], cupos: 5, actividad: "LCK B767" });
  }
  var subflotas787 = subflotas.filter(function (s) { return s === "788" || s === "789"; });
  if (subflotas787.length > 0) {
    grupos.push({ clave: "B787", etiqueta: "WB B787", tipo: "WB", subflotasWB: subflotas787, cupos: 6, actividad: "LCK B787" });
  }
  return grupos;
}

// NOTA (2026-10-04, bug reportado por Fernando): "flotas" YA NO se pasa a este pipeline.
// Antes se aplicaba el mismo filtro de Flota a los 3 grupos de reglas (NB/B767/B787) por
// igual -> si marcabas Flota=NB pero tenías también subflotas de WB marcadas (763/788/789,
// aunque sea por "Marcar todas"), los grupos B767/B787 terminaban cruzando
// "fleet_type_code='NB'" contra vuelos que en la data real tienen fleet_type_code='WB', y
// siempre daban 0 candidatos en silencio (sin ningún aviso de por qué). El enrutamiento a NB/
// B767/B787 YA está 100% determinado por qué Subflotas se marcaron (`identificarGruposFlota_`)
// -> el checkbox de Flota solo tiene sentido como filtro real e independiente en "Ver vista
// previa" (ver `obtenerFacetasYVistaPrevia`/`consultarFacetasYVistaPrevia_`), no acá.
function previsualizarCandidatosDesdeFiltros(mesStr, filiales, subflotas) {
  var mes = parseInt(mesStr, 10);
  var anio = 2026;
  var PROJECT_ID_FACTURACION = "datadem-home";
  var grupos = identificarGruposFlota_(subflotas);

  var columnas = ["Flota", "Pairing ID", "Fecha Ida", "DíaSem", "Vuelo Ida", "Dep", "Arr", "STD Ida", "STA Ida",
    "Fecha Vuelta", "Vuelo Vuelta", "Dep Vta", "Arr Vta", "STD Vuelta", "STA Vuelta", "Conexión/PSV (solo NB)", "Sub Flota", "Posible 2do vuelo (solo NB)"];

  if (grupos.length === 0) {
    return {
      columnas: columnas, filas: [], total: 0, excluidosCount: null,
      aviso: "No hay reglas de candidatos definidas para las subflotas elegidas (solo existen para 319/320 = NB y 763/788/789 = WB). Revisa 'Ver vista previa' para ver la data cruda de esas subflotas igual.",
    };
  }

  var filas = [];
  var excluidosTotal = 0;
  var huboNB = false;
  var subflotasSinReglas = subflotas.filter(function (s) { return ["319", "320", "763", "788", "789"].indexOf(s) === -1; });

  grupos.forEach(function (g) {
    if (g.tipo === "NB") {
      huboNB = true;
      var r = calcularCandidatosNB_(PROJECT_ID_FACTURACION, mes, anio, filiales, g.subflotasNB);
      excluidosTotal += r.excluidos.length;
      r.validos.forEach(function (v) {
        filas.push(["NB", v.pairingId, v.fecha, v.diaSem, v.vueloIda, v.dep, v.arr, String(v.stdIda), String(v.staIda),
          "", v.vueloVuelta, v.depVta, v.arrVta, String(v.stdVuelta), String(v.staVuelta),
          "Cx " + formatearDuracionHhMm_(v.conexionMs) + " / PSV " + formatearDuracionHhMm_(v.psvMs), v.subFlota, v.posible2do]);
      });
    } else {
      var rWB = calcularCandidatosWB_(PROJECT_ID_FACTURACION, mes, anio, g.subflotasWB, filiales);
      Object.keys(rWB.pairingsPorPk).forEach(function (pk) {
        var piernas = rWB.pairingsPorPk[pk];
        var ida = piernas[0], vta = piernas[1];
        filas.push([g.etiqueta, ida.trip, formatearDDMMYYYY_(ida.fechaVueloDt), ida.diaSemana, ida.vuelo, ida.dep, ida.arr, String(ida.std), String(ida.sta),
          formatearDDMMYYYY_(vta.fechaVueloDt), vta.vuelo, vta.dep, vta.arr, String(vta.std), String(vta.sta), "", ida.subFleet, ""]);
      });
    }
  });

  var aviso = subflotasSinReglas.length > 0
    ? "Subflotas sin reglas de candidato definidas, omitidas acá: " + subflotasSinReglas.join(", ")
    : null;

  return { columnas: columnas, filas: filas, total: filas.length, excluidosCount: huboNB ? excluidosTotal : null, aviso: aviso };
}

// Llamada desde el HTML vía google.script.run. Devuelve la URL del Sheet generado — una hoja
// "Vuelos <grupo>"/"Resumen <grupo>"/"Candidatos <grupo>" (+"Excluidos NB" si aplica) POR CADA
// grupo de flota presente en la selección de Subflota (puede terminar con varias flotas en el
// mismo archivo, ej. NB + B767 + B787 juntos si se marcan todas las subflotas correspondientes).
function generarPairingsDesdeFiltros(mesStr, filiales, subflotas) {
  var mes = parseInt(mesStr, 10);
  var anio = 2026;
  var PROJECT_ID_FACTURACION = "datadem-home";
  var grupos = identificarGruposFlota_(subflotas);
  if (grupos.length === 0) {
    throw new Error("No hay reglas de candidatos definidas para las subflotas elegidas (solo 319/320/763/788/789).");
  }

  var nombresMes = { 10: "Octubre", 11: "Noviembre", 12: "Diciembre" };
  var nombreMes = nombresMes[mes] || ("Mes" + mes);
  var etiquetas = grupos.map(function (g) { return g.etiqueta; }).join(" + ");
  var nombreArchivo = "Pairings " + etiquetas + " - " + nombreMes + " " + anio;

  var carpeta = obtenerOCrearCarpetaWebApp_();
  var ss = SpreadsheetApp.create(nombreArchivo);
  var archivo = DriveApp.getFileById(ss.getId());
  carpeta.addFile(archivo);
  DriveApp.getRootFolder().removeFile(archivo);

  var primeraHojaDelArchivo = ss.getSheets()[0];
  var primeraUsada = false;

  grupos.forEach(function (g) {
    var hojaVuelos;
    if (!primeraUsada) {
      hojaVuelos = primeraHojaDelArchivo;
      hojaVuelos.setName("Vuelos " + g.clave);
      primeraUsada = true;
    } else {
      hojaVuelos = ss.insertSheet("Vuelos " + g.clave);
    }
    var hojaResumen = ss.insertSheet("Resumen " + g.clave);
    var hojaCandidatos = ss.insertSheet("Candidatos " + g.clave);

    if (g.tipo === "NB") {
      var hojaExcluidos = ss.insertSheet("Excluidos " + g.clave);
      generarNB_(PROJECT_ID_FACTURACION, mes, anio, hojaVuelos, hojaResumen, hojaCandidatos, hojaExcluidos, filiales, g.subflotasNB);
    } else {
      generarWBGenerico_(PROJECT_ID_FACTURACION, mes, anio, g.subflotasWB, g.cupos, g.actividad, hojaVuelos, hojaResumen, hojaCandidatos, filiales);
    }
  });

  return ss.getUrl();
}

// ============================================================================
// FACETADO TIPO LOOKER, EN EL SERVIDOR (2026-10-03) — reemplaza un primer intento
// (`obtenerRegistrosCrudosMes`) que traía el MES COMPLETO sin ningún filtro a la memoria de
// Apps Script y reventó con "memoria insuficiente": esta tabla cubre TODAS las filiales/flotas/
// subflotas de 2 meses de la aerolínea entera, son decenas o cientos de miles de filas — Apps
// Script no tiene memoria para cargar eso en un array de JS ni para serializarlo a JSON.
//
// La agregación (conteos por valor, para las facetas) y el recorte de la vista previa se hacen
// DENTRO de BigQuery (para eso está hecho, agrega sobre tablas enormes sin problema) -> a Apps
// Script solo le llegan los CONTEOS (unas 20-30 filas) y como máximo 300 filas de vista previa,
// nunca la tabla cruda completa. Esto convierte el facetado de "una sola descarga + filtrado en
// el cliente" a "una consulta a BigQuery por cada cambio de casilla" (como funciona Looker de
// verdad contra una tabla grande) — unos segundos por click, pero sin riesgo de reventar.
// ============================================================================
var QUALIFY_ULTIMA_CARGA_SQL_ = [
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
].join("\n");

function construirWhereDimension_(col, valores) {
  return (valores && valores.length) ? ("    AND " + col + " IN (" + sqlListaStrings_(valores) + ")\n") : "";
}

function obtenerFacetasYVistaPrevia(mesStr, filiales, flotas, subflotas) {
  var mes = parseInt(mesStr, 10);
  var anio = 2026;
  var PROJECT_ID_FACTURACION = "datadem-home";
  return consultarFacetasYVistaPrevia_(PROJECT_ID_FACTURACION, mes, anio, filiales, flotas, subflotas);
}

function consultarFacetasYVistaPrevia_(projectId, mesObjetivo, anioObjetivo, filiales, flotas, subflotas) {
  var fechaInicio = new Date(anioObjetivo, mesObjetivo - 2, 1);
  var fechaFin = new Date(anioObjetivo, mesObjetivo, 0);
  function fmt(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  var whereFilial = construirWhereDimension_("subsidiary_code", filiales);
  var whereFlota = construirWhereDimension_("fleet_type_code", flotas);
  var whereSubflota = construirWhereDimension_("subfleet_code", subflotas);

  // "Tipo de carga" ya NO es un filtro seleccionable (pedido de Fernando 2026-10-03: "esto
  // tiene que estar siempre buscar el FP") -> el `deduped` de acá abajo ya hace exactamente eso
  // sin que haga falta ningún filtro explícito: su QUALIFY se queda con la carga MÁS RECIENTE
  // por partición, prefiriendo SIEMPRE 'FP' y solo cayendo a 'ES' si para esa combinación
  // filial+flota+mes no existe ninguna carga FP -> es el mismo comportamiento que tenía el
  // proyecto antes de que se agregara el checkbox de Tipo de carga (ver [[reference-pairings-manual]]).
  var base = [
    "WITH deduped AS (",
    "  SELECT *",
    "  FROM `operations-data-prod.carmen_gold.crew_pairing_carmen_system`",
    "  WHERE flight_start_date_local_time BETWEEN DATE '" + fmt(fechaInicio) + "' AND DATE '" + fmt(fechaFin) + "'",
    "    AND crew_range_type_code = 'SAB'",
    "  " + QUALIFY_ULTIMA_CARGA_SQL_,
    ")",
  ].join("\n");

  // Para cada dimensión: cuenta agrupado por SU valor, filtrando por las OTRAS 2 (nunca por sí
  // misma) -> así se sabe qué opciones de esa dimensión siguen teniendo registros dado lo que
  // está marcado en las demás (si una opción no aparece en el resultado, es 0). Llamada SIN
  // ningún filtro (los 3 arrays vacíos) también sirve para poblar la lista de opciones reales
  // de cada dimensión (los valores que de verdad existen en la base de datos, no una lista
  // inventada a mano).
  var facetasQuery = base + "\n" + [
    "SELECT 'filial' AS dim, subsidiary_code AS valor, COUNT(*) AS n FROM deduped WHERE TRUE\n" + whereFlota + whereSubflota + "GROUP BY subsidiary_code",
    "SELECT 'flota' AS dim, fleet_type_code AS valor, COUNT(*) AS n FROM deduped WHERE TRUE\n" + whereFilial + whereSubflota + "GROUP BY fleet_type_code",
    "SELECT 'subflota' AS dim, subfleet_code AS valor, COUNT(*) AS n FROM deduped WHERE TRUE\n" + whereFilial + whereFlota + "GROUP BY subfleet_code",
  ].join("\nUNION ALL\n");

  var filasFacetas = ejecutarQueryBigQuery_(facetasQuery, projectId);
  var facetas = { filial: {}, flota: {}, subflota: {} };
  filasFacetas.forEach(function (f) { facetas[f.dim][f.valor] = parseInt(f.n, 10); });

  // Vista previa: las 3 dimensiones en AND (incluida ella misma), recortada a 300 filas. El
  // TOTAL real (antes del recorte) viaja en cada fila vía COUNT(*) OVER() -> en BigQuery el
  // LIMIT se aplica DESPUÉS de evaluar la función de ventana, así que ese total ya refleja TODAS
  // las filas que cumplen el filtro, no solo las 300 que se devuelven.
  var previaQuery = base + "\n" + [
    "SELECT",
    "  pairing_id                       AS trip,",
    "  duty_calendar_day_number         AS dia_duty,",
    "  pairing_start_date               AS fecha_inicio_trip,",
    "  flight_start_date_local_time     AS inicio_vuelo_lt,",
    "  flight_number                    AS vuelo,",
    "  departure_airport_code           AS dep,",
    "  arrival_airport_code             AS arr,",
    "  flight_departure_time_crew_base  AS std_hb,",
    "  flight_arrival_hour_block_time   AS sta_hb,",
    "  flight_block_time                AS hbt,",
    "  subfleet_code                    AS sub_fleet,",
    "  fleet_type_code                  AS flota,",
    "  subsidiary_code                  AS filial,",
    "  load_type_code                   AS tipo_carga,",
    "  COUNT(*) OVER()                  AS total_match",
    "FROM deduped",
    "WHERE TRUE",
    whereFilial + whereFlota + whereSubflota,
    "ORDER BY pairing_id ASC",
    "LIMIT 300",
  ].join("\n");

  var filasPrevia = ejecutarQueryBigQuery_(previaQuery, projectId);
  var columnas = ["trip", "dia_duty", "fecha_inicio_trip", "inicio_vuelo_lt", "vuelo",
    "dep", "arr", "std_hb", "sta_hb", "hbt", "sub_fleet", "flota", "filial", "tipo_carga"];
  var filasOut = filasPrevia.map(function (f) { return columnas.map(function (c) { return f[c]; }); });
  var total = filasPrevia.length > 0 ? parseInt(filasPrevia[0].total_match, 10) : 0;

  return { facetas: facetas, columnas: columnas, filas: filasOut, total: total, recortada: total > filasOut.length };
}

// "Flota" es una columna REAL de la tabla (`fleet_type_code`), DISTINTA de "Subflota"
// (`subfleet_code`) -> no son lo mismo ni se derivan una de la otra con una regla fija
// (confirmado 2026-10-03: Fernando mostró que Flota=NB + Subflota=788/789 en la herramienta de
// referencia da 12 registros, no 0 ni "todo" -> son dos filtros independientes que se cruzan
// con AND, igual que cualquier otro filtro). NO hay una lista fija de valores posibles para
// Flota/Subflota/Filial escrita a mano acá -> Fernando pidió explícitamente (2026-10-03) que
// las opciones de los checkboxes salgan de lo que REALMENTE existe en la base de datos (ej.
// "E02" apareció mal puesto como Flota en un intento anterior, cuando en realidad es un valor
// de Subflota) -> `obtenerFacetasYVistaPrevia` llamada sin filtros (3 arrays vacíos) devuelve
// las opciones reales de cada dimensión, y el HTML arma los checkboxes con eso.
function obtenerOCrearCarpetaWebApp_() {
  var NOMBRE_CARPETA = "Pairings Web App (generados automáticamente)";
  var it = DriveApp.getFoldersByName(NOMBRE_CARPETA);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(NOMBRE_CARPETA);
}

// ============================================================================
// WIDE BODY (B767/B787) — reutiliza la lógica genérica ya validada en
// "5. buscar vuelos B767.gs" (mismo scope global): cargarYFiltrarWB_, armarPairingsPorPk_,
// parsearFechaHoraBQ_, formatearDDMMYYYY_. Solo se escribe nueva la consulta BigQuery (con
// rango de fechas DINÁMICO según el mes elegido, a diferencia de las versiones existentes que
// tienen el rango fijo) y el volcado a hoja (para no tocar las funciones que ya usa el flujo
// mensual real de B767/B787).
// ============================================================================
// Separado de la escritura en Sheet (2026-10-03, para poder reusar lo mismo en la vista
// previa en vivo, que NO escribe nada todavía).
function calcularCandidatosWB_(projectId, mes, anio, subflotas, filiales) {
  var filasCrudas = consultarBigQueryWBGenerico_(projectId, subflotas, mes, anio, filiales);
  var resultado = cargarYFiltrarWB_(filasCrudas, mes, anio);
  var validosFlota = resultado.validos.filter(function (p) { return subflotas.indexOf(p.subFleet) !== -1; });
  var pairingsPorPk = armarPairingsPorPk_(validosFlota);
  return { pairingsPorPk: pairingsPorPk };
}

function generarWBGenerico_(projectId, mes, anio, subflotas, cuposPorVuelo, actividad, hojaVuelos, hojaResumen, hojaCandidatos, filiales) {
  var r = calcularCandidatosWB_(projectId, mes, anio, subflotas, filiales);
  var infoBloques = escribirHojaVuelosWBWebApp_(hojaVuelos, r.pairingsPorPk, cuposPorVuelo, actividad);
  escribirHojaResumenWBWebApp_(hojaResumen, infoBloques, hojaVuelos.getName());
  if (hojaCandidatos) escribirHojaCandidatosWB_(hojaCandidatos, r.pairingsPorPk);
}

// "Candidatos" para WB: 1 fila por pairing (ida+vuelta), con los mismos datos que terminan en
// "Vuelos" pero en formato plano (sin bloques/colores), igual idea que la hoja "Candidatos" de
// NB — acá no hay "Posible 2do vuelo" porque en WB 1 pairing YA es el bloque completo (no se
// combinan 2 pairings distintos como en NB).
function escribirHojaCandidatosWB_(hoja, pairingsPorPk) {
  var headers = ["Pairing ID", "Fecha Ida", "DíaSem", "Vuelo Ida", "Dep", "Arr", "STD Ida", "STA Ida", "HBT Ida",
    "Fecha Vuelta", "Vuelo Vuelta", "Dep Vta", "Arr Vta", "STD Vuelta", "STA Vuelta", "HBT Vuelta", "Sub Flota"];
  var filas = [headers];
  Object.keys(pairingsPorPk).forEach(function (pk) {
    var piernas = pairingsPorPk[pk];
    var ida = piernas[0], vta = piernas[1];
    filas.push([
      ida.trip, formatearDDMMYYYY_(ida.fechaVueloDt), ida.diaSemana, ida.vuelo, ida.dep, ida.arr, String(ida.std), String(ida.sta), String(ida.hbt),
      formatearDDMMYYYY_(vta.fechaVueloDt), vta.vuelo, vta.dep, vta.arr, String(vta.std), String(vta.sta), String(vta.hbt), ida.subFleet,
    ]);
  });
  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}

function consultarBigQueryWBGenerico_(projectId, subflotas, mesObjetivo, anioObjetivo, filiales) {
  filiales = filiales && filiales.length ? filiales : ["LP"];

  var fechaInicio = new Date(anioObjetivo, mesObjetivo - 2, 1); // 1 mes antes, para no perder pairings a caballo
  var fechaFin = new Date(anioObjetivo, mesObjetivo, 0); // último día del mes objetivo
  function fmt(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  var subflotasSQL = sqlListaStrings_(subflotas);

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
    "  flight_start_date_local_time BETWEEN DATE '" + fmt(fechaInicio) + "' AND DATE '" + fmt(fechaFin) + "'",
    "  AND subsidiary_code IN (" + sqlListaStrings_(filiales) + ")",
    "  AND crew_range_type_code = 'SAB'",
    "  AND subfleet_code IN (" + subflotasSQL + ")",
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

  return ejecutarQueryBigQuery_(query, projectId);
}

// Helper compartido de ejecución (paginado), igual patrón que las consultas ya existentes.
function ejecutarQueryBigQuery_(query, projectId) {
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

// Igual layout/patrón de "cargar todo a memoria, escribir una vez" que el resto del proyecto,
// pero SIN asignar instructor (se deja en blanco, sin desplegable — "el jefe lo llena a mano").
function escribirHojaVuelosWBWebApp_(hoja, pairingsPorPk, cuposPorVuelo, actividad) {
  var HEADERS = ["Pairing ID", "FECHA REAL", "Day of Week", "Flight No", "Dep Stn", "Arr Stn",
    "STD", "STA", "AC Type", "HBT", "DIA_DUTY"];
  var COL_INSTRUCTOR = 15, COL_ACTIVIDAD = 17, NUM_COLS = 17;

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

  function gridVacio(v) { var g = []; for (var r = 0; r < numFilas; r++) { var f2 = []; for (var c = 0; c < NUM_COLS; c++) f2.push(v); g.push(f2); } return g; }
  var contenido = gridVacio(""), pesos = gridVacio("normal"), fondos = gridVacio(null);
  function set(grid, r, c, v) { grid[r - 1][c - 1] = v; }

  set(contenido, 1, 2, "Vuelos candidatos — Instructor y Actividad en blanco, llenar a mano"); set(pesos, 1, 2, "bold");

  var infoBloques = [];
  posiciones.forEach(function (pos) {
    var piernas = pairingsPorPk[pos.pk];
    var ida = piernas[0], vta = piernas[1];
    var preRow = pos.preRow, headerRow = pos.headerRow, leg1Row = pos.leg1Row, leg2Row = pos.leg2Row,
        postRow1 = pos.postRow1, postRow2 = pos.postRow2;

    for (var j = 0; j < HEADERS.length; j++) { set(contenido, headerRow, 2 + j, HEADERS[j]); set(pesos, headerRow, 2 + j, "bold"); }
    set(fondos, headerRow, COL_INSTRUCTOR, "#FFC000");
    set(fondos, preRow, COL_ACTIVIDAD, "#FFC000");

    [[leg1Row, ida], [leg2Row, vta]].forEach(function (par) {
      var r = par[0], p = par[1];
      var vals = [p.trip, formatearDDMMYYYY_(p.fechaVueloDt), p.diaSemana, p.vuelo, p.dep, p.arr,
        String(p.std), String(p.sta), p.subFleet, String(p.hbt), p.diaDuty];
      for (var k = 0; k < vals.length; k++) set(contenido, r, 2 + k, vals[k]);
    });

    set(contenido, leg2Row, COL_INSTRUCTOR, '=IF(O' + headerRow + '="","",O' + headerRow + ')');
    set(contenido, preRow, COL_ACTIVIDAD, actividad);
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
  hoja.setFrozenRows(3);
  return infoBloques;
}

// ============================================================================
// NARROW BODY (A320/A319) — puerto de generar_candidatos_nb.py + generar_reporte_pairings_nb.py
// ============================================================================

var RUTAS_VALIDAS_NB_ = ["AQP", "CIX", "CJA", "CUZ", "IQT", "PCL", "PEM", "PIU", "TPP"];

// AQP confirmado excluido en sept/oct-2026 (Perumín) en sesiones anteriores. NO confirmado
// para nov/dic-2026 todavía -> por default no se excluye nada esos meses (ver disclaimer del
// encabezado del archivo).
var EXCLUSIONES_POR_MES_NB_ = {
  10: ["AQP"],
  11: [],
  12: [],
};

var CONEXION_MIN_MS_ = 50 * 60 * 1000;
var CONEXION_MAX_MS_ = 90 * 60 * 1000;
var PSV_MAX_MS_ = 11 * 60 * 60 * 1000;
var HORA_MIN_SALIDA_MS_ = 8.5 * 60 * 60 * 1000;
var HBT_MIN_MS_ = 60 * 60 * 1000;

// Separado de la escritura en Sheet (2026-10-03), mismo motivo que `calcularCandidatosWB_`.
function calcularCandidatosNB_(projectId, mes, anio, filiales, subflotasNB) {
  var filasCrudas = consultarBigQueryNB_(projectId, mes, anio, filiales, subflotasNB);
  var piernas = cargarYDepurarNB_(filasCrudas);

  var diaDutyMinRealPorTrip = {};
  piernas.forEach(function (p) {
    if (!(p.trip in diaDutyMinRealPorTrip) || p.diaDuty < diaDutyMinRealPorTrip[p.trip]) {
      diaDutyMinRealPorTrip[p.trip] = p.diaDuty;
    }
  });

  var exclusiones = EXCLUSIONES_POR_MES_NB_[mes] || [];
  var piernasFiltradas = filtrarMesYRutaNB_(piernas, mes, anio, exclusiones);
  var resultado = armarPrimerasMitadesNB_(piernasFiltradas, diaDutyMinRealPorTrip);
  return { validos: resultado.validos, excluidos: resultado.excluidos };
}

function generarNB_(projectId, mes, anio, hojaVuelos, hojaResumen, hojaCandidatos, hojaExcluidos, filiales, subflotasNB) {
  var r = calcularCandidatosNB_(projectId, mes, anio, filiales, subflotasNB);
  var bloques = parearCandidatosNB_(r.validos);

  var infoBloques = escribirHojaVuelosNB_(hojaVuelos, bloques);
  escribirHojaResumenNB_(hojaResumen, infoBloques, hojaVuelos.getName());
  if (hojaCandidatos) escribirHojaCandidatosNB_(hojaCandidatos, r.validos);
  if (hojaExcluidos) escribirHojaExcluidosNB_(hojaExcluidos, r.excluidos);
}

// "Candidatos": tabla plana de los candidatos válidos (1 fila por trip, ida+vuelta), igual
// formato que la hoja "Candidatos_validos" de `generar_candidatos_nb.py` (incluye Conexión/PSV
// ya calculados como texto "h:mm" y "Posible 2do vuelo").
function escribirHojaCandidatosNB_(hoja, validos) {
  var headers = ["Fecha", "DíaSem", "Pairing ID", "Vuelo Ida", "Dep", "Arr", "STD Ida", "STA Ida", "HBT Ida",
    "Vuelo Vuelta", "Dep Vta", "Arr Vta", "STD Vuelta", "STA Vuelta", "HBT Vuelta",
    "Conexión", "PSV Total", "Sub Flota", "Posible 2do vuelo (mismo día)"];
  var filas = [headers];
  validos.forEach(function (v) {
    filas.push([
      v.fecha, v.diaSem, v.pairingId, v.vueloIda, v.dep, v.arr, String(v.stdIda), String(v.staIda), String(v.hbtIda),
      v.vueloVuelta, v.depVta, v.arrVta, String(v.stdVuelta), String(v.staVuelta), String(v.hbtVuelta),
      formatearDuracionHhMm_(v.conexionMs), formatearDuracionHhMm_(v.psvMs), v.subFlota, v.posible2do,
    ]);
  });
  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}

// "Excluidos": qué trips se descartaron en el paso de "primera mitad" y por qué — mismo
// contenido que la hoja "Excluidos_primera_mitad" de `generar_candidatos_nb.py`. OJO: esto es
// SOLO lo que se descarta en `armarPrimerasMitadesNB_`; un trip también puede haber quedado
// fuera antes, en `filtrarMesYRutaNB_` (mes/ruta), y ese paso no registra motivo por trip (es
// un filtro a nivel de PIERNA, no de trip completo) -> si un trip no aparece ni en "Candidatos"
// ni en "Excluidos", lo más probable es que ninguna de sus piernas haya pasado el filtro de
// mes/ruta en absoluto.
function escribirHojaExcluidosNB_(hoja, excluidos) {
  var headers = ["Pairing ID", "Motivo"];
  var filas = [headers];
  excluidos.forEach(function (e) { filas.push([e.trip, e.motivo]); });
  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}

function sqlListaStrings_(valores) {
  return valores.map(function (v) { return "'" + String(v).replace(/'/g, "") + "'"; }).join(", ");
}

function consultarBigQueryNB_(projectId, mesObjetivo, anioObjetivo, filiales, subflotasNB) {
  filiales = filiales && filiales.length ? filiales : ["LP"];
  subflotasNB = subflotasNB && subflotasNB.length ? subflotasNB : ["319", "320"];

  var fechaInicio = new Date(anioObjetivo, mesObjetivo - 2, 1);
  var fechaFin = new Date(anioObjetivo, mesObjetivo, 0);
  function fmt(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  var query = [
    "SELECT",
    "  pairing_id                       AS trip,",
    "  flight_start_date_local_time     AS inicio_vuelo_lt,",
    "  duty_calendar_day_number         AS dia_duty,",
    "  flight_number                    AS vuelo,",
    "  departure_airport_code           AS dep,",
    "  arrival_airport_code             AS arr,",
    "  flight_departure_time_crew_base  AS std_hb,",
    "  flight_arrival_hour_block_time   AS sta_hb,",
    "  flight_block_time                AS hbt,",
    "  subfleet_code                    AS sub_fleet",
    "FROM `operations-data-prod.carmen_gold.crew_pairing_carmen_system`",
    "WHERE",
    "  flight_start_date_local_time BETWEEN DATE '" + fmt(fechaInicio) + "' AND DATE '" + fmt(fechaFin) + "'",
    "  AND subsidiary_code IN (" + sqlListaStrings_(filiales) + ")",
    "  AND crew_range_type_code = 'SAB'",
    "  AND subfleet_code IN (" + sqlListaStrings_(subflotasNB) + ")",
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

  return ejecutarQueryBigQuery_(query, projectId);
}

function horaATimedeltaMin_(valor) {
  var p = String(valor).split(":");
  return parseInt(p[0], 10) * 60 + parseInt(p[1], 10) + (parseFloat(p[2]) || 0) / 60;
}

function cargarYDepurarNB_(filasCrudas) {
  return filasCrudas.map(function (f) {
    var fechaHoraVuelo = parsearFechaHoraBQ_(f.inicio_vuelo_lt);
    var fechaPura = new Date(fechaHoraVuelo.getFullYear(), fechaHoraVuelo.getMonth(), fechaHoraVuelo.getDate());
    var stdMin = horaATimedeltaMin_(f.std_hb);
    var staMin = horaATimedeltaMin_(f.sta_hb);
    var hbtMin = horaATimedeltaMin_(f.hbt);
    var stdDt = new Date(fechaPura.getTime() + stdMin * 60000);
    var staDt = new Date(fechaPura.getTime() + staMin * 60000);
    if (staDt < stdDt) staDt = new Date(staDt.getTime() + 86400000);
    return {
      trip: String(f.trip), diaDuty: parseInt(f.dia_duty, 10),
      fechaDt: fechaPura, diaSemana: DIAS_SEMANA_ES_[fechaPura.getDay()],
      vuelo: parseInt(f.vuelo, 10), dep: f.dep, arr: f.arr,
      std: f.std_hb, sta: f.sta_hb, hbt: f.hbt, hbtMs: hbtMin * 60000,
      stdDt: stdDt, staDt: staDt, subFleet: String(f.sub_fleet),
    };
  });
}

function filtrarMesYRutaNB_(piernas, mes, anio, exclusiones) {
  var rutasValidas = {};
  RUTAS_VALIDAS_NB_.forEach(function (r) { if (exclusiones.indexOf(r) === -1) rutasValidas[r] = true; });

  return piernas.filter(function (p) {
    var enMes = (p.fechaDt.getMonth() + 1 === mes) && (p.fechaDt.getFullYear() === anio);
    var saleDeLim = p.dep === "LIM";
    var llegaALim = p.arr === "LIM";
    var rutaOk = !!rutasValidas[p.arr] || llegaALim;
    return enMes && (saleDeLim || llegaALim) && rutaOk;
  });
}

// Devuelve {validos, excluidos} — `excluidos` trae el MOTIVO exacto de cada trip descartado
// (puerto 1:1 de la misma lógica/motivos de `generar_candidatos_nb.py`), para que se pueda
// auditar qué se filtró y por qué (pedido explícito de Fernando 2026-10-03).
function armarPrimerasMitadesNB_(piernasFiltradas, diaDutyMinRealPorTrip) {
  var porTrip = {};
  piernasFiltradas.forEach(function (p) { (porTrip[p.trip] = porTrip[p.trip] || []).push(p); });

  var validos = [];
  var excluidos = [];
  function excluir(trip, motivo) { excluidos.push({ trip: trip, motivo: motivo }); }

  Object.keys(porTrip).forEach(function (trip) {
    var grupo = porTrip[trip];
    var diaMin = Math.min.apply(null, grupo.map(function (p) { return p.diaDuty; }));
    if (diaDutyMinRealPorTrip[trip] !== undefined && diaMin !== diaDutyMinRealPorTrip[trip]) {
      excluir(trip, "el día " + diaMin + " que sobrevivió el filtro no es el día 1 real del pairing (día 1 real = " + diaDutyMinRealPorTrip[trip] + ", cayó fuera de mes/ruta)");
      return;
    }

    var dia1 = grupo.filter(function (p) { return p.diaDuty === diaMin; }).sort(function (a, b) { return a.stdDt - b.stdDt; });
    if (dia1.length < 2) { excluir(trip, "día 1 sin vuelta el mismo día (1 solo tramo)"); return; }
    if ([6, 8, 10].indexOf(dia1.length) !== -1) { excluir(trip, "día 1 tiene " + dia1.length + " tramos -> no se toma"); return; }

    var ida = dia1[0], vuelta = dia1[1];
    if (ida.dep !== "LIM") { excluir(trip, "el primer tramo no sale de LIM"); return; }
    if (vuelta.arr !== "LIM") { excluir(trip, "el segundo tramo del día 1 no vuelve a LIM"); return; }
    if (vuelta.dep !== ida.arr) { excluir(trip, "vuelta sale de " + vuelta.dep + " pero la ida llegó a " + ida.arr + " (ruta triangular)"); return; }

    var motivos = [];
    if ((ida.stdDt - ida.fechaDt) <= HORA_MIN_SALIDA_MS_) motivos.push("sale antes/igual a 08:30");
    if (ida.hbtMs <= HBT_MIN_MS_) motivos.push("HBT ida <= 1h");
    if (vuelta.hbtMs <= HBT_MIN_MS_) motivos.push("HBT vuelta <= 1h");
    var conexionMs = vuelta.stdDt - ida.staDt;
    if (conexionMs <= 0) motivos.push("conexión interna negativa/cero");
    var psvMs = vuelta.staDt - ida.stdDt;
    if (psvMs > PSV_MAX_MS_) motivos.push("PSV > 11h");
    if (motivos.length > 0) { excluir(trip, motivos.join("; ")); return; }

    validos.push({
      fecha: formatearDDMMYYYY_(ida.fechaDt), diaSem: ida.diaSemana, pairingId: trip,
      vueloIda: ida.vuelo, dep: ida.dep, arr: ida.arr, stdIda: ida.std, staIda: ida.sta, hbtIda: ida.hbt,
      vueloVuelta: vuelta.vuelo, depVta: vuelta.dep, arrVta: vuelta.arr, stdVuelta: vuelta.std, staVuelta: vuelta.sta, hbtVuelta: vuelta.hbt,
      subFlota: ida.subFleet, conexionMs: conexionMs, psvMs: psvMs,
      _ordenTs: ida.stdDt.getTime(), _idaStdTs: ida.stdDt.getTime(), _vueltaStaTs: vuelta.staDt.getTime(),
    });
  });

  validos.sort(function (a, b) { return a._ordenTs - b._ordenTs; });

  // "Posible 2do vuelo (mismo día)": para cada candidato, qué OTROS candidatos del mismo día
  // conectarían dentro de (50min, 1h30) desde su regreso -> mismo cálculo que
  // `generar_candidatos_nb.py`'s columna homónima, para poder verificar/rearmar a mano.
  validos.forEach(function (row) {
    var posibles = validos.filter(function (c) {
      return c.pairingId !== row.pairingId && c.fecha === row.fecha &&
        c._idaStdTs > (row._vueltaStaTs + CONEXION_MIN_MS_) && c._idaStdTs < (row._vueltaStaTs + CONEXION_MAX_MS_);
    }).map(function (c) { return c.pairingId; });
    row.posible2do = posibles.join(", ");
  });

  return { validos: validos, excluidos: excluidos };
}

function formatearDuracionHhMm_(ms) {
  if (ms === undefined || ms === null) return "";
  var signo = ms < 0 ? "-" : "";
  var totalMin = Math.round(Math.abs(ms) / 60000);
  var h = Math.floor(totalMin / 60), m = totalMin % 60;
  return signo + h + ":" + String(m).padStart(2, "0");
}

function parearCandidatosNB_(validos) {
  var usados = {};
  var bloques = [];
  validos.forEach(function (row) {
    if (usados[row.pairingId]) return;
    var candidato2 = null;
    for (var i = 0; i < validos.length; i++) {
      var c = validos[i];
      if (usados[c.pairingId] || c.pairingId === row.pairingId || c.fecha !== row.fecha) continue;
      if (c._idaStdTs > (row._vueltaStaTs + CONEXION_MIN_MS_) && c._idaStdTs < (row._vueltaStaTs + CONEXION_MAX_MS_)) { candidato2 = c; break; }
    }
    usados[row.pairingId] = true;
    if (candidato2) { usados[candidato2.pairingId] = true; bloques.push([row, candidato2]); }
    else bloques.push([row, null]);
  });
  return bloques;
}

var TITULOS_GRID_NB_ = [
  [1, 2, "Conexión > o = a 50min y < a 1hr y 30min", false],
  [1, 4, "NO CONSIDERAR TRU/JUL/JAE/AYP/JAU/IQT", true],
  [1, 8, "CONSIDERAR PAIRINGS PARTIDOS LCK A320", false],
  [1, 11, "Vuelos LCK = Siempre en Flota 320", false],
  [2, 2, "Vuelos HBT mayor a 1 hora", false],
  [2, 4, "PSV NO MAYOR A 11 HRS", false],
  [2, 8, "CONSIDERAR SIEMPRE EL PDR", false],
  [2, 11, "Vuelos iniciando más de 08:30", false],
  [3, 4, "NO REPETIR PAIRING EN LCK", true],
];
var HEADER_TITULOS_NB_ = ["Pairing ID", "FECHA REAL", "Day of Week", "Flight No", "Dep Stn",
  "Arr Stn", "STD", "STA", "Sub Flota"];
var COL_POSIBLE_2DO_NB_ = 17; // Q, columna dedicada (no hay bloque resumen embebido, a
// diferencia de la WB vieja -> el "Resumen Final" real de NB es una hoja aparte que referencia
// B..J/M/O directo, confirmado releyendo `generar_reporte_pairings_nb.py`).

function escribirHojaVuelosNB_(hoja, bloques) {
  var COL_CONEXION = 11, COL_HBT = 12, COL_INS = 13, COL_DESC = 15;

  // 1er pase: calcular posiciones de fila (el tamaño de cada bloque varía: 1 o 2 candidatos).
  var posiciones = [];
  var fila = 8; // fila_labels(6) + 2
  bloques.forEach(function (bloque, idxBloque) {
    var candA = bloque[0], candB = bloque[1];
    var filaHeader = fila;
    var filasCandidatos = candB ? [candA, candB] : [candA];
    var filasBloque = [];
    var f = fila + 1;
    filasCandidatos.forEach(function () { filasBloque.push([f, f + 1]); f += 2; });
    var filaPsv = f;
    posiciones.push({ idxBloque: idxBloque, filaHeader: filaHeader, filasBloque: filasBloque, filaPsv: filaPsv, candidatos: filasCandidatos });
    fila = filaPsv + 2;
  });
  var numFilas = Math.max(fila - 1, 10);
  var numCols = 17; // hasta Q (posible 2do vuelo)

  function gridVacio(v) { var g = []; for (var r = 0; r < numFilas; r++) { var f2 = []; for (var c = 0; c < numCols; c++) f2.push(v); g.push(f2); } return g; }
  var contenido = gridVacio(""), pesos = gridVacio("normal"), fondos = gridVacio(null);
  function set(grid, r, c, v) { grid[r - 1][c - 1] = v; }

  TITULOS_GRID_NB_.forEach(function (t) {
    set(contenido, t[0], t[1], t[2]);
    set(pesos, t[0], t[1], "bold");
  });
  set(contenido, 6, COL_POSIBLE_2DO_NB_, "Posible 2do vuelo (mismo día)");
  set(pesos, 6, COL_POSIBLE_2DO_NB_, "bold");

  var infoBloques = [];
  posiciones.forEach(function (pos) {
    for (var j = 0; j < HEADER_TITULOS_NB_.length; j++) { set(contenido, pos.filaHeader, 2 + j, HEADER_TITULOS_NB_[j]); set(pesos, pos.filaHeader, 2 + j, "bold"); }

    var r1 = pos.filasBloque[0][0];
    set(fondos, r1, COL_INS, "#FFC000");
    set(fondos, r1, COL_DESC, "#FFC000");

    pos.candidatos.forEach(function (cand, idx) {
      var par = pos.filasBloque[idx];
      var rIda = par[0], rVta = par[1];
      var filaIda = [cand.pairingId, cand.fecha, cand.diaSem, cand.vueloIda, cand.dep, cand.arr, String(cand.stdIda), String(cand.staIda), cand.subFlota];
      var filaVta = [cand.pairingId, cand.fecha, cand.diaSem, cand.vueloVuelta, cand.depVta, cand.arrVta, String(cand.stdVuelta), String(cand.staVuelta), cand.subFlota];
      for (var k = 0; k < filaIda.length; k++) set(contenido, rIda, 2 + k, filaIda[k]);
      for (var k2 = 0; k2 < filaVta.length; k2++) set(contenido, rVta, 2 + k2, filaVta[k2]);
      set(contenido, rIda, COL_HBT, String(cand.hbtIda));
      set(contenido, rVta, COL_HBT, String(cand.hbtVuelta));
      set(contenido, rIda, COL_POSIBLE_2DO_NB_, cand.posible2do);

      if (rIda !== r1) {
        set(contenido, rIda, COL_CONEXION, '=TEXT(TIMEVALUE(H' + rIda + ')-TIMEVALUE(I' + (rIda - 1) + ')+(TIMEVALUE(H' + rIda + ')<TIMEVALUE(I' + (rIda - 1) + ')),"[h]:mm")');
      }
      set(contenido, rVta, COL_CONEXION, '=TEXT(TIMEVALUE(H' + rVta + ')-TIMEVALUE(I' + rIda + ')+(TIMEVALUE(H' + rVta + ')<TIMEVALUE(I' + rIda + ')),"[h]:mm")');

      if (idx > 0) set(contenido, rIda, COL_INS, '=IF($M$' + r1 + '="","",$M$' + r1 + ')');
      if (idx > 0) set(contenido, rIda, COL_DESC, '=IF($O$' + r1 + '="","",$O$' + r1 + ')');
      set(contenido, rVta, COL_DESC, '="LIM-"&G' + rIda + '&"-LIM   LA "&E' + rIda + '&" ("&LEFT(H' + rIda + ',5)&"-"&LEFT(I' + rIda + ',5)&" hrs)  /  LA "&E' + rVta + '&" ("&LEFT(H' + rVta + ',5)&"-"&LEFT(I' + rVta + ',5)&" hrs)"');
    });

    var rUlt = pos.filasBloque[pos.filasBloque.length - 1][1];
    set(contenido, pos.filaPsv, 10, "PSV total:");
    set(pesos, pos.filaPsv, 10, "bold");
    set(contenido, pos.filaPsv, 11, '=TEXT(TIMEVALUE(I' + rUlt + ')-TIMEVALUE(H' + r1 + ')+(I' + rUlt + '<H' + r1 + '),"[h]:mm")');

    infoBloques.push({ idxBloque: pos.idxBloque, r1: r1, filasBloque: pos.filasBloque });
  });

  var rango = hoja.getRange(1, 1, numFilas, numCols);
  rango.setValues(contenido);
  rango.setBackgrounds(fondos);
  rango.setFontWeights(pesos);
  hoja.setFrozenRows(7);
  return infoBloques;
}

// "Resumen Final" real de NB: jala directo de las columnas principales de "Vuelos"
// (B=Pairing ID, C=Fecha, D=DíaSem, E=Vuelo, F/G=Dep/Arr, J=Sub Flota, M=Instructor,
// O=Actividad) — una fila por cada CANDIDATO dentro de cada bloque (si el bloque tiene 2
// pairings, van 2 filas), igual que el "Resumen Final" original de `generar_reporte_pairings_nb.py`.
function escribirHojaResumenNB_(hoja, infoBloques, nombreHojaVuelos) {
  var headers = ["TRIP", "Fecha", "DíaSEM", "Vuelo", "Ruta", "INS", "ACTIVIDAD", "FLOTA"];
  var P = "'" + nombreHojaVuelos + "'!";
  var filas = [headers];
  infoBloques.forEach(function (info) {
    var r1 = info.r1;
    info.filasBloque.forEach(function (par) {
      var rIda = par[0], rVta = par[1];
      filas.push([
        "=" + P + "B" + rIda, "=" + P + "C" + rIda, "=" + P + "D" + rIda,
        "=" + P + "E" + rIda + '&"/"&' + P + "E" + rVta,
        "=" + P + "F" + rIda + '&"-"&' + P + "G" + rIda + '&"-"&' + P + "F" + rIda,
        '=IF(' + P + "M$" + r1 + '="","",' + P + "M$" + r1 + ")",
        '=IF(' + P + "O$" + r1 + '="","",' + P + "O$" + r1 + ")",
        "=" + P + "J" + rIda,
      ]);
    });
  });
  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}

function escribirHojaResumenWBWebApp_(hoja, infoBloques, nombreHojaVuelos) {
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
      "=" + P + "J" + r1, info.cupos,
    ]);
  });
  var rango = hoja.getRange(1, 1, filas.length, headers.length);
  rango.setValues(filas);
  rango.offset(0, 0, 1, headers.length).setFontWeight("bold");
  hoja.setFrozenRows(1);
}
