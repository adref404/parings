function asignarExperienciaReciente() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk"; 
  var gidMatriz = 1006838221;       // GID de la Matriz activa de Octubre
  var gidExpReciente = 171715519;   // GID de la pestaña "3. EXP RECIENTE"

  var ss = SpreadsheetApp.openById(idHojaMatriz);

  // 1. Obtener Hoja Matriz y Hoja Exp Reciente por GID
  var hojaMatriz = ss.getSheets().find(function(h) { return h.getSheetId() === gidMatriz; }) || ss.getActiveSheet();
  var hojaExp = ss.getSheets().find(function(h) { return h.getSheetId() === gidExpReciente; });

  if (!hojaExp) {
    SpreadsheetApp.getUi().alert("No se encontró la pestaña de Experiencia Reciente (GID: 171715519).");
    return;
  }

  var uFilaExp = hojaExp.getLastRow();
  if (uFilaExp < 3) {
    SpreadsheetApp.getUi().alert("La hoja de Experiencia Reciente no tiene suficientes filas.");
    return;
  }

  // 2. Leer datos de '3. EXP RECIENTE'
  var datosExp = hojaExp.getRange(3, 1, uFilaExp - 2, 33).getValues();

  // 3. Mapear Matriz Activa
  var uFilaMatriz = hojaMatriz.getLastRow();
  var uColMatriz = hojaMatriz.getLastColumn();
  var numFilasM = uFilaMatriz - 2;
  var numColsM = uColMatriz - 2;

  // BP en Columna A de Matriz
  var dataBP = hojaMatriz.getRange(3, 1, numFilasM, 1).getValues();
  var mapaFilasBP = {};
  for (var i = 0; i < dataBP.length; i++) {
    var bp = String(dataBP[i][0]).replace(".0", "").trim();
    if (bp !== "") mapaFilasBP[bp] = i; // Índice base 0
  }

  // Fechas en Fila 2 de Matriz
  var filaFechas = hojaMatriz.getRange(2, 3, 1, numColsM).getValues()[0];
  var listaFechasMatriz = [];

  for (var j = 0; j < filaFechas.length; j++) {
    var dObj = parsearAFechaObj(filaFechas[j]);
    if (dObj) {
      listaFechasMatriz.push({ index: j, date: dObj, key: formatearKeyFecha(dObj) });
    }
  }

  // Cargar Matriz a Memoria (Batch Read)
  var rangoMatriz = hojaMatriz.getRange(3, 3, numFilasM, numColsM);
  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  var contadorAsignados = 0;

  // Mapeo exacto de Columnas y Duración de Días por Flota
  var flotasConfig = [
    { nombre: "EXP RECIENTE A320", colVig: 11, colStatus: 18, color: "#fbbc04", dias: 1 },
    { nombre: "EXP RECIENTE B767", colVig: 20, colStatus: 27, color: "#fbbc04", dias: 3 },
    { nombre: "EXP RECIENTE B787", colVig: 29, colStatus: 32, color: "#fbbc04", dias: 2 }
  ];

  // 4. Evaluar instructor por instructor
  for (var r = 0; r < datosExp.length; r++) {
    var row = datosExp[r];
    var bp = String(row[2]).replace(".0", "").trim(); // Columna C (BP)

    if (!bp || mapaFilasBP[bp] === undefined) continue;
    var idxFilaM = mapaFilasBP[bp];

    // Evaluar cada flota
    flotasConfig.forEach(function(flota) {
      var statusVal = String(row[flota.colStatus] || "").trim();

      // Verificar si indica que falta programar ("Programar antes de ...")
      if (statusVal.toLowerCase().indexOf("programar antes") !== -1) {
        var fechaVigencia = parsearAFechaObj(row[flota.colVig]);

        if (fechaVigencia) {
          // Límite Máximo: Estrictamente 1 día ANTES de la fecha de vencimiento
          var fechaLimiteMax = new Date(fechaVigencia.getTime());
          fechaLimiteMax.setDate(fechaLimiteMax.getDate() - 1);

          // Formatear texto de la fecha máxima en "DD/MM" (ej: 07/10)
          var diaStr = String(fechaLimiteMax.getDate()).padStart(2, '0');
          var mesStr = String(fechaLimiteMax.getMonth() + 1).padStart(2, '0');
          var textoMax = "(max " + diaStr + "/" + mesStr + ")";

          var colInicioAsignar = -1;
          var duracion = flota.dias;

          // Buscar el bloque de días consecutivos disponibles retrocediendo desde el límite
          for (var k = listaFechasMatriz.length - duracion; k >= 0; k--) {
            var fFinBloque = listaFechasMatriz[k + duracion - 1].date;

            if (fFinBloque <= fechaLimiteMax) {
              var bloqueDisponible = true;

              // Verificar que TODOS los días del bloque estén libres ("B" o vacío)
              for (var d = 0; d < duracion; d++) {
                var colIdx = listaFechasMatriz[k + d].index;
                var valCelda = String(matrizValores[idxFilaM][colIdx]).trim().toUpperCase();

                if (valCelda !== "B" && valCelda !== "") {
                  bloqueDisponible = false;
                  break;
                }
              }

              if (bloqueDisponible) {
                colInicioAsignar = k;
                break; // Toma el bloque libre más cercano al límite
              }
            }
          }

          // Asignar el bloque de días con el formato e información de fecha máxima
          if (colInicioAsignar !== -1) {
            var textoCompleto = flota.nombre + "\n" + textoMax;

            for (var d = 0; d < duracion; d++) {
              var colIdxAsignada = listaFechasMatriz[colInicioAsignar + d].index;
              matrizValores[idxFilaM][colIdxAsignada] = textoCompleto;
              matrizFondos[idxFilaM][colIdxAsignada] = flota.color;
              matrizColorLetra[idxFilaM][colIdxAsignada] = "#000000";
              matrizPesoLetra[idxFilaM][colIdxAsignada] = "bold";
            }
            contadorAsignados++;
          }
        }
      }
    });
  }

  // 5. Guardar cambios en Lote (Batch Update)
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  SpreadsheetApp.getUi().alert("¡Completado! Se programaron " + contadorAsignados + " solicitudes de Experiencia Reciente con etiqueta de fecha máxima.");
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================
function parsearAFechaObj(val) {
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