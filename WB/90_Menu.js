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
 *
 * Estructura (mision "simplify user menu"): UN SOLO menu de nivel superior, "Pairings WB", con las
 * 4 acciones que necesita el usuario final primero (lenguaje operacional, sin BigQuery/snapshot/
 * hash/_CONFIG/_RUNS) y TODA herramienta tecnica/administrativa agrupada bajo el submenu
 * "Administracion" (nunca en el nivel superior). La estructura se declara como un objeto plano
 * (buildPairingsWbMenuSpec_, sin dependencia de SpreadsheetApp) para poder testearla en Node sin
 * mockear la UI de Sheets; renderMenuSpec_/buildPairingsWbMenu_ son el unico glue que si depende
 * de SpreadsheetApp.getUi().
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
 * Registra (idempotente) el trigger instalable "On open" para el archivo de SEPTIEMBRE 2026 (el
 * mes original, unico que puede necesitar este arranque manual desde antes del modelo multi-mes).
 * Ejecutar UNA SOLA VEZ, manualmente, desde el editor de Apps Script. Cualquier mes creado despues
 * via "Meses > Crear mes" ya recibe su propio trigger automaticamente
 * (ensureOpenTriggerForSpreadsheet, 85_MonthlyWorkbook.js), sin este paso manual.
 */
function configurarMenuPairingsWB() {
  var result = ensureOpenTriggerForSpreadsheet(WB_KNOWN.EXPECTED_SPREADSHEET_ID);
  return result.created
    ? 'Trigger instalable creado. La proxima vez que se abra el Spreadsheet de Septiembre 2026, el menu aparecera automaticamente.'
    : 'El trigger instalable ya existia. No se creo uno nuevo.';
}

/**
 * Especificacion PURA (sin SpreadsheetApp) del unico menu de nivel superior "Pairings WB". Cada
 * nodo es {type:'item', label, fn} | {type:'separator'} | {type:'submenu', label, items}. El
 * primer nivel de `items` es exactamente: las 4 acciones de usuario final, un separador, y el
 * submenu "Administracion" (nada tecnico queda fuera de "Administracion").
 */
function buildPairingsWbMenuSpec_() {
  return {
    label: 'Pairings WB',
    items: [
      { type: 'item', label: 'Actualizar Pairings WB', fn: 'wbMenuActualizarPairingsWB' },
      { type: 'item', label: 'Previsualizar cambios', fn: 'wbMenuPrevisualizarCambios' },
      { type: 'item', label: 'Ver estado del mes', fn: 'wbMenuVerEstadoDelMes' },
      { type: 'item', label: 'Ir a RESUMEN', fn: 'wbMenuIrAResumen' },
      { type: 'separator' },
      {
        // D23: 1 Apps Script central + N Spreadsheets mensuales independientes. Cada mes vive en su
        // propio archivo (nunca se reutiliza uno para el mes siguiente); este submenu es la unica
        // via de usuario final para crear/abrir esos archivos.
        type: 'submenu',
        label: 'Meses',
        items: [
          { type: 'item', label: 'Crear próximo mes', fn: 'wbMenuCrearProximoMes' },
          { type: 'item', label: 'Crear mes manualmente', fn: 'wbMenuCrearMesManualmente' },
          { type: 'item', label: 'Abrir mes actual', fn: 'wbMenuAbrirMesActual' },
          { type: 'item', label: 'Abrir carpeta de Pairings WB', fn: 'wbMenuAbrirCarpetaPairingsWB' },
        ],
      },
      {
        type: 'submenu',
        label: 'Administración',
        items: [
          {
            type: 'submenu', label: 'Configuración', items: [
              { type: 'item', label: 'Diagnóstico del sistema', fn: 'wbMenuDiagnostico' },
              { type: 'item', label: 'Ver configuración técnica', fn: 'wbMenuVerConfiguracion' },
              { type: 'item', label: 'Configurar año y mes', fn: 'wbMenuConfigurarAnioMes' },
            ],
          },
          {
            type: 'submenu', label: 'Fuente de datos', items: [
              { type: 'item', label: 'Detectar snapshots del mes', fn: 'wbMenuDetectarSnapshots' },
              { type: 'item', label: 'Certificar snapshot', fn: 'wbMenuCertificarSnapshot' },
              { type: 'item', label: 'Comparar snapshot con RESUMEN actual', fn: 'wbMenuCompararSnapshotConResumen' },
              { type: 'item', label: 'Probar consulta / dry run', fn: 'wbMenuProbarConsulta' },
              { type: 'item', label: 'Probar/configurar proyecto de ejecución', fn: 'wbMenuProbarConfigurarProyectoEjecucion' },
            ],
          },
          {
            type: 'submenu', label: 'Proceso y reconciliación', items: [
              { type: 'item', label: 'Previsualización técnica', fn: 'wbMenuPrevisualizarCalculo' },
              { type: 'item', label: 'Analizar cambios de asignaciones', fn: 'wbMenuReconciliarCambios' },
            ],
          },
          {
            type: 'submenu', label: 'Históricos', items: [
              { type: 'item', label: 'Crear/verificar histórico actual', fn: 'wbMenuCrearVerificarHistorico' },
              { type: 'item', label: 'Abrir carpeta de históricos', fn: 'wbMenuAbrirCarpetaHistoricos' },
            ],
          },
          {
            type: 'submenu', label: 'Auditoría y QA', items: [
              { type: 'item', label: 'Ver último run', fn: 'wbMenuVerUltimoRun' },
              { type: 'item', label: 'Ejecutar QA', fn: 'wbMenuEjecutarQA' },
            ],
          },
          { type: 'separator' },
          { type: 'item', label: 'Guía de uso y administración', fn: 'wbMenuGuiaDeUso' },
        ],
      },
    ],
  };
}

/** Aplica una especificacion de menu (buildPairingsWbMenuSpec_) sobre una Ui real de Sheets. */
function renderMenuSpec_(ui, spec) {
  var menu = ui.createMenu(spec.label);
  appendMenuEntries_(ui, menu, spec.items);
  menu.addToUi();
}

function appendMenuEntries_(ui, menu, items) {
  items.forEach(function (entry) {
    if (entry.type === 'item') {
      menu.addItem(entry.label, entry.fn);
    } else if (entry.type === 'separator') {
      menu.addSeparator();
    } else if (entry.type === 'submenu') {
      var sub = ui.createMenu(entry.label);
      appendMenuEntries_(ui, sub, entry.items);
      menu.addSubMenu(sub);
    }
  });
}

function buildPairingsWbMenu_(ui) {
  renderMenuSpec_(ui, buildPairingsWbMenuSpec_());
}

/**
 * Guia de uso y administracion (mision <admin_help>): HTML estatico, sin framework ni asset
 * externo, mostrado en un sidebar (HtmlService) desde "Administración > Guía de uso y
 * administración". `buildGuiaHtmlContent_` es PURA (solo concatena strings) para poder testear en
 * Node que cubre las 7 hojas (visibles + tecnicas) y las secciones exigidas; solo
 * `wbMenuGuiaDeUso` (99_EntryPoints.js) depende de HtmlService.
 */
function buildGuiaHtmlContent_() {
  return [
    '<style>',
    '  body { font-family: Arial, sans-serif; font-size: 13px; line-height: 1.45; color: #202124; padding: 4px 8px 24px; }',
    '  h2 { font-size: 15px; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }',
    '  h3 { font-size: 13px; margin: 12px 0 4px; }',
    '  ul { margin: 4px 0; padding-left: 18px; }',
    '  li { margin-bottom: 4px; }',
    '  code { background: #f1f3f4; padding: 1px 4px; border-radius: 3px; }',
    '  .estado { font-weight: bold; }',
    '</style>',

    '<h2>A. Modelo: 1 archivo = 1 mes</h2>',
    '<p>Cada mes de Pairings WB vive en su PROPIO archivo de Google Sheets (ej: ',
    '"Pairings WB - OCTUBRE 2026"), nunca se reutiliza el archivo de un mes para el mes siguiente. ',
    'Un Apps Script central controla todos los archivos. Cada archivo conserva permanentemente su ',
    'propio periodo, sus asignaciones (INS/ACT/assignment_id), sus outputs y su auditoría — nunca se ',
    'reconcilian asignaciones humanas entre archivos de meses distintos. El <code>Diccionario</code> ',
    'de instructores sí se copia al crear cada mes nuevo. Use <b>Meses</b> para crear/abrir archivos.</p>',

    '<h2>B. Meses</h2>',
    '<ul>',
    '  <li><b>Crear próximo mes</b>: crea (o reutiliza si ya existe) el archivo del mes calendario ',
    '      siguiente al de este archivo. El nuevo archivo empieza sin asignaciones, sin ',
    '      <code>INS</code>/<code>ACT</code> heredados y con su snapshot pendiente de certificar ',
    '      (o certificado automáticamente si Carmen Gold solo ofrece un candidato).</li>',
    '  <li><b>Crear mes manualmente</b>: igual que arriba, pero para el año y mes que usted indique.</li>',
    '  <li><b>Abrir mes actual</b>: muestra el periodo y el enlace de este archivo.</li>',
    '  <li><b>Abrir carpeta de Pairings WB</b>: enlace a la carpeta de Drive con todos los meses.</li>',
    '</ul>',

    '<h2>C. Opciones del usuario final</h2>',
    '<ul>',
    '  <li><b>Actualizar Pairings WB</b>: el flujo normal de cada mes. Revisa todo silenciosamente ',
    '      (configuración, snapshot, seguridad del baseline), calcula una previsualización, muestra ',
    '      un resumen humano y solo publica si usted confirma y todos los controles pasan.</li>',
    '  <li><b>Previsualizar cambios</b>: el mismo cálculo, en modo de solo lectura. Nunca escribe nada ',
    '      en el Spreadsheet.</li>',
    '  <li><b>Ver estado del mes</b>: un vistazo rápido y económico (sin consultar la fuente de datos) ',
    '      al periodo configurado, si está listo para actualizar y cuántas asignaciones hay.</li>',
    '  <li><b>Ir a RESUMEN</b>: lo lleva directo a la hoja RESUMEN.</li>',
    '</ul>',

    '<h2>D. Administración</h2>',
    '<h3>Configuración</h3>',
    '<ul>',
    '  <li><b>Diagnóstico del sistema</b>: revisa Spreadsheet, hojas, BigQuery y el último run.</li>',
    '  <li><b>Ver configuración técnica</b>: muestra todas las claves de <code>_CONFIG</code> y rutas.</li>',
    '  <li><b>Configurar año y mes</b>: cambia el periodo objetivo (reinicia la certificación de snapshot).</li>',
    '</ul>',
    '<h3>Fuente de datos</h3>',
    '<ul>',
    '  <li><b>Detectar snapshots del mes</b>: busca cargas candidatas en Carmen Gold.</li>',
    '  <li><b>Certificar snapshot</b>: fija la carga exacta que se usará para calcular.</li>',
    '  <li><b>Comparar snapshot con RESUMEN actual</b>: diagnóstico de solo lectura que separa ',
    '      "el hash legacy no es compatible" de "el pairing realmente cambió", comparando hechos ',
    '      visibles (fecha, vuelos, ruta, inicio, fin) en vez del hash. No modifica nada.</li>',
    '  <li><b>Probar consulta / dry run</b>: valida el SQL sin ejecutarlo ni facturarlo.</li>',
    '  <li><b>Probar/configurar proyecto de ejecución</b>: prueba (y opcionalmente aplica) el proyecto ',
    '      de BigQuery que factura las consultas.</li>',
    '</ul>',
    '<h3>Proceso y reconciliación</h3>',
    '<ul>',
    '  <li><b>Previsualización técnica</b>: el mismo cálculo de solo lectura, con detalle técnico ',
    '      (snapshot, QA, bytes de BigQuery) para uso administrativo.</li>',
    '  <li><b>Analizar cambios de asignaciones</b>: cuántas asignaciones se conservarían, cambiarían ',
    '      de estado o aparecerían como nuevas si se publicara ahora.</li>',
    '</ul>',
    '<h3>Históricos</h3>',
    '<ul>',
    '  <li><b>Crear/verificar histórico actual</b>: genera (si falta) la copia congelada del último run publicado.</li>',
    '  <li><b>Abrir carpeta de históricos</b>: enlace a la carpeta de Drive con los históricos.</li>',
    '</ul>',
    '<h3>Auditoría y QA</h3>',
    '<ul>',
    '  <li><b>Ver último run</b>: detalle completo del último registro en <code>_RUNS</code>.</li>',
    '  <li><b>Ejecutar QA</b>: corre los controles de calidad que no requieren BigQuery.</li>',
    '</ul>',

    '<h2>E. Hojas visibles</h2>',
    '<ul>',
    '  <li><b>RESUMEN</b>: tabla operacional de asignaciones. <code>INS</code> y <code>ACT</code> son ',
    '      decisiones HUMANAS; nunca se sobrescriben por un refresh. El resto de columnas técnicas ',
    '      queda oculto a la izquierda/derecha de la vista habitual.</li>',
    '  <li><b>Vuelos</b>: detalle operacional generado a partir del cálculo. Es OUTPUT, nunca fuente ',
    '      de <code>INS</code>/<code>ACT</code>.</li>',
    '  <li><b>Cronograma</b>: vista mensual tipo calendario, también generada (OUTPUT).</li>',
    '  <li><b>Diccionario</b>: maestro de <code>INS</code> / <code>BP</code> / <code>NOMBRE</code>.</li>',
    '</ul>',

    '<h2>F. Hojas técnicas (ocultas por diseño)</h2>',
    '<ul>',
    '  <li><b>_PAIRINGS_DATA</b>: backend leg-level de todo el snapshot publicado (incluye lo que no ',
    '      es elegible, con su motivo).</li>',
    '  <li><b>_CONFIG</b>: configuración técnica y snapshot certificado. No editar manualmente salvo ',
    '      necesidad administrativa controlada.</li>',
    '  <li><b>_RUNS</b>: auditoría append-only de cada ejecución (preview y publicación).</li>',
    '</ul>',

    '<h2>G. Flujo mensual</h2>',
    '<p>Preparar periodo &rarr; revisar/certificar fuente &rarr; previsualizar &rarr; revisar &rarr; ',
    'publicar &rarr; histórico.</p>',

    '<h2>H. Estados de asignación</h2>',
    '<ul>',
    '  <li><b>ACTIVE</b>: se volvió a calcular el mismo snapshot; la asignación se conserva tal cual.</li>',
    '  <li><b>RELINKED_IDENTICAL</b>: cambió el snapshot pero el pairing es idéntico; se conserva la ',
    '      asignación y se actualiza el puntero técnico.</li>',
    '  <li><b>REVIEW_SOURCE_CHANGED</b>: el mismo número de pairing ahora tiene contenido distinto; la ',
    '      fila vieja se conserva intacta y el pairing nuevo aparece además como NEW, para que un ',
    '      humano decida.</li>',
    '  <li><b>ORPHANED_SOURCE_MISSING</b>: el pairing ya no aparece en el snapshot actual; la fila se ',
    '      conserva completa, nunca se borra.</li>',
    '  <li><b>NEW</b>: pairing del snapshot actual sin ninguna asignación previa que lo reclame.</li>',
    '</ul>',

    '<h2>I. Seguridad</h2>',
    '<ul>',
    '  <li><code>INS</code>/<code>ACT</code> son decisiones humanas: ningún cálculo las sobrescribe jamás.</li>',
    '  <li>Un baseline operacional sin vinculación técnica segura (migrado antes de tener snapshot ',
    '      certificado) bloquea la publicación hasta que se revise con "Comparar snapshot con ',
    '      RESUMEN actual".</li>',
    '  <li>Si algún control de reconciliación queda bloqueado, no se publica: se avisa y se pide ',
    '      revisión administrativa.</li>',
    '</ul>',
  ].join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildPairingsWbMenuSpec_: buildPairingsWbMenuSpec_,
    buildGuiaHtmlContent_: buildGuiaHtmlContent_,
  };
}
