// ID de tu libro de Google Sheets
var ID_HOJA_MATRIZ = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
var GID_HOJA_ACTUAL = 1006838221; // GID de la hoja Visua Octubre

// Datos de vacaciones provistos
var listaVacaciones = [
  { bp: "1271571", inicio: "14/09/2026", fin: "18/10/2026" },
  { bp: "2369624", inicio: "1/10/2026",  fin: "15/10/2026" },
  { bp: "2369624", inicio: "1/09/2026",  fin: "7/09/2026"  },
  { bp: "3217561", inicio: "16/09/2026", fin: "30/09/2026" },
  { bp: "3217561", inicio: "9/11/2026",  fin: "19/11/2026" },
  { bp: "2369641", inicio: "17/09/2026", fin: "30/09/2026" },
  { bp: "3134911", inicio: "1/10/2026",  fin: "23/10/2026" },
  { bp: "2713993", inicio: "5/10/2026",  fin: "20/10/2026" },
  { bp: "2713993", inicio: "21/10/2026", fin: "4/11/2026"  },
  { bp: "2823133", inicio: "14/12/2026", fin: "24/12/2026" },
  { bp: "29530",   inicio: "1/10/2026",  fin: "15/10/2026" },
  { bp: "29530",   inicio: "21/12/2026", fin: "31/12/2026" },
  { bp: "2369641", inicio: "23/11/2026", fin: "30/11/2026" },
  { bp: "2440915", inicio: "8/10/2026",  fin: "15/10/2026" },
  { bp: "2843319", inicio: "8/10/2026",  fin: "23/10/2026" },
  { bp: "3750335", inicio: "8/09/2026",  fin: "14/09/2026" },
  { bp: "3750335", inicio: "18/10/2026", fin: "25/10/2026" },
  { bp: "2604360", inicio: "16/09/2026", fin: "30/09/2026" },
  { bp: "2604360", inicio: "25/12/2026", fin: "31/12/2026" },
  { bp: "3189967", inicio: "1/10/2026",  fin: "18/10/2026" },
  { bp: "2415373", inicio: "5/10/2026",  fin: "12/10/2026" },
  { bp: "2415373", inicio: "13/10/2026", fin: "19/10/2026" },
  { bp: "3779550", inicio: "2/11/2026",  fin: "16/11/2026" }
];

/**
 * 1. FUNCIÓN PARA APLICAR LAS VACACIONES EN EL VISUA DEL MES ACTUAL
 * Reemplaza la 'B' por 'VACACIONES' y pinta en amarillo pastel
 */
function _1aplicarVacacionesEnVisua() {
  var ss = SpreadsheetApp.openById(ID_HOJA_MATRIZ);
  
  // Obtener la hoja objetivo por su GID o usar la activa
  var hoja = ss.getSheets().find(function(h) {
    return h.getSheetId() === GID_HOJA_ACTUAL;
  }) || ss.getActiveSheet();

  var ultimaFila = hoja.getLastRow();
  var ultimaColumna = hoja.getLastColumn();

  if (ultimaFila < 3 || ultimaColumna < 3) {
    SpreadsheetApp.getUi().alert("La hoja no contiene la estructura VISUA adecuada.");
    return;
  }

  // Mapear BP (Columna A, desde fila 3)
  var dataBP = hoja.getRange(3, 1, ultimaFila - 2, 1).getValues();
  var mapaFilasBP = {};
  for (var i = 0; i < dataBP.length; i++) {
    var bp = String(dataBP[i][0]).replace(".0", "").trim();
    if (bp !== "") {
      mapaFilasBP[bp] = i + 3; // Fila real en la hoja
    }
  }

  // Mapear Fechas (Fila 2, desde Columna C)
  var numColsFechas = ultimaColumna - 2;
  var filaFechas = hoja.getRange(2, 3, 1, numColsFechas).getValues()[0];
  var mapaColsFechas = {};

  for (var j = 0; j < filaFechas.length; j++) {
    var keyF = parsearFechaAKey(filaFechas[j]);
    if (keyF) {
      mapaColsFechas[keyF] = j + 3; // Columna real en la hoja
    }
  }

  // Cargar matriz de trabajo en memoria
  var rangoMatriz = hoja.getRange(3, 3, ultimaFila - 2, numColsFechas);
  var valores = rangoMatriz.getValues();
  var fondos = rangoMatriz.getBackgrounds();

  var contadorAplicados = 0;

  // Procesar vacaciones
  listaVacaciones.forEach(function(reg) {
    var bpTarget = String(reg.bp).trim();
    var dInicio = parsearFechaStr(reg.inicio);
    var dFin = parsearFechaStr(reg.fin);

    if (mapaFilasBP[bpTarget] && dInicio && dFin) {
      var filaReal = mapaFilasBP[bpTarget];
      var idxFila = filaReal - 3;
      var currDate = new Date(dInicio.getTime());

      while (currDate <= dFin) {
        var keyCurr = formatearKeyFecha(currDate);
        var colReal = mapaColsFechas[keyCurr];

        if (colReal) {
          var idxCol = colReal - 3;
          // Reemplaza el contenido ("B" u otro) por "VACACIONES"
          valores[idxFila][idxCol] = "VACACIONES";
          fondos[idxFila][idxCol] = "#FFF2CC"; // Color Amarillo Pastel
          contadorAplicados++;
        }
        currDate.setDate(currDate.getDate() + 1);
      }
    }
  });

  // Guardar datos y formatos en lote (Batch update)
  rangoMatriz.setValues(valores);
  rangoMatriz.setBackgrounds(fondos);

  SpreadsheetApp.getUi().alert("¡Completado! Se marcaron " + contadorAplicados + " días de vacaciones reemplazando 'B'.");
}

function _2marcarFinesDeSemana() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var gidTarget = 1006838221; // GID objetivo
  var ssMatriz = SpreadsheetApp.openById(idHojaMatriz);

  // 1. Obtener la hoja específica por su GID
  var hoja = ssMatriz.getSheets().find(function(h) {
    return h.getSheetId() === gidTarget;
  }) || ssMatriz.getActiveSheet();

  var ultimaFila = hoja.getLastRow();
  var ultimaColumna = hoja.getLastColumn();

  if (ultimaFila < 3 || ultimaColumna < 3) {
    SpreadsheetApp.getUi().alert("La hoja no contiene datos suficientes.");
    return;
  }

  // Lista de BPs que llevan FDS (Azul)
  var bpsEspeciales = ["2713993", "2396710", "1271571"];

  var numFilasMatriz = ultimaFila - 2;
  var numColsFechas = ultimaColumna - 2;

  // 2. Obtener la fila de fechas (Fila 2, desde Columna C / índice 3)
  var filaFechas = hoja.getRange(2, 3, 1, numColsFechas).getValues()[0];

  // Identificar qué índices de columnas corresponden a Sábado (6) o Domingo (0)
  var indicesColsFDS = [];
  for (var j = 0; j < filaFechas.length; j++) {
    var d = normalizarAFechaObj(filaFechas[j]);
    if (d) {
      var diaSemana = d.getDay(); // 0 = Domingo, 6 = Sábado
      if (diaSemana === 0 || diaSemana === 6) {
        indicesColsFDS.push(j);
      }
    }
  }

  // 3. Cargar la matriz de datos, colores de fondo y estilos de texto en memoria (Lote)
  var rangoTotalBPs = hoja.getRange(3, 1, numFilasMatriz, 1).getValues();
  var rangoMatriz = hoja.getRange(3, 3, numFilasMatriz, numColsFechas);

  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  // 4. Evaluar y modificar la matriz en memoria
  for (var i = 0; i < numFilasMatriz; i++) {
    var bpActual = String(rangoTotalBPs[i][0]).replace(".0", "").trim();
    if (bpActual === "") continue;

    var esEspecial = bpsEspeciales.indexOf(bpActual) !== -1;

    indicesColsFDS.forEach(function(idxCol) {
      var valorActual = String(matrizValores[i][idxCol]).trim();

      // Solo reemplazar si NO es VACACIONES
      if (valorActual.toUpperCase() !== "VACACIONES") {
        if (esEspecial) {
          matrizValores[i][idxCol] = "FDS";
          matrizFondos[i][idxCol] = "#0000FF";      // Fondo Azul (#0000ff)
          matrizColorLetra[i][idxCol] = "#FFFFFF";  // Texto Blanco
          matrizPesoLetra[i][idxCol] = "bold";      // Texto Negrita
        } else {
          matrizValores[i][idxCol] = "DO";
          matrizFondos[i][idxCol] = null;          // Sin fondo
          matrizColorLetra[i][idxCol] = "#000000";  // Texto Negro normal
          matrizPesoLetra[i][idxCol] = "normal";    // Texto Normal
        }
      }
    });
  }

  // 5. Aplicar todos los cambios de un solo golpe (Lote)
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  SpreadsheetApp.getUi().alert("¡Proceso de FDS y DO completado en la hoja (GID: " + gidTarget + ")!");
}

// Función auxiliar para parsear y normalizar a objeto Date
function normalizarAFechaObj(val) {
  if (val instanceof Date) {
    return val;
  }
  if (typeof val === "string" && val.indexOf("/") !== -1) {
    var partes = val.split("/");
    if (partes.length === 3) {
      var dia = parseInt(partes[0], 10);
      var mes = parseInt(partes[1], 10) - 1;
      var anio = parseInt(partes[2], 10);
      return new Date(anio, mes, dia);
    }
  }
  return null;
}




function _3marcarCumpleanos() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var gidTarget = 1006838221; // GID de la hoja objetivo
  var ssMatriz = SpreadsheetApp.openById(idHojaMatriz);

  // 1. Obtener la hoja objetivo por su GID
  var hoja = ssMatriz.getSheets().find(function(h) {
    return h.getSheetId() === gidTarget;
  }) || ssMatriz.getActiveSheet();

  var ultimaFila = hoja.getLastRow();
  var ultimaColumna = hoja.getLastColumn();

  if (ultimaFila < 3 || ultimaColumna < 3) {
    SpreadsheetApp.getUi().alert("La hoja no contiene datos suficientes.");
    return;
  }

  // 2. Lista de cumpleaños extraída de la imagen
  var listaCumpleanos = [
    { bp: "2713993", inicio: "26/03/2026", fin: "26/03/2026" },
    { bp: "2396710", inicio: "09/03/2026", fin: "09/03/2026" },
    { bp: "1271571", inicio: "25/06/2026", fin: "25/06/2026" },
    { bp: "2843319", inicio: "19/04/2026", fin: "20/04/2026" },
    { bp: "3779550", inicio: "03/11/2026", fin: "04/11/2026" },
    { bp: "29530",   inicio: "28/05/2026", fin: "29/05/2026" },
    { bp: "3217561", inicio: "07/04/2026", fin: "08/04/2026" },
    { bp: "2963161", inicio: "19/12/2026", fin: "20/12/2026" },
    { bp: "71348",   inicio: "03/09/2026", fin: "04/09/2026" },
    { bp: "967092",  inicio: "28/10/2026", fin: "29/10/2026" },
    { bp: "2369641", inicio: "15/09/2026", fin: "16/09/2026" },
    { bp: "2369624", inicio: "05/10/2026", fin: "06/10/2026" },
    { bp: "3134911", inicio: "20/12/2026", fin: "21/12/2026" },
    { bp: "3750335", inicio: "24/03/2026", fin: "25/03/2026" },
    { bp: "3852423", inicio: "24/06/2026", fin: "25/06/2026" },
    { bp: "2604360", inicio: "11/04/2026", fin: "12/04/2026" },
    { bp: "2823133", inicio: "15/07/2026", fin: "16/07/2026" },
    { bp: "3189967", inicio: "16/04/2026", fin: "17/04/2026" },
    { bp: "2415373", inicio: "05/11/2026", fin: "06/11/2026" },
    { bp: "2440915", inicio: "10/12/2026", fin: "11/12/2026" },
    { bp: "3796947", inicio: "06/01/2026", fin: "07/01/2026" },
    { bp: "3841387", inicio: "03/11/2026", fin: "04/11/2026" }
  ];

  var numFilasMatriz = ultimaFila - 2;
  var numColsFechas = ultimaColumna - 2;

  // 3. Mapear BPs (Columna A)
  var dataBP = hoja.getRange(3, 1, numFilasMatriz, 1).getValues();
  var mapaFilasBP = {};
  for (var i = 0; i < dataBP.length; i++) {
    var bp = String(dataBP[i][0]).replace(".0", "").trim();
    if (bp !== "") {
      mapaFilasBP[bp] = i + 3; // Fila real en la hoja
    }
  }

  // 4. Mapear Fechas (Fila 2)
  var filaFechas = hoja.getRange(2, 3, 1, numColsFechas).getValues()[0];
  var mapaColsFechas = {};
  for (var j = 0; j < filaFechas.length; j++) {
    var keyF = parsearAFechaKey(filaFechas[j]);
    if (keyF) {
      mapaColsFechas[keyF] = j + 3; // Columna real en la hoja
    }
  }

  // 5. Cargar datos, fondos y fuentes en memoria
  var rangoMatriz = hoja.getRange(3, 3, numFilasMatriz, numColsFechas);
  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  var contadorCumples = 0;

  // 6. Evaluar cada registro de cumpleaños
  listaCumpleanos.forEach(function(reg) {
    var bpTarget = String(reg.bp).trim();
    var dInicio = parsearFechaCump(reg.inicio);
    var dFin = parsearFechaCump(reg.fin);

    if (mapaFilasBP[bpTarget] && dInicio && dFin) {
      var filaReal = mapaFilasBP[bpTarget];
      var idxFila = filaReal - 3;
      var currDate = new Date(dInicio.getTime());

      while (currDate <= dFin) {
        var keyCurr = formatearKeyFecha(currDate);
        var colReal = mapaColsFechas[keyCurr];

        if (colReal) {
          var idxCol = colReal - 3;
          var valActual = String(matrizValores[idxFila][idxCol]).trim().toUpperCase();

          // REGLA: No sobreescribir si es VACACIONES o FDS
          if (valActual !== "VACACIONES" && valActual !== "FDS") {
            matrizValores[idxFila][idxCol] = "CUMP";
            matrizFondos[idxFila][idxCol] = "#FF00FF";      // Fondo Fucsia / Magenta
            matrizColorLetra[idxFila][idxCol] = "#FFFFFF";  // Letra Blanco
            matrizPesoLetra[idxFila][idxCol] = "bold";      // Negrita
            contadorCumples++;
          }
        }
        currDate.setDate(currDate.getDate() + 1);
      }
    }
  });

  // 7. Aplicar todos los cambios en un solo paso
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  SpreadsheetApp.getUi().alert("¡Completado! Se marcaron " + contadorCumples + " días de CUMP (respetando VACACIONES y FDS).");
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

function parsearFechaCump(str) {
  if (!str) return null;
  var p = str.split('/');
  if (p.length < 3) return null;
  return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
}

function formatearKeyFecha(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function parsearAFechaKey(val) {
  if (val instanceof Date) {
    return formatearKeyFecha(val);
  }
  if (typeof val === 'string' && val.indexOf('/') !== -1) {
    var p = val.split('/');
    if (p.length === 3) {
      return formatearKeyFecha(new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)));
    }
  }
  return null;
}


function _4marcarFeriados() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var gidTarget = 1006838221; // GID objetivo
  var ssMatriz = SpreadsheetApp.openById(idHojaMatriz);

  // 1. Obtener la hoja objetivo por su GID
  var hoja = ssMatriz.getSheets().find(function(h) {
    return h.getSheetId() === gidTarget;
  }) || ssMatriz.getActiveSheet();

  var ultimaFila = hoja.getLastRow();
  var ultimaColumna = hoja.getLastColumn();

  if (ultimaFila < 3 || ultimaColumna < 3) {
    SpreadsheetApp.getUi().alert("La hoja no contiene datos suficientes.");
    return;
  }

  // 2. Lista de feriados
  var listaFeriados = [
    "01/01/2026",
    "02/04/2026",
    "03/04/2026",
    "01/05/2026",
    "29/06/2026",
    "23/07/2026",
    "28/07/2026",
    "29/07/2026",
    "06/08/2026",
    "08/10/2026",
    "08/12/2026",
    "09/12/2026",
    "25/12/2026"
  ];

  var numFilasMatriz = ultimaFila - 2;
  var numColsFechas = ultimaColumna - 2;

  // 3. Mapear Fechas (Fila 2, desde Columna C)
  var filaFechas = hoja.getRange(2, 3, 1, numColsFechas).getValues()[0];
  var mapaColsFechas = {};

  for (var j = 0; j < filaFechas.length; j++) {
    var keyF = parsearAFechaKey(filaFechas[j]);
    if (keyF) {
      mapaColsFechas[keyF] = j + 3; // Columna real en la hoja
    }
  }

  // 4. Cargar la matriz completa de datos, colores y textos a memoria (Lote)
  var rangoMatriz = hoja.getRange(3, 3, numFilasMatriz, numColsFechas);
  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  var contadorFeriadosPintados = 0;

  // 5. Evaluar cada fecha de feriado
  listaFeriados.forEach(function(strFeriado) {
    var dFeriado = parsearFechaFeriado(strFeriado);
    if (!dFeriado) return;

    var keyFeriado = formatearKeyFecha(dFeriado);
    var colReal = mapaColsFechas[keyFeriado];

    // Si el feriado está dentro de los días mostrados en la hoja actual
    if (colReal) {
      var idxCol = colReal - 3; // Índice base 0 para la matriz

      // Evaluar fila por fila para aplicar la regla de jerarquía
      for (var i = 0; i < numFilasMatriz; i++) {
        var valActual = String(matrizValores[i][idxCol]).trim().toUpperCase();

        // REGLA: Solo marcar FERIADO si NO es VACACIONES ni CUMP
        if (valActual !== "VACACIONES" && valActual !== "CUMP") {
          matrizValores[i][idxCol] = "FERIADO";
          matrizFondos[i][idxCol] = "#1155CC";      // Fondo Azul (#1155cc)
          matrizColorLetra[i][idxCol] = "#FFFFFF";  // Texto Blanco
          matrizPesoLetra[i][idxCol] = "bold";      // Negrita
        }
      }
      contadorFeriadosPintados++;
    }
  });

  // 6. Escribir todos los cambios de un solo golpe (Batch update)
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  SpreadsheetApp.getUi().alert("¡Completado! Se procesaron " + contadorFeriadosPintados + " días feriados respetando VACACIONES y CUMP.");
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

function parsearFechaFeriado(str) {
  if (!str) return null;
  var p = str.split('/');
  if (p.length < 3) return null;
  return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
}

function formatearKeyFecha(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  var yyyy = d.getFullYear();
  var mm = String(d.getMonth() + 1).padStart(2, '0');
  var dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function parsearAFechaKey(val) {
  if (val instanceof Date) {
    return formatearKeyFecha(val);
  }
  if (typeof val === 'string' && val.indexOf('/') !== -1) {
    var p = val.split('/');
    if (p.length === 3) {
      return formatearKeyFecha(new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10)));
    }
  }
  return null;
}



// 1. Disponibilidad del Mes (Regla de Vacaciones)
// 100% Disponible (Aprobado): Si el instructor NO presenta vacaciones programadas durante el mes en evaluación, califica para obtener su bloque de días libres (DO).
// Con Vacaciones (Rechazado / Bloqueo IET): Si el instructor presenta un periodo de vacaciones (de 7 días o más) en el mes, NO aplica el beneficio de asignación del bloque de días libres (DO). Su solicitud se registra con la observación: "Rechazado: Bloqueo IET (Presenta vacaciones en el mes)".

function _5procesarSolicitudesDO() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk";
  var gidMatriz = 1006838221;    // GID de la Matriz del mes
  var gidSolicitudes = 1293311352; // GID de la hoja de solicitudes (Hoja 5 / Solicitudes)

  var ss = SpreadsheetApp.openById(idHojaMatriz);

  // 1. Obtener Hoja Matriz y Hoja de Solicitudes por GID
  var hojaMatriz = ss.getSheets().find(function(h) { return h.getSheetId() === gidMatriz; }) || ss.getActiveSheet();
  var hojaSolicitudes = ss.getSheets().find(function(h) { return h.getSheetId() === gidSolicitudes; });

  if (!hojaSolicitudes) {
    SpreadsheetApp.getUi().alert("No se encontró la pestaña de Solicitudes.");
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

  // 2. Mapear BPs (Columna A)
  var dataBP = hojaMatriz.getRange(3, 1, numFilasMatriz, 1).getValues();
  var mapaFilasBP = {};
  for (var i = 0; i < dataBP.length; i++) {
    var bp = String(dataBP[i][0]).replace(".0", "").trim();
    if (bp !== "") mapaFilasBP[bp] = i; // Índice base 0 relativo
  }

  // 3. Mapear Fechas (Fila 2)
  var filaFechas = hojaMatriz.getRange(2, 3, 1, numColsFechas).getValues()[0];
  var mapaColsFechas = {};
  for (var j = 0; j < filaFechas.length; j++) {
    var keyF = parsearAFechaKey(filaFechas[j]);
    if (keyF) mapaColsFechas[keyF] = j; // Índice base 0 relativo
  }

  // 4. Cargar Matriz a memoria (Lote)
  var rangoMatriz = hojaMatriz.getRange(3, 3, numFilasMatriz, numColsFechas);
  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  // 5. Leer Solicitudes
  var uFilaSoli = hojaSolicitudes.getLastRow();
  if (uFilaSoli < 2) {
    SpreadsheetApp.getUi().alert("No hay solicitudes registradas.");
    return;
  }

  var rangoSolicitudes = hojaSolicitudes.getRange(2, 1, uFilaSoli - 1, 6);
  var datosSolicitudes = rangoSolicitudes.getValues();
  var columnaObservaciones = [];

  // 6. Procesar cada fila de la hoja de solicitudes
  for (var k = 0; k < datosSolicitudes.length; k++) {
    var bp = String(datosSolicitudes[k][0]).replace(".0", "").trim();
    var fInicioStr = datosSolicitudes[k][2];
    var fFinStr = datosSolicitudes[k][3];

    var fInicio = parsearFechaCump(fInicioStr);
    var fFin = parsearFechaCump(fFinStr);

    var obsActual = "";

    if (!bp || !fInicio || !fFin) {
      columnaObservaciones.push(["Estructura de fechas/BP no válida"]);
      continue;
    }

    var idxFila = mapaFilasBP[bp];
    if (idxFila === undefined) {
      columnaObservaciones.push(["BP no encontrado en la matriz"]);
      continue;
    }

    // EVALUAR: ¿El instructor presenta VACACIONES en el mes?
    var tieneVacaciones = false;
    for (var c = 0; c < numColsFechas; c++) {
      var valCelda = String(matrizValores[idxFila][c]).trim().toUpperCase();
      if (valCelda === "VACACIONES") {
        tieneVacaciones = true;
        break;
      }
    }

    // BLOQUEO IET / RECHAZO SI TIENE VACACIONES
    if (tieneVacaciones) {
      obsActual = "Rechazado: Bloqueo IET (Presenta vacaciones en el mes)";
    } else {
      // SI NO TIENE VACACIONES -> APROBADO: Colocar DO sin formato ni fondo
      var currDate = new Date(fInicio.getTime());
      while (currDate <= fFin) {
        var keyCurr = formatearKeyFecha(currDate);
        var idxCol = mapaColsFechas[keyCurr];

        if (idxCol !== undefined) {
          var valExistente = String(matrizValores[idxFila][idxCol]).trim().toUpperCase();

          // No sobreescribir VACACIONES ni FERIADOS
          if (valExistente !== "VACACIONES" && valExistente !== "FERIADO") {
            matrizValores[idxFila][idxCol] = "DO";
            matrizFondos[idxFila][idxCol] = null;          // Sin fondo de color
            matrizColorLetra[idxFila][idxCol] = "#000000";  // Texto Negro normal
            matrizPesoLetra[idxFila][idxCol] = "normal";    // Texto Normal (sin BOLD)
          }
        }
        currDate.setDate(currDate.getDate() + 1);
      }
      obsActual = "OK";
    }

    columnaObservaciones.push([obsActual]);
  }

  // 7. Aplicar cambios a la Matriz objetivo de un solo golpe
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  // 8. Escribir las Observaciones en la hoja de Solicitudes (Columna F)
  hojaSolicitudes.getRange(2, 6, columnaObservaciones.length, 1).setValues(columnaObservaciones);

  SpreadsheetApp.getUi().alert("¡Proceso de solicitudes completado correctamente y observaciones registradas!");
}

// ==========================================
// FUNCIONES AUXILIARES DE FECHAS
// ==========================================

function parsearFechaCump(val) {
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