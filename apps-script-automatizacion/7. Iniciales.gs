/*
Archivo "7. Iniciales" (2026-10-02): actividades de entrenamiento INICIAL (G9, G10, etc.) que
llegan por correo y se registran en el Google Sheet
`1X3ITjRp0H_A8HHwIkq9dRZNma0f_DOQmZdeQG2oRBkE` (pestaña gid 886777284). Columnas reales (fila 1,
confirmadas por captura): A="DÍA" (día de semana, texto), B="DÍA" (fecha real), C="ACTIVIDAD"
(ej. "INICIAL G9", "INICIAL 10"), D="CANTIDAD INS" (cuántos instructores distintos hacen falta
ESE día para esa actividad), E="AULA CAE", F="COMENTARIOS" (ej. "INST. LATAM"/"IDE LATAM" — por
ahora NO se usa para filtrar, ver supuestos abajo), G="COORDINADOR" (siempre "JESHUA", no es un
instructor candidato), H="SALAS", I="Comentario Luis y Marjorie".

### Qué hace `asignarInicialesAVisual()`
1. Lee esa hoja, agrupa las filas por mes/año de la fecha (columna B) -> puede tocar varias
   pestañas "Visua_<Mes>_<Año>" si el archivo trae fechas de más de un mes.
2. Para cada fila con `CANTIDAD INS` numérico > 0 (las que dicen "-" se saltan, no hay nada que
   asignar), busca esa cantidad de instructores DISTINTOS disponibles (celda vacía o "B") esa
   fecha en la pestaña "Visua_<Mes>_<Año>" correspondiente — usando el mismo matching difuso de
   nombres y el mismo parser de fecha "a prueba de Date object" ya construidos en
   "5. buscar vuelos B767.gs" (mismo proyecto de Apps Script, mismo scope global, sin duplicar).
3. Escribe el texto de la actividad (columna C, ej. "INICIAL G9") en la celda de cada instructor
   asignado, con un color de fondo que depende del GRUPO (todo lo que diga "G9" un color, todo
   lo que diga "G10"/"10" otro color, etc. — paleta simple, un color nuevo por cada grupo que
   aparezca por primera vez).

### Supuestos — sin inventar nada, confirmar si hace falta algo más
- **Pool de instructores**: se usa CUALQUIER fila de la Matriz con nombre (no se filtra por IDE
  B767/B787/A320), porque "INICIAL" no parece ser una actividad específica de una flota. Si en
  realidad solo ciertos instructores pueden dictar "INICIAL" (ej. según la columna "COMENTARIOS"
  = "INST. LATAM" vs "IDE LATAM"), avisar para agregar ese filtro.
- **Reparto**: round-robin dentro de esta corrida (igual que B787, no hay archivo de equidad
  para esto) — prioriza a quien tenga menos asignaciones de "Iniciales" en esta misma corrida.
- **Columna de fecha**: se identifica como la columna inmediatamente ANTES de "ACTIVIDAD" (ya
  que el encabezado "DÍA" se repite dos veces y no se puede buscar por texto sin ambigüedad) —
  si cambia el orden de columnas, ajustar `colFecha = colActividad - 1`.
- No se usan las columnas AULA CAE / SALAS / COMENTARIOS / COORDINADOR en el texto escrito —
  solo el nombre de la actividad. Avisar si hace falta incluir esa info en la celda.
*/

function asignarInicialesAVisual() {
  var ID_INICIALES = "1X3ITjRp0H_A8HHwIkq9dRZNma0f_DOQmZdeQG2oRBkE";
  var GID_INICIALES = 886777284;

  var ID_MATRIZ = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";

  var ssIniciales = SpreadsheetApp.openById(ID_INICIALES);
  var hojaIniciales = ssIniciales.getSheets().find(function (h) { return h.getSheetId() === GID_INICIALES; });
  if (!hojaIniciales) {
    SpreadsheetApp.getUi().alert("No encontré la pestaña con GID " + GID_INICIALES + " en el archivo de Iniciales.");
    return;
  }

  var valores = hojaIniciales.getDataRange().getValues();

  var filaHeaderIdx = -1, colActividad = -1, colCantidad = -1, colFecha = -1;
  for (var i = 0; i < valores.length; i++) {
    var fila = valores[i];
    var idxAct = indiceColumnaPorHeaderGenerico_(fila, "ACTIVIDAD");
    var idxCant = indiceColumnaPorHeaderGenerico_(fila, "CANTIDAD INS");
    if (idxAct !== -1 && idxCant !== -1) {
      filaHeaderIdx = i;
      colActividad = idxAct;
      colCantidad = idxCant;
      colFecha = idxAct - 1; // la fecha va inmediatamente antes de "ACTIVIDAD" (ver nota arriba)
      break;
    }
  }
  if (filaHeaderIdx === -1 || colFecha < 0) {
    SpreadsheetApp.getUi().alert("No encontré las columnas 'ACTIVIDAD'/'CANTIDAD INS' en el archivo de Iniciales -> revisar encabezados reales.");
    return;
  }

  // Agrupar filas válidas (cantidad numérica > 0) por la pestaña "Visua_<Mes>_<Año>" que les toca.
  var filasPorHojaMatriz = {};
  for (var r = filaHeaderIdx + 1; r < valores.length; r++) {
    var fechaRaw = valores[r][colFecha];
    var actividad = String(valores[r][colActividad] || "").trim();
    var cantidadRaw = valores[r][colCantidad];
    var cantidad = parseInt(cantidadRaw, 10);

    if (!actividad || isNaN(cantidad) || cantidad <= 0) continue; // "-" o vacío -> nada que asignar

    var fechaTs = parsearFechaCelda_(fechaRaw);
    if (fechaTs === null) continue;

    var nombreHojaMatriz = nombreHojaVisualPara_(new Date(fechaTs));
    (filasPorHojaMatriz[nombreHojaMatriz] = filasPorHojaMatriz[nombreHojaMatriz] || []).push({
      fecha: fechaTs, actividad: actividad, cantidad: cantidad,
    });
  }

  var hojasTocadas = Object.keys(filasPorHojaMatriz);
  if (hojasTocadas.length === 0) {
    SpreadsheetApp.getUi().alert("No encontré filas válidas (con CANTIDAD INS numérico) en el archivo de Iniciales.");
    return;
  }

  var coloresPorGrupo = {};
  var paletteColores = ["#D9B3FF", "#B3D9FF", "#FFD9B3", "#B3FFCC", "#FFB3D9", "#D9FFB3", "#FFE4B3"];
  var siguienteColorIdx = 0;

  function colorParaActividad(actividad) {
    var grupo = extraerGrupoActividad_(actividad);
    if (!coloresPorGrupo[grupo]) {
      coloresPorGrupo[grupo] = paletteColores[siguienteColorIdx % paletteColores.length];
      siguienteColorIdx++;
    }
    return coloresPorGrupo[grupo];
  }

  var resumenPorHoja = [];
  var avisosGenerales = [];

  hojasTocadas.forEach(function (nombreHojaMatriz) {
    var matrizInfo = obtenerDisponibilidadMatriz_(ID_MATRIZ, nombreHojaMatriz);
    if (!matrizInfo) {
      avisosGenerales.push("No encontré la pestaña '" + nombreHojaMatriz + "' en la Matriz -> esas filas no se procesaron.");
      return;
    }

    // Cargar también los colores de fondo actuales (la función compartida solo trae valores).
    var rangoCompleto = matrizInfo.hoja.getRange(1, 1, matrizInfo.valores.length, matrizInfo.valores[0].length);
    var fondos = rangoCompleto.getBackgrounds();

    var conteoEstaCorrida = {};
    matrizInfo.filas.forEach(function (f) { conteoEstaCorrida[f.nombre] = 0; });

    var asignadas = 0, sinCupo = 0;
    var filasOrdenadas = filasPorHojaMatriz[nombreHojaMatriz].sort(function (a, b) { return a.fecha - b.fecha; });

    filasOrdenadas.forEach(function (fi) {
      for (var n = 0; n < fi.cantidad; n++) {
        var candidatos = matrizInfo.filas.slice().sort(function (a, b) {
          return conteoEstaCorrida[a.nombre] - conteoEstaCorrida[b.nombre];
        });

        var filaElegida = null;
        for (var k = 0; k < candidatos.length; k++) {
          var cand = candidatos[k];
          var yaUsadoEstaFecha = false;
          // no asignar la misma persona 2 veces el mismo día/actividad dentro de este reparto
          for (var colIdx in matrizInfo.fechasPorColumna) {
            if (matrizInfo.fechasPorColumna[colIdx] === fi.fecha &&
                String(matrizInfo.valores[cand.filaIdx][colIdx] || "").indexOf(fi.actividad) !== -1) {
              yaUsadoEstaFecha = true;
            }
          }
          if (yaUsadoEstaFecha) continue;

          var disp = estaDisponibleEnFecha_(matrizInfo, cand.nombre, fi.fecha);
          if (disp === true) { filaElegida = cand; break; }
        }

        if (!filaElegida) { sinCupo++; continue; }

        for (var colIdx2 in matrizInfo.fechasPorColumna) {
          if (matrizInfo.fechasPorColumna[colIdx2] === fi.fecha) {
            matrizInfo.valores[filaElegida.filaIdx][colIdx2] = fi.actividad;
            fondos[filaElegida.filaIdx][colIdx2] = colorParaActividad(fi.actividad);
            break;
          }
        }
        conteoEstaCorrida[filaElegida.nombre]++;
        asignadas++;
      }
    });

    rangoCompleto.setValues(matrizInfo.valores);
    rangoCompleto.setBackgrounds(fondos);

    resumenPorHoja.push(nombreHojaMatriz + ": " + asignadas + " asignadas, " + sinCupo + " sin instructor disponible");
  });

  SpreadsheetApp.getUi().alert(
    "Asignación de Iniciales completada.\n\n" +
    resumenPorHoja.join("\n") +
    (avisosGenerales.length ? "\n\n" + avisosGenerales.join("\n") : "")
  );
}

var MESES_ES_INICIALES_ = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
  "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function nombreHojaVisualPara_(fecha) {
  return "Visua_" + MESES_ES_INICIALES_[fecha.getMonth()] + "_" + fecha.getFullYear();
}

// "INICIAL G9" -> "G9", "INICIAL 10" -> "10" (lo que venga después de la última palabra) —
// así cualquier actividad nueva con otro sufijo arma su propio grupo de color automáticamente.
function extraerGrupoActividad_(actividad) {
  var partes = actividad.trim().split(/\s+/);
  return partes.length > 0 ? partes[partes.length - 1].toUpperCase() : actividad;
}
