/**
 * 90_Menu.js
 * Menu "Pairings WB" (Seccion 25) + mitigacion del BOUND_SCRIPT_GATE (Seccion 26, D2 en
 * docs/DECISIONS.md): el script es standalone, por lo que onOpen(e) simple trigger NUNCA se
 * disparara para el Spreadsheet productivo (los simple triggers solo existen para scripts
 * container-bound). La via real es un trigger INSTALABLE registrado una sola vez mediante
 * configurarMenuPairingsWB(), que si funciona para un script standalone apuntando a un
 * Spreadsheet externo por ID.
 *
 * configurarMenuPairingsWB() debe ejecutarse UNA VEZ desde el editor de Apps Script (Extensiones >
 * Apps Script > seleccionar esta funcion > Ejecutar), lo cual exige una autorizacion OAuth
 * interactiva que ningun CLI headless puede completar por la persona.
 */

/** Simple trigger: solo tiene efecto si este script alguna vez pasara a ser container-bound. */
function onOpen(e) {
  buildPairingsWbMenu_(SpreadsheetApp.getUi());
}

/** Handler del trigger INSTALABLE registrado por configurarMenuPairingsWB(). */
function onOpenInstalable_(e) {
  buildPairingsWbMenu_(SpreadsheetApp.getUi());
}

/**
 * Registra (idempotente) el trigger instalable "On open" apuntando al Spreadsheet productivo.
 * Ejecutar UNA SOLA VEZ, manualmente, desde el editor de Apps Script.
 */
function configurarMenuPairingsWB() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'onOpenInstalable_' && t.getEventType() === ScriptApp.EventType.ON_OPEN;
  });
  if (existing.length > 0) {
    return 'El trigger instalable ya existia (' + existing.length + '). No se creo uno nuevo.';
  }
  ScriptApp.newTrigger('onOpenInstalable_')
    .forSpreadsheet(WB_KNOWN.EXPECTED_SPREADSHEET_ID)
    .onOpen()
    .create();
  return 'Trigger instalable creado. La proxima vez que se abra el Spreadsheet "Pairings WB", el menu aparecera automaticamente.';
}

function buildPairingsWbMenu_(ui) {
  var menu = ui.createMenu('Pairings WB');

  menu.addSubMenu(ui.createMenu('Estado y configuración')
    .addItem('Diagnóstico del sistema', 'wbMenuDiagnostico')
    .addItem('Ver configuración', 'wbMenuVerConfiguracion')
    .addItem('Configurar año y mes', 'wbMenuConfigurarAnioMes'));

  menu.addSubMenu(ui.createMenu('BigQuery')
    .addItem('Detectar snapshots del mes', 'wbMenuDetectarSnapshots')
    .addItem('Certificar snapshot', 'wbMenuCertificarSnapshot')
    .addItem('Probar consulta / dry run', 'wbMenuProbarConsulta'));

  menu.addSubMenu(ui.createMenu('Proceso mensual')
    .addItem('Previsualizar cálculo', 'wbMenuPrevisualizarCalculo')
    .addItem('Calcular y publicar mes', 'wbMenuCalcularYPublicar')
    .addItem('Reconciliar cambios de fuente', 'wbMenuReconciliarCambios'));

  menu.addSubMenu(ui.createMenu('Históricos')
    .addItem('Crear/verificar histórico actual', 'wbMenuCrearVerificarHistorico')
    .addItem('Abrir carpeta de históricos', 'wbMenuAbrirCarpetaHistoricos'));

  menu.addSubMenu(ui.createMenu('Auditoría')
    .addItem('Ver último run', 'wbMenuVerUltimoRun')
    .addItem('Ejecutar QA', 'wbMenuEjecutarQA'));

  menu.addToUi();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {}; // sin logica pura: nada que exponer a Node.
}
