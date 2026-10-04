
/**
 * 2. FUNCIÓN PARA CREAR LA ESTRUCTURA VISUA DE CUALQUIER MES Y AÑO
 * Ejemplo: crearVisuaMesAnio(11, 2026) -> Crea Noviembre 2026
 */
function ejecutarCrearVisua() {
  var ui = SpreadsheetApp.getUi();
  var respMes = ui.prompt("Crear VISUA", "Ingresa el número de mes (1 al 12):", ui.ButtonSet.OK_CANCEL);
  if (respMes.getSelectedButton() !== ui.Button.OK) return;

  var respAnio = ui.prompt("Crear VISUA", "Ingresa el año (ej. 2026):", ui.ButtonSet.OK_CANCEL);
  if (respAnio.getSelectedButton() !== ui.Button.OK) return;

  var mes = parseInt(respMes.getResponseText().trim(), 10);
  var anio = parseInt(respAnio.getResponseText().trim(), 10);

  if (isNaN(mes) || mes < 1 || mes > 12 || isNaN(anio) || anio < 2000) {
    ui.alert("Mes o año no válidos.");
    return;
  }

  crearVisuaMesAnio(mes, anio);
}

function crearVisuaMesAnio(mes, anio) {
  var ss = SpreadsheetApp.openById(ID_HOJA_MATRIZ);
  
  var nombresMeses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
  var diasSemana = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  var nombreHoja = "Visua_" + nombresMeses[mes - 1] + "_" + anio;
  
  // Verificar si la hoja ya existe
  var hojaMes = ss.getSheetByName(nombreHoja);
  if (hojaMes) {
    var resp = SpreadsheetApp.getUi().alert("La hoja '" + nombreHoja + "' ya existe. ¿Deseas reemplazarla?", SpreadsheetApp.getUi().ButtonSet.YES_NO);
    if (resp !== SpreadsheetApp.getUi().Button.YES) return;
    ss.deleteSheet(hojaMes);
  }

  hojaMes = ss.insertSheet(nombreHoja);

  // Obtener lista de instructores desde la hoja actual base
  var hojaBase = ss.getSheets().find(function(h) { return h.getSheetId() === GID_HOJA_ACTUAL; }) || ss.getSheets()[0];
  var uFila = hojaBase.getLastRow();
  var instructores = [];
  
  if (uFila >= 3) {
    instructores = hojaBase.getRange(3, 1, uFila - 2, 2).getValues(); // Columnas BP y Nombre
  } else {
    // Si no hay datos base
    instructores = [["1271571", "Instructor Ejemplo"]];
  }

  // Días en el mes solicitado
  var diasEnMes = new Date(anio, mes, 0).getDate();

  // Construir Encabezados
  var fila1Dias = ["", ""];
  var fila2Fechas = ["BP", "Nombre"];

  for (var d = 1; d <= diasEnMes; d++) {
    var fechaObj = new Date(anio, mes - 1, d);
    fila1Dias.push(diasSemana[fechaObj.getDay()]);
    fila2Fechas.push(d + "/" + mes + "/" + anio);
  }

  // Construir cuerpo con "B" por defecto
  var matrizDatos = [fila1Dias, fila2Fechas];
  for (var k = 0; k < instructores.length; k++) {
    var filaInstr = [instructores[k][0], instructores[k][1]];
    for (var d = 1; d <= diasEnMes; d++) {
      filaInstr.push("B"); // Rellena con B por defecto
    }
    matrizDatos.push(filaInstr);
  }

  // Escribir en la hoja
  var rangoTotal = hojaMes.getRange(1, 1, matrizDatos.length, fila1Dias.length);
  rangoTotal.setValues(matrizDatos);

  // Formato Visual
  hojaMes.getRange(1, 1, 2, fila1Dias.length)
    .setFontWeight("bold")
    .setHorizontalAlignment("center")
    .setBackground("#E2EFDA"); // Verde suave pastel para encabezados

  hojaMes.getRange(3, 3, instructores.length, diasEnMes)
    .setHorizontalAlignment("center");

  hojaMes.autoResizeColumns(1, fila1Dias.length);

  SpreadsheetApp.getUi().alert("¡Hoja '" + nombreHoja + "' creada exitosamente con " + diasEnMes + " días!");
}

// ==========================================
// FUNCIONES AUXILIARES DE FECHAS
// ==========================================

function parsearFechaStr(str) {
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

function parsearFechaAKey(val) {
  if (val instanceof Date) {
    return formatearKeyFecha(val);
  }
  if (typeof val === 'string' && val.indexOf('/') !== -1) {
    var p = val.split('/');
    if (p.length === 3) {
      var d = parseInt(p[0], 10);
      var m = parseInt(p[1], 10) - 1;
      var y = parseInt(p[2], 10);
      return formatearKeyFecha(new Date(y, m, d));
    }
  }
  return null;
}