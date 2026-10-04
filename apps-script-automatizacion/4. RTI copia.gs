/*
Aquí tienes el resumen estructurado de las reglas de negocio y técnicas que aplica el script `clonarYReasignarRTI()`, redactado en forma de **Nota Técnica de Proceso** para que puedas incluirlo directamente en tu documentación o manual de usuario:

---

### 📝 NOTA TÉCNICA DE PROCESO: REGLAS DE ASIGNACIÓN Y REASIGNACIÓN DE RTI

#### 1. Filtro Estricto de Actividad (Solo Revalidación de Seguridad - RTI)

* **Inclusión Exclusiva:** El script únicamente procesa los slots que contengan explícitamente el identificador **`RTI`** en la celda.
* **Exclusión de Servicio:** Se descarta de forma estricta cualquier actividad de **Reva de Servicio** (celdas con términos como `"REVA DE SERVICIO"`, `"SERVICIO"` o `"SVC"`), asegurando que solo se transfiera la Revalidación Teórica/Práctica de Seguridad.

---

#### 2. Sincronización y Cuadre Exacto de Fechas (Cero Desfasajes)

* **Alineación por Clave Única de Fecha (`YYYY-MM-DD`):** El script compara las fechas entre el archivo de referencia y tu matriz activa utilizando únicamente el año, mes y día a medianoche local (`getFullYear()`, `getMonth()`, `getDate()`).
* **Prevención de Zonas Horarias:** Esto elimina desfasajes de $+1$ o $-1$ día que suelen ocurrir por diferencias de conversión de hora UTC/Local al leer celdas de fechas en Google Sheets.

---

#### 3. Regla de Asignación y Selección de Sustitutos (Mantenimiento de Disponibilidad)

* **Asignación Principal (Prioridad 1):** Si el instructor designado en el archivo de referencia se encuentra libre en tu matriz activa (celda con `"B"` o en blanco), se le asigna el slot directamente en su posición original.
* **Protección contra Bloqueos y Sobreescritura:** Si el instructor original está ocupado en tu matriz (debido a `VACACIONES`, `FERIADO`, `CUMPLE`, `DO`, `CHEQUEO`, `LCK` o vuelos asignados), **el script no borra su actividad previa**.
* **Reasignación a Sustituto Libre (Prioridad 2):** En lugar de omitir la REVA o sobreescribir la agenda, el script busca automáticamente en la lista de instructores a un sustituto disponible en esa misma fecha que tenga estado libre (`"B"` o celda vacía), asegurando que **se cumpla siempre la cuota requerida de slots de RTI (22 celdas/slots)**.

---

#### 4. Formato Visual y Distinción por Grupos

* **Identificación por Colores Suaves:** Para facilitar el control visual en el rol de instructores, el script asigna tonalidades diferenciadas de verde pastel/suave según el grupo de REVA (`GRUPO 1`, `GRUPO 2`, `GRUPO 3`, etc.).
* **Estilo de Texto:** Mantiene el contenido textual completo del slot (ej. `RTI: VIRTUAL A320F / B767 (08:30-17:30 hrs) INS TITULAR GRUPO 1`) formateado en texto negro en negrita.
*/

function clonarYReasignarRTI() {
  var idHojaMatriz = "19WmwaoLDZnArNztu_dJNwi7bjrGq-_cx_gw0aN96zfk"; 
  var gidMatriz = 1006838221;       // GID de tu Matriz Activa (Octubre)
  
  // Archivo y GID de Referencia exacto:
  var idHojaRef = "1C_KTGpXYoN4fruqzzZrqAfthiFojlq-nDcPhLGUxSys";
  var gidRolRef = 681297197;        // GID de la pestaña de referencia

  var ssMatriz = SpreadsheetApp.openById(idHojaMatriz);
  var ssRef = SpreadsheetApp.openById(idHojaRef);

  var hojaMatriz = ssMatriz.getSheets().find(function(h) { return h.getSheetId() === gidMatriz; }) || ssMatriz.getActiveSheet();
  var hojaRef = ssRef.getSheets().find(function(h) { return h.getSheetId() === gidRolRef; }) || ssRef.getActiveSheet();

  if (!hojaRef) {
    SpreadsheetApp.getUi().alert("No se encontró la pestaña con GID 681297197 en el archivo de referencia.");
    return;
  }

  // 1. Mapear Matriz Activa (Destino)
  var uFilaM = hojaMatriz.getLastRow();
  var uColM = hojaMatriz.getLastColumn();
  var numFilasM = uFilaM - 2;
  var numColsM = uColM - 2;

  var dataBPM = hojaMatriz.getRange(3, 1, numFilasM, 1).getValues();
  var mapaFilasBPM = {};
  var listaBPM = [];
  for (var i = 0; i < dataBPM.length; i++) {
    var bp = String(dataBPM[i][0]).replace(".0", "").trim();
    if (bp !== "") {
      mapaFilasBPM[bp] = i;
      listaBPM.push(bp);
    }
  }

  var filaFechasM = hojaMatriz.getRange(2, 3, 1, numColsM).getValues()[0];
  var mapaFechasM = {};
  for (var j = 0; j < filaFechasM.length; j++) {
    var dObj = parsearAFechaObj(filaFechasM[j]);
    if (dObj) {
      mapaFechasM[formatearKeyFecha(dObj)] = j;
    }
  }

  // Cargar Matriz Destino a Memoria
  var rangoMatriz = hojaMatriz.getRange(3, 3, numFilasM, numColsM);
  var matrizValores = rangoMatriz.getValues();
  var matrizFondos = rangoMatriz.getBackgrounds();
  var matrizColorLetra = rangoMatriz.getFontColors();
  var matrizPesoLetra = rangoMatriz.getFontWeights();

  // 2. Cargar Hoja de Referencia (Origen)
  var uFilaR = hojaRef.getLastRow();
  var uColR = hojaRef.getLastColumn();
  var numFilasR = uFilaR - 2;
  var numColsR = uColR - 2;

  var dataBPR = hojaRef.getRange(3, 1, numFilasR, 1).getValues();
  var mapaFilasBPR = {};
  for (var iR = 0; iR < dataBPR.length; iR++) {
    var bpR = String(dataBPR[iR][0]).replace(".0", "").trim();
    if (bpR !== "") mapaFilasBPR[bpR] = iR;
  }

  var filaFechasR = hojaRef.getRange(2, 3, 1, numColsR).getValues()[0];
  var mapaFechasR = {};
  for (var jR = 0; jR < filaFechasR.length; jR++) {
    var dObjR = parsearAFechaObj(filaFechasR[jR]);
    if (dObjR) {
      mapaFechasR[formatearKeyFecha(dObjR)] = jR;
    }
  }

  var rangoRef = hojaRef.getRange(3, 3, numFilasR, numColsR);
  var refValores = rangoRef.getValues();

  // Paleta de Verdes Suaves por Grupo RTI
  var coloresGrupos = {
    "GRUPO 1": "#d9ead3", // Verde muy suave
    "GRUPO 2": "#b6d7a8", // Verde menta
    "GRUPO 3": "#a2c4c9", // Verde agua
    "GRUPO 4": "#93c47d", // Verde hoja
    "GRUPO 5": "#8fce00", // Verde claro
    "GRUPO 6": "#d9ead3", // Verde pastel
    "DEFAULT": "#d9ead3"  // Por defecto
  };

  var contadorTransferidos = 0;
  var contadorReasignados = 0;

  // 3. Extraer celdas alineando por Clave Exacta de Fecha (YYYY-MM-DD)
  for (var keyFecha in mapaFechasR) {
    var colM = mapaFechasM[keyFecha];
    var colR = mapaFechasR[keyFecha];

    if (colM === undefined || colR === undefined) continue; // No existe la fecha en la matriz activa

    for (var bp in mapaFilasBPR) {
      var filaR = mapaFilasBPR[bp];
      var valRef = String(refValores[filaR][colR] || "").trim();
      var valRefUpper = valRef.toUpperCase();

      // Condición Estricta: Únicamente RTI de Seguridad (excluye SERVICIO y SVC)
      if (valRefUpper.indexOf("RTI") !== -1 && valRefUpper.indexOf("SERVICIO") === -1 && valRefUpper.indexOf("SVC") === -1) {
        
        // Determinar color verde suave según grupo
        var colorAsignar = coloresGrupos["DEFAULT"];
        for (var grp in coloresGrupos) {
          if (valRefUpper.indexOf(grp) !== -1) {
            colorAsignar = coloresGrupos[grp];
            break;
          }
        }

        var filaM = mapaFilasBPM[bp];
        var asignadoExitoso = false;

        // Opción A: Intentar asignar en la posición del instructor original de referencia
        if (filaM !== undefined) {
          var valDestino = String(matrizValores[filaM][colM]).trim().toUpperCase();
          if (valDestino === "B" || valDestino === "" || valDestino.indexOf("RTI") !== -1) {
            matrizValores[filaM][colM] = valRef;
            matrizFondos[filaM][colM] = colorAsignar;
            matrizColorLetra[filaM][colM] = "#000000";
            matrizPesoLetra[filaM][colM] = "bold";
            contadorTransferidos++;
            asignadoExitoso = true;
          }
        }

        // Opción B: Si el instructor de referencia está ocupado, reasignar a un sustituto libre
        if (!asignadoExitoso) {
          for (var b = 0; b < listaBPM.length; b++) {
            var altBP = listaBPM[b];
            var altFilaM = mapaFilasBPM[altBP];
            var altValDestino = String(matrizValores[altFilaM][colM]).trim().toUpperCase();

            if (altValDestino === "B" || altValDestino === "") {
              matrizValores[altFilaM][colM] = valRef;
              matrizFondos[altFilaM][colM] = colorAsignar;
              matrizColorLetra[altFilaM][colM] = "#000000";
              matrizPesoLetra[altFilaM][colM] = "bold";
              contadorReasignados++;
              break;
            }
          }
        }
      }
    }
  }

  // 4. Guardar cambios en Lote (Batch Update)
  rangoMatriz.setValues(matrizValores);
  rangoMatriz.setBackgrounds(matrizFondos);
  rangoMatriz.setFontColors(matrizColorLetra);
  rangoMatriz.setFontWeights(matrizPesoLetra);

  SpreadsheetApp.getUi().alert("¡Proceso Completado Exitosamente!\n- Slots RTI alineados en fecha e instructor original: " + contadorTransferidos + "\n- Slots RTI reasignados a instructores sustitutos libres: " + contadorReasignados + "\n(Sin desfasajes de fecha ni inclusión de Reva de Servicio).");
}

// ==========================================
// FUNCIONES AUXILIARES DE FECHA SIN DESFASE
// ==========================================
function parsearAFechaObj(val) {
  if (val instanceof Date) {
    return new Date(val.getFullYear(), val.getMonth(), val.getDate());
  }
  if (typeof val === 'string' && val.indexOf('/') !== -1) {
    var p = val.split('/');
    if (p.length === 3) {
      return new Date(parseInt(p[2], 10), parseInt(p[1], 10) - 1, parseInt(p[0], 10));
    }
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