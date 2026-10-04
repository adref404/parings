// SE SACA LA INFO DE LA GANT PARA COPIAR LINEA POR LINEA, CORREOS DE JORGE, REUNION DE CADA MES, PEDIDOS DE CHEQUEO DE JESHUA, SOLICITUDES TMBN QUE SOLICITO ALGUNAS VECES ANTO, SOLICITUDES PRE IOS DE JORGE
// Solicitudes de jefatura / Solicitudes Gantt / Auditorías / reunión INS - 2do viernes de cada mes.

function procesarSolicitudesJefatura() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var gidMatriz = 1006838221;    // GID de la Matriz del mes
  var gidSolicitudes = 778777273; // GID de la hoja "2.SOLICITUDES"

  var ss = SpreadsheetApp.openById(idHojaMatriz);

  // 1. Obtener Hoja Matriz y Hoja de Solicitudes por GID
  var hojaMatriz = ss.getSheets().find(function(h) { return h.getSheetId() === gidMatriz; }) || ss.getActiveSheet();
  var hojaSolicitudes = ss.getSheets().find(function(h) { return h.getSheetId() === gidSolicitudes; });

  if (!hojaSolicitudes) {
    SpreadsheetApp.getUi().alert("No se encontró la pestaña de Solicitudes de Jefatura (GID: 778777273).");
    return;
  }

  var ultimaFilaMatriz = hojaMatriz.getLastRow();
  var ultimaColMatriz = hojaMatriz.getLastColumn();
  var numFilasMatriz = ultimaFilaMatriz - 2;
  var numColsFechas = ultimaColMatriz - 2;

  if (numFilasMatriz < 1 || numColsFechas < 1) {
    SpreadsheetApp.getUi().alert("La hoja Matriz no contiene datos suficientes.");
    return;
  }

  // 2. Mapear BPs de la Matriz (Columna A)
  var dataBP = hojaMatriz.getRange(3, 1, numFilasMatriz, 1).getValues();
  var mapaFilasBP = {};
  for (var i = 0; i < dataBP.length; i++) {
    var bp = String(dataBP[i][0]).replace(".0", "").trim();
    if (bp !== "") mapaFilasBP[bp] = i; // Índice base 0 relativo
  }

  // 3. Mapear Fechas de la Matriz (Fila 2)
  var filaFechas = hojaMatriz.getRange(2, 3, 1, numColsFechas).getValues()[0];
  var mapaColsFechas = {};
  for (var j = 0; j < filaFechas.length; j++) {
    var keyF = parsearAFechaKey(filaFechas[j]);
    if (keyF) mapaColsFechas[keyF] = j; // Índice base 0 relativo
  }

  // 4. Cargar Matriz a memoria (Batch read)
  var rangoMatriz = hojaMatriz.getRange(3, 3, numFilasMatriz, numColsFechas);
  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  // 5. Leer Solicitudes de la Jefatura
  var uFilaSoli = hojaSolicitudes.getLastRow();
  if (uFilaSoli < 2) {
    SpreadsheetApp.getUi().alert("No hay solicitudes registradas en la hoja '2.SOLICITUDES'.");
    return;
  }

  var datosSolicitudes = hojaSolicitudes.getRange(2, 1, uFilaSoli - 1, 5).getValues(); // Columnas A a E
  var columnaObservaciones = [];
  var contadorPintados = 0;

  // 6. Procesar cada solicitud
  for (var k = 0; k < datosSolicitudes.length; k++) {
    var bp = String(datosSolicitudes[k][0]).replace(".0", "").trim();
    var fInicioStr = datosSolicitudes[k][2];
    var fFinStr = datosSolicitudes[k][3];
    var tipoActividad = String(datosSolicitudes[k][4]).trim();

    var fInicio = parsearFecha(fInicioStr);
    var fFin = parsearFecha(fFinStr);

    if (!bp || !fInicio || !fFin || !tipoActividad) {
      columnaObservaciones.push(["Datos incompletos o fechas no válidas"]);
      continue;
    }

    var idxFila = mapaFilasBP[bp];
    if (idxFila === undefined) {
      columnaObservaciones.push(["No asignado: BP no encontrado en la matriz"]);
      continue;
    }

    // Definir color de fondo según el Tipo de Actividad
    var colorFondo = obtenerColorPorTipo(tipoActividad);

    var diasTotalSolicitados = 0;
    var diasPintados = 0;
    var motivosSolapamiento = {};

    var currDate = new Date(fInicio.getTime());
    while (currDate <= fFin) {
      var keyCurr = formatearKeyFecha(currDate);
      var idxCol = mapaColsFechas[keyCurr];

      if (idxCol !== undefined) {
        diasTotalSolicitados++;
        var valExistente = String(matrizValores[idxFila][idxCol]).trim().toUpperCase();

        // REGLA: Solo reemplazar si la celda tiene 'B' o está vacía
        if (valExistente === "B" || valExistente === "") {
          matrizValores[idxFila][idxCol] = tipoActividad;
          matrizFondos[idxFila][idxCol] = colorFondo;
          matrizColorLetra[idxFila][idxCol] = "#000000"; // Texto Negro
          matrizPesoLetra[idxFila][idxCol] = "bold";     // Texto Negrita
          diasPintados++;
          contadorPintados++;
        } else {
          // Registrar con qué se solapa si no se pudo pintar
          motivosSolapamiento[valExistente] = true;
        }
      }
      currDate.setDate(currDate.getDate() + 1);
    }

    // DETERMINAR MENSAJE DE OBSERVACIÓN
    var obsTexto = "";
    var listaMotivos = Object.keys(motivosSolapamiento).join(", ");

    if (diasTotalSolicitados === 0) {
      obsTexto = "No asignado: Fechas fuera del rango del mes";
    } else if (diasPintados === diasTotalSolicitados) {
      obsTexto = "OK";
    } else if (diasPintados > 0) {
      obsTexto = "Asignación Parcial (" + diasPintados + "/" + diasTotalSolicitados + " días): Solapado con " + listaMotivos;
    } else {
      obsTexto = "No asignado: Solapado con " + listaMotivos;
    }

    columnaObservaciones.push([obsTexto]);
  }

  // 7. Guardar cambios en la Matriz (Batch update)
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  // 8. Escribir los resultados en la Columna OBSERVACION (Columna F) de la hoja "2.SOLICITUDES"
  hojaSolicitudes.getRange(2, 6, columnaObservaciones.length, 1).setValues(columnaObservaciones);

  SpreadsheetApp.getUi().alert("¡Completado! Se procesaron las solicitudes, se actualizaron la matriz y la columna OBSERVACION.");
}

// ==========================================
// PALETA DE COLORES POR TIPO DE ACTIVIDAD
// ==========================================
function obtenerColorPorTipo(tipo) {
  var t = tipo.toUpperCase();
  if (t.indexOf("IOSA") !== -1 || t.indexOf("DGAC") !== -1) {
    return "#FF9900"; // Naranja
  } else if (t.indexOf("REUNIÓN") !== -1 || t.indexOf("REUNION") !== -1) {
    return "#FFFF00"; // Amarillo
  } else if (t.indexOf("IDE A320") !== -1) {
    return "#FCE5CD"; // Rosado / Durazno pastel
  } else if (t.indexOf("BIANUAL") !== -1 || t.indexOf("B767") !== -1) {
    return "#C9DAF8"; // Azul Acero pastel
  } else {
    return "#FFF2CC"; // Amarillo pastel por defecto
  }
}

// ==========================================
// FUNCIONES AUXILIARES DE FECHAS
// ==========================================
function parsearFecha(val) {
  if (val instanceof Date) return val;
  if (typeof val === 'string' && val.indexOf('/') !== -1) {
    var p = val.split('/');
    if (p.length === 3) return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
  }
  return null;
}

function formatearKeyFecha(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function parsearAFechaKey(val) {
  if (val instanceof Date) return formatearKeyFecha(val);
  if (typeof val === 'string' && val.indexOf('/') !== -1) {
    var p = val.split('/');
    if (p.length === 3) return formatearKeyFecha(new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)));
  }
  return null;
}