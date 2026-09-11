// ============================================================
// PANEL DE PRIORIDADES SCC — Backend v2.1
// Archivo: PanelBackend.gs
// Cambios v2.1:
//   - Agrega sección DESPACHO: OCs con todas las líneas Recepcionado
//   - Agrega sección RETIROS: líneas en estado Retiro / Retiro Pte.
//   - Alertas: excluye OCs con TODAS las líneas en estados cerrados
//   - Alertas: filtra solo casos graves (vencida>=3d, adq>=48h, anulado+recepcionado)
//   - adqMuyAtrasada: nuevo campo para >48h hábiles sin comprar
// ============================================================

const PANEL_CONFIG = {
  SHEET_NAME: "GESTOR DE COMPRAS",
  COL: {
    EMPRESA:       0,
    EJECUTIVO:     1,
    ID_OC:         2,
    CLIENTE:       3,
    DIR_DESPACHO:  4,
    REGION:        5,
    FECHA_CARGA:   6,
    ENTREGA_OC:    8,
    NOMBRE_PROD:   11,
    CANTIDAD:      12,
    OBS_VENTAS:    15,
    TIPO_COMPRA:   16,
    ENCARGADO:     17,
    ESTADO:        18,
    PROVEEDOR:     25,
    CANT_RECEPCIONADA: 35,   // AJ — Cant. Recepcionada (módulo bodega JP)
    OBS_COMPRAS:   26,
    OBS_LOGISTICA: 27,
    FACTURA_FOLIO: 29,       // AD — FACTURA RECIBIDA FOLIO (módulo bodega JP)
    RUT_CLIENTE:   30,
    VALOR_UNITARIO: 13,
    VALOR_TOTAL:    14,
    COSTO_ESTIMADO: 19,
    COSTO_REAL_TOT: 22,
  },
  // Estados que significan que la OC está cerrada completamente
  ESTADOS_CERRADOS: [
    "Despachado", "Retira cliente", "Anulado", "Devuelto", "Directo proveedor"
  ],
  // Estados de retiro que Daniel debe gestionar
  ESTADOS_RETIRO: ["Retiro"],
  DIAS_HISTORICO: 180,
  REGION_RM: "XIII - Región Metropolitana de Santiago",
  SHEET_COBRANZA: "base de datos cobranza",
  COL_COB: {
    CUENTA:      0,
    RUT:         1,
    RAZON:       2,
    VENDEDOR:    3,
    DOCUMENTO:   4,
    NUMERO:      5,
    FECHA_EMIS:  6,
    FECHA_VENC:  7,
    CONDICION:   8,
    TOTAL_DOC:   9,
    TOTAL_COB:   10,
    SALDO:       11,
    OBS:         12,  // columna M que acabas de agregar
  },
  EMAIL: {
    JP:    "juanpablo.guillaume@scc.cl",
    WENDY: "wendy.munera@scc.cl",
    JULIO: "julio.israel@scc.cl",
    ARIEL: "ariel.rodriguez@scc.cl",
    PEDRO: "pedro.alcaide@scc.cl",
    BEA:   "beatriz.pirela@scc.cl",
  },
  EJECUTIVOS: {
    "Wendy Munera":    "wendy.munera@scc.cl",
    "Wendy":           "wendy.munera@scc.cl",
    "Gari Saez":       "gari.saez@corppremier.cl",
    "Gari":            "gari.saez@corppremier.cl",
    "Giorgina Vivas":  "giorgina.vivas@corppremier.cl",
    "Giorgina":        "giorgina.vivas@corppremier.cl",
    "Enrique Cabas":   "enrique.cabas@corppremier.cl",
    "Enrique":         "enrique.cabas@corppremier.cl",
    "Karla Nuñez":     "karla.nunez@corppremier.cl",
    "Karla":           "karla.nunez@corppremier.cl",
    "Belen Sazo":      "belen.sazo@corppremier.cl",
    "Belen":           "belen.sazo@corppremier.cl",
    "Manuel Sifontes": "manuel.sifontes@corppremier.cl",
    "Manuel":          "manuel.sifontes@corppremier.cl",
    "Zulay Ramirez":   "zulay.ramirez@corppremier.cl",
    "Zulay":           "zulay.ramirez@corppremier.cl",
    "Pamela Ramos":    "pamela.ramos@corppremier.cl",
    "Pamela":          "pamela.ramos@corppremier.cl",
    "Esteban Yalpi":   "estaban.yalpi@scc.cl",
    "Esteban":         "estaban.yalpi@scc.cl",
  },
};

// ── Días hábiles entre dos fechas ────────────────────────────
function diasHabiles(desde, hasta) {
  let count = 0;
  const d = new Date(desde);
  d.setHours(0, 0, 0, 0);
  const h = new Date(hasta);
  h.setHours(23, 59, 59, 0);
  while (d < h) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

// ── Horas hábiles entre dos fechas ───────────────────────────
function horasHabiles(desde, hasta) {
  return diasHabiles(desde, hasta) * 8;
}

// ── Endpoint principal ───────────────────────────────────────
function doGet(e) {
  const callback = e && e.parameter && e.parameter.callback;
  const output   = ContentService.createTextOutput();

  try {
    const accion = e && e.parameter && e.parameter.accion;
    // Sin accion → comportamiento original (panel completo). El frontend
    // actual llama así, no debe notar ningún cambio.
    const data = accion === "buscarProveedor"
      ? buscarPorProveedor(e.parameter.texto)
      : obtenerDatosCacheado_();
    const payload = JSON.stringify({ ok: true, data });

    if (callback) {
      output.setMimeType(ContentService.MimeType.JAVASCRIPT);
      output.setContent(callback + "(" + payload + ")");
    } else {
      output.setMimeType(ContentService.MimeType.JSON);
      output.setContent(payload);
    }
  } catch (err) {
    const errPayload = JSON.stringify({ ok: false, error: err.message });
    if (callback) {
      output.setMimeType(ContentService.MimeType.JAVASCRIPT);
      output.setContent(callback + "(" + errPayload + ")");
    } else {
      output.setMimeType(ContentService.MimeType.JSON);
      output.setContent(errPayload);
    }
  }

  return output;
}

function doPost(e) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.accion === "guardarObs") {
      const result = guardarObsCobranza(body.rowIndex, body.obs);
      output.setContent(JSON.stringify({ ok: true, ...result }));
    } else if (body.accion === "registrarRecepcion") {
      const result = registrarRecepcion(
        body.filaSheet, body.cantidad, body.obsLogistica, body.folioFactura
      );
      output.setContent(JSON.stringify({ ok: true, ...result }));
    } else {
      output.setContent(JSON.stringify({ ok: false, error: "Acción desconocida" }));
    }
  } catch (err) {
    output.setContent(JSON.stringify({ ok: false, error: err.message }));
  }
  return output;
}

// ── Lector principal del sheet ───────────────────────────────
function leerOCs() {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(PANEL_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Hoja no encontrada: " + PANEL_CONFIG.SHEET_NAME);

  const rows  = sheet.getDataRange().getValues();
  const hoy   = new Date();
  const corte = new Date();
  corte.setDate(corte.getDate() - PANEL_CONFIG.DIAS_HISTORICO);

  const ocMap = {};

  for (let i = 2; i < rows.length; i++) {
    const r        = rows[i];
    const idOC     = String(r[PANEL_CONFIG.COL.ID_OC]  || "").trim();
    const estado   = String(r[PANEL_CONFIG.COL.ESTADO] || "Nueva").trim();
    const fechaCarga = r[PANEL_CONFIG.COL.FECHA_CARGA];

    if (!idOC) continue;
    if (fechaCarga && new Date(fechaCarga) < corte) continue;

    if (!ocMap[idOC]) {
      ocMap[idOC] = {
        idOC,
        empresa:    String(r[PANEL_CONFIG.COL.EMPRESA]      || "").trim(),
        ejecutivo:  String(r[PANEL_CONFIG.COL.EJECUTIVO]    || "").trim(),
        cliente:    String(r[PANEL_CONFIG.COL.CLIENTE]      || "").trim(),
        rutCliente: String(r[PANEL_CONFIG.COL.RUT_CLIENTE]  || "").trim(),
        dir:        String(r[PANEL_CONFIG.COL.DIR_DESPACHO] || "").trim(),
        region:     String(r[PANEL_CONFIG.COL.REGION]       || "").trim(),
        tipoCompra: String(r[PANEL_CONFIG.COL.TIPO_COMPRA]  || "").trim(),
        encargado:  String(r[PANEL_CONFIG.COL.ENCARGADO]    || "").trim(),
        fechaCarga: fechaCarga ? new Date(fechaCarga).toISOString() : null,
        entregaOC:  r[PANEL_CONFIG.COL.ENTREGA_OC]
                      ? new Date(r[PANEL_CONFIG.COL.ENTREGA_OC]).toISOString()
                      : null,
        rut:   String(r[PANEL_CONFIG.COL.RUT_CLIENTE] || "").trim(),
        lineas: [],
      };
    }

    const cantidad      = Number(r[PANEL_CONFIG.COL.CANTIDAD]        || 1);
    const costoRealTot  = Number(r[PANEL_CONFIG.COL.COSTO_REAL_TOT]  || 0);         // W = total, NO multiplica
    const costoEstimado = Number(r[PANEL_CONFIG.COL.COSTO_ESTIMADO]  || 0) * cantidad; // T = unitario, sí multiplica

    ocMap[idOC].lineas.push({
      producto:      String(r[PANEL_CONFIG.COL.NOMBRE_PROD]   || "").trim(),
      cantidad:      r[PANEL_CONFIG.COL.CANTIDAD]             || "",
      proveedor:     String(r[PANEL_CONFIG.COL.PROVEEDOR]     || "").trim(),
      obsVentas:     String(r[PANEL_CONFIG.COL.OBS_VENTAS]    || "").trim(),
      obsCompras:    String(r[PANEL_CONFIG.COL.OBS_COMPRAS]   || "").trim(),
      obsLogistica:  String(r[PANEL_CONFIG.COL.OBS_LOGISTICA] || "").trim(),
      estado,
      valorUnitario: Number(r[PANEL_CONFIG.COL.VALOR_UNITARIO] || 0),
      valorTotal:    Number(r[PANEL_CONFIG.COL.VALOR_TOTAL]    || 0),
      costoRealTotal: costoRealTot > 0 ? costoRealTot : costoEstimado,
    });
  }

 return { ocMap, hoy };
}
function leerCobranza() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PANEL_CONFIG.SHEET_COBRANZA);
  if (!sheet) return { porRut: {}, filas: [] };

  const rows = sheet.getDataRange().getValues();
  const hoy  = new Date(); hoy.setHours(0,0,0,0);

  const porRut = {};  // RUT → { diasMaxMora, nivel, documentos[] }
  const filas  = [];  // array para la pestaña cobranza

  for (let i = 1; i < rows.length; i++) {
    const r      = rows[i];
    const saldo  = parseFloat(r[PANEL_CONFIG.COL_COB.SALDO]) || 0;
    if (saldo <= 0) continue;

    const rut       = String(r[PANEL_CONFIG.COL_COB.RUT]        || "").trim();
    const razon     = String(r[PANEL_CONFIG.COL_COB.RAZON]       || "").trim();
    const vendedor  = String(r[PANEL_CONFIG.COL_COB.VENDEDOR]    || "").trim();
    const fechaVenc = r[PANEL_CONFIG.COL_COB.FECHA_VENC];
    const obs       = String(r[PANEL_CONFIG.COL_COB.OBS]         || "").trim();
    const totalDoc  = parseFloat(r[PANEL_CONFIG.COL_COB.TOTAL_DOC]) || 0;
    const totalCob  = parseFloat(r[PANEL_CONFIG.COL_COB.TOTAL_COB]) || 0;

    // Calcular días mora
    let diasMora = 0;
    if (fechaVenc) {
      const fv = new Date(fechaVenc); fv.setHours(0,0,0,0);
      diasMora = Math.floor((hoy - fv) / 86400000);
      if (diasMora < 0) diasMora = 0;  // no vencido aún
    }

    // Nivel semáforo
    const nivel = diasMora > 30 ? "rojo" : diasMora >= 1 ? "amarillo" : "verde";

    const fila = {
      rowIndex: i,  // para guardar obs después
      rut, razon, vendedor,
      fechaVenc: fechaVenc ? new Date(fechaVenc).toISOString() : null,
      saldo, totalDoc, totalCob, diasMora, nivel, obs,
      numero:    String(r[PANEL_CONFIG.COL_COB.NUMERO]    || "").trim(),
      documento: String(r[PANEL_CONFIG.COL_COB.DOCUMENTO] || "").trim(),
    };

    filas.push(fila);

    // Mapa por RUT: guardar el nivel más grave
    if (!porRut[rut]) {
      porRut[rut] = { diasMaxMora: diasMora, nivel, razon };
    } else {
      if (diasMora > porRut[rut].diasMaxMora) {
        porRut[rut].diasMaxMora = diasMora;
        porRut[rut].nivel       = nivel;
      }
    }
  }

  return { porRut, filas };
}
function guardarObsCobranza(rowIndex, obs) {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(PANEL_CONFIG.SHEET_COBRANZA);
  if (!sheet) throw new Error("Hoja cobranza no encontrada");
  // +1 porque Apps Script es 1-based; rowIndex ya incluye el header (i=1 es fila 2)
  sheet.getRange(rowIndex + 1, 13).setValue(obs);
  return { ok: true };
}
// ── Mapa de morosidad por RUT ─────────────────────────────
function obtenerMorosidad() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("BASE DE DATOS COBRANZA");
  if (!sheet) return {};

  const rows = sheet.getDataRange().getValues();
  const hoy  = new Date();
  const mora = {}; // { rut: { diasMax, saldoTotal } }

  for (let i = 1; i < rows.length; i++) {
    const rut        = String(rows[i][1] || "").trim();
    const vencimiento = rows[i][7];
    const saldo      = Number(rows[i][11]) || 0;

    if (!rut || !vencimiento || saldo <= 0) continue;

    const fVenc = new Date(vencimiento);
    const dias  = Math.floor((hoy - fVenc) / (1000 * 60 * 60 * 24));

    if (dias <= 0) continue; // No vencido aún

    if (!mora[rut]) mora[rut] = { diasMax: 0, saldoTotal: 0, nivel: "verde" };
    mora[rut].diasMax    = Math.max(mora[rut].diasMax, dias);
    mora[rut].saldoTotal += saldo;
    // Calcular nivel según días máximos vencidos
    mora[rut].nivel = mora[rut].diasMax > 30 ? "rojo" : "amarillo";
  }

  return mora;
}
// ── Panel cacheado (solo para el endpoint) ───────────────────
// Deliberadamente NO se cachea dentro de obtenerDatos(): los correos,
// los triggers y los diagnósticos deben seguir viendo el dato fresco.
// Solo la respuesta HTTP al frontend pasa por caché.
function obtenerDatosCacheado_() {
  const hit = cacheLeerTroceado_(PANEL_CACHE_KEY);
  if (hit) return hit;
  const data = obtenerDatos();
  cacheGuardarTroceado_(PANEL_CACHE_KEY, data, PANEL_CACHE_TTL);
  return data;
}

// ── Datos para el panel ──────────────────────────────────────
function obtenerDatos() {
  const { ocMap, hoy } = leerOCs();
  const moraMap = obtenerMorosidad();
  const { porRut, filas: filasCobranza } = leerCobranza();
  const adquisiciones = [];
  const bodega        = [];
  const alertas       = [];
  const despacho      = [];       // ← NUEVO
  const retirosArr    = [];       // ← NUEVO: retiros para Daniel
  const despachosRM   = [];       // ← NUEVO: despachos RM para Daniel
  for (const idOC in ocMap) {
    const oc     = ocMap[idOC];
    const lineas = oc.lineas;
    const estados = lineas.map(l => l.estado);
    
    // — Métricas agregadas de la OC —
    const montoVenta = lineas.reduce((s, l) => s + (l.valorTotal || 0), 0);
    const costoTotal = lineas.reduce((s, l) => s + (l.costoRealTotal || 0), 0);
    const margenPct = montoVenta > 0 ? ((montoVenta - costoTotal) / montoVenta) * 100 : 0;
    const proveedoresUnicos = [...new Set(
    lineas.map(l => (l.proveedor || "").trim()).filter(p => p)
    )];
    const cantProveedores = proveedoresUnicos.length;

    const esExpress    = oc.tipoCompra === "Compra express" || oc.tipoCompra === "Express";
    const sinEncargado = !oc.encargado || oc.encargado.trim() === "";

    // ¿Todas las líneas están en estados cerrados?
    const todasCerradas = lineas.every(l =>
      PANEL_CONFIG.ESTADOS_CERRADOS.includes(l.estado)
    );
    // Si toda la OC está cerrada, no aparece en ninguna sección operativa
    if (todasCerradas) continue;

    // KPI: horas hábiles desde solicitud → hoy
    const hh_solicitud = oc.fechaCarga
      ? horasHabiles(new Date(oc.fechaCarga), hoy) : null;

    // Días de atraso en entrega
    let diasAtrasoEntrega = 0;
    if (oc.entregaOC) {
      const fe = new Date(oc.entregaOC);
      if (fe < hoy) diasAtrasoEntrega = diasHabiles(fe, hoy);
    }

    // ── RETIROS: líneas en estado Retiro / Retiro Pte. ──────
    const lineasRetiro = lineas.filter(l =>
      PANEL_CONFIG.ESTADOS_RETIRO.includes(l.estado)
    );
    if (lineasRetiro.length > 0) {
      // ¿Completa la OC? = no quedan líneas activas fuera de retiro y recepcionado
      const lineasPendientesNoRetiro = lineas.filter(l =>
        !PANEL_CONFIG.ESTADOS_CERRADOS.includes(l.estado) &&
        !PANEL_CONFIG.ESTADOS_RETIRO.includes(l.estado) &&
        l.estado !== "Recepcionado"
      );
      const completaOC = lineasPendientesNoRetiro.length === 0;

      // ¿Está listo para retirar? = al menos una línea en "Retiro" (no "Retiro Pte.")
      const listo = lineasRetiro.some(l => l.estado === "Retiro");

      retirosArr.push({
        ...oc,
        lineas: lineasRetiro,
        totalLineas: lineas.length,
        completaOC,
        listo,
        diasAtrasoEntrega,
        alertaAnuladoRecepcionado:
          estados.includes("Anulado") && estados.includes("Recepcionado"),
        montoVenta,        // ← nuevo
        costoTotal,        // ← nuevo
        margenPct,         // ← nuevo
        cantProveedores,   // ← nuevo
        proveedoresUnicos  // ← nuevo (lista de nombres, útil para tooltip)
        });
    }

    // ── DESPACHO: OCs completamente recepcionadas ────────────
    // Excluir retiros y estados cerrados para calcular líneas activas
    const lineasActivas = lineas.filter(l =>
     !["Anulado","Devuelto","Directo proveedor","Retira cliente","Despachado"]
       .includes(l.estado)
    );
    const todasRecepcionadas = lineasActivas.length > 0 &&
      lineasActivas.every(l => l.estado === "Recepcionado");

    if (todasRecepcionadas) {
      despacho.push({
        ...oc,
        lineas: lineasActivas,
        totalLineas: lineas.length,
        diasAtrasoEntrega,
        montoVenta,        // ← nuevo
        costoTotal,        // ← nuevo
        margenPct,         // ← nuevo
        cantProveedores,   // ← nuevo
        proveedoresUnicos  // ← nuevo (lista de nombres, útil para tooltip)
        });

      // ── DESPACHOS RM para Daniel (Ruta Logística prioridad 1) ──
      const esRM = oc.region && oc.region.indexOf("Metropolitana") !== -1;
      if (esRM) {
        despachosRM.push({
          ...oc,
          lineas: lineasActivas,
          totalLineas: lineas.length,
          diasAtraso: diasAtrasoEntrega,
          montoVenta,        // ← nuevo
          costoTotal,        // ← nuevo
          margenPct,         // ← nuevo
          cantProveedores,   // ← nuevo
          proveedoresUnicos  // ← nuevo (lista de nombres, útil para tooltip)
        });
      }

      continue; // No mostrar en adq/bodega
    }

    // ── ADQUISICIONES: líneas pendientes de compra ───────────
    // Todos los estados que requieren acción de adquisiciones
    const ESTADOS_ADQ = [
      "Nueva", "Cotizado", "En pago", "Pendiente de pago",
      "Stock en bodega", "Pausada", "Retiro Pte.", "", null
    ];
    const lineasAdq = lineas.filter(l => ESTADOS_ADQ.includes(l.estado));
    if (lineasAdq.length > 0) {
      const adqAtrasada    = hh_solicitud !== null && hh_solicitud > 24;
      const adqMuyAtrasada = hh_solicitud !== null && hh_solicitud > 48;
    // Cruce morosidad
      const morInfo = porRut[oc.rutCliente] || null;

      const rutOC  = String(oc.rut || "").trim();
const moraOC = moraMap[rutOC] || null;

adquisiciones.push({
  ...oc,
  lineas: lineasAdq,
  totalLineas: lineas.length,
  horasHabiles: Math.round(hh_solicitud || 0),
  esExpress,
  sinEncargado,
  adqAtrasada,
  adqMuyAtrasada,
  diasAtrasoEntrega,
  mora: moraOC,
  alertaAnuladoRecepcionado:
    estados.includes("Anulado") && estados.includes("Recepcionado"),
    montoVenta,        // ← nuevo
        costoTotal,        // ← nuevo
        margenPct,         // ← nuevo
        cantProveedores,   // ← nuevo
        proveedoresUnicos  // ← nuevo (lista de nombres, útil para tooltip)
        });
    }

    // ── BODEGA: líneas compradas pendientes de recepción ─────
    const lineasBodega = lineas.filter(l =>
      mismoEstado_(l.estado, "Comprado") || mismoEstado_(l.estado, "Recepcion Parcial")
    );
    if (lineasBodega.length > 0) {
      const diasComprado = oc.fechaCarga
        ? diasHabiles(new Date(oc.fechaCarga), hoy) : 0;
      const tienePartiales     = estados.some(e => mismoEstado_(e, "Recepcion Parcial"));
      const tieneRecepcionados = estados.includes("Recepcionado");

      bodega.push({
        ...oc,
        lineas: lineasBodega,
        totalLineas: lineas.length,
        lineasRecepcionadas: lineas.filter(l => l.estado === "Recepcionado").length,
        diasComprado,
        tienePartiales,
        tieneRecepcionados,
        diasAtrasoEntrega,
        alertaAnuladoRecepcionado:
          estados.includes("Anulado") && estados.includes("Recepcionado"),
          montoVenta,        // ← nuevo
        costoTotal,        // ← nuevo
        margenPct,         // ← nuevo
        cantProveedores,   // ← nuevo
        proveedoresUnicos  // ← nuevo (lista de nombres, útil para tooltip)
        });
    }

    // ── ALERTAS: solo casos graves ───────────────────────────
    // 1. Vencida >= 3 días hábiles
    // 2. Adquisición >= 48h hábiles sin comprar (y hay líneas sin comprar)
    // 3. Anulado + Recepcionado en misma OC
    const tieneLineasSinComprar = lineas.some(l =>
      ["Cotizado","En pago","Pendiente de pago",""].includes(l.estado)
    );
    const esAlertaGrave =
      diasAtrasoEntrega >= 3 ||
      (hh_solicitud !== null && hh_solicitud >= 48 && tieneLineasSinComprar) ||
      (estados.includes("Anulado") && estados.includes("Recepcionado"));

    if (esAlertaGrave) {
      alertas.push({
        ...oc,
        lineas,
        totalLineas: lineas.length,
        horasHabiles: Math.round(hh_solicitud || 0),
        esExpress,
        sinEncargado,
        adqAtrasada:    hh_solicitud !== null && hh_solicitud > 24,
        adqMuyAtrasada: hh_solicitud !== null && hh_solicitud > 48,
        adqComprada:    !tieneLineasSinComprar,
        diasAtrasoEntrega,
        critico: diasAtrasoEntrega >= 3 ||
                 (estados.includes("Anulado") && estados.includes("Recepcionado")),
        alertaAnuladoRecepcionado:
          estados.includes("Anulado") && estados.includes("Recepcionado"),
          montoVenta,        // ← nuevo
        costoTotal,        // ← nuevo
        margenPct,         // ← nuevo
        cantProveedores,   // ← nuevo
        proveedoresUnicos  // ← nuevo (lista de nombres, útil para tooltip)
        });
    }
  }

  // ── Ordenar ──────────────────────────────────────────────────
  adquisiciones.sort((a, b) => {
    if (a.sinEncargado   !== b.sinEncargado)   return a.sinEncargado   ? -1 : 1;
    if (a.adqMuyAtrasada !== b.adqMuyAtrasada) return a.adqMuyAtrasada ? -1 : 1;
    if (a.adqAtrasada    !== b.adqAtrasada)    return a.adqAtrasada    ? -1 : 1;
    if (a.esExpress      !== b.esExpress)      return a.esExpress      ? -1 : 1;
    return (b.horasHabiles || 0) - (a.horasHabiles || 0);
  });

  bodega.sort((a, b) => (b.diasComprado || 0) - (a.diasComprado || 0));

  alertas.sort((a, b) => {
    if (a.critico !== b.critico) return a.critico ? -1 : 1;
    return (b.diasAtrasoEntrega || 0) - (a.diasAtrasoEntrega || 0);
  });

  despacho.sort((a, b) => (b.diasAtrasoEntrega || 0) - (a.diasAtrasoEntrega || 0));

  // Retiros: primero los que completan OC, luego los listos, luego el resto
  retirosArr.sort((a, b) => {
    if (a.completaOC !== b.completaOC) return a.completaOC ? -1 : 1;
    if (a.listo      !== b.listo)      return a.listo      ? -1 : 1;
    return (b.diasAtrasoEntrega || 0) - (a.diasAtrasoEntrega || 0);
  });

  // Despachos RM: más atrasados primero
  despachosRM.sort((a, b) => (b.diasAtraso || 0) - (a.diasAtraso || 0));

  // ── Métricas ─────────────────────────────────────────────────
  const metricas = {
    adq: {
      total:        adquisiciones.length,
      atrasadas:    adquisiciones.filter(o => o.adqAtrasada).length,
      muyAtrasadas: adquisiciones.filter(o => o.adqMuyAtrasada).length,
      express:      adquisiciones.filter(o => o.esExpress).length,
      sinEncargado: adquisiciones.filter(o => o.sinEncargado).length,
    },
    bodega: {
      total:      bodega.length,
      parciales:  bodega.filter(o => o.tienePartiales).length,
      masAntiguo: bodega.length > 0 ? Math.max(...bodega.map(o => o.diasComprado || 0)) : 0,
      hoy:        bodega.filter(o => (o.diasComprado || 0) === 0).length,
    },
    alertas: {
      vencidas3d:   alertas.filter(o => o.diasAtrasoEntrega >= 3).length,
      adqMas48h:    alertas.filter(o => o.horasHabiles >= 48 && !o.adqComprada).length,
      anulRec:      alertas.filter(o => o.alertaAnuladoRecepcionado).length,
      // Mantener compatibilidad con campos anteriores
      vencidas:     alertas.filter(o => o.diasAtrasoEntrega >= 1).length,
      sinEncargado: alertas.filter(o => o.sinEncargado).length,
      criticas:     alertas.filter(o => o.critico).length,
      adqMasde48:   alertas.filter(o => o.horasHabiles > 48).length,
    },
    despacho: {
      total:     despacho.length,
      atrasadas: despacho.filter(o => o.diasAtrasoEntrega > 0).length,
      urgentes:  despacho.filter(o => o.diasAtrasoEntrega >= 3).length,
    },
  };

  // ── Retiros: estructura para Ruta Logística ──────────────────
  // despachos = OCs RM listas para que Daniel despache
  // retiros   = líneas que Daniel debe ir a buscar a proveedores
  const retiros = {
    retiros:   retirosArr,
    despachos: despachosRM,
    metricas: {
      totalRetiros: retirosArr.length,
      completanOC:  retirosArr.filter(o => o.completaOC).length,
      despachosRM:  despachosRM.length,
      atrasados:    retirosArr.filter(o => o.diasAtrasoEntrega > 0).length,
    },
  };

  return {
    adquisiciones,
    bodega,
    alertas,
    despacho,
    retiros,
    metricas,
    cobranza: filasCobranza,
    generadoEn: new Date().toISOString(),
  };
}

// ============================================================
// SCRIPT DE ALERTAS — verificarCambiosEstado
// Corre cada 15 minutos via trigger
// ============================================================

function verificarCambiosEstado() {
  const { ocMap, hoy } = leerOCs();
  const cache = CacheService.getScriptCache();

  for (const idOC in ocMap) {
    const oc     = ocMap[idOC];
    const lineas = oc.lineas;
    const estados = lineas.map(l => l.estado);

    // Ignorar OCs completamente cerradas
    const todasCerradas = lineas.every(l =>
      PANEL_CONFIG.ESTADOS_CERRADOS.includes(l.estado)
    );
    if (todasCerradas) continue;

    const esExpress    = oc.tipoCompra === "Compra express" || oc.tipoCompra === "Express";
    const sinEncargado = !oc.encargado || oc.encargado.trim() === "";
    const hh_solicitud = oc.fechaCarga
      ? horasHabiles(new Date(oc.fechaCarga), hoy) : null;

    // ── Aviso a JP: líneas en Comprado ──────────────────────
    const compradas = lineas.filter(l => l.estado === "Comprado");
    if (compradas.length > 0) {
      const key = `jp_${idOC}`;
      if (!cache.get(key)) {
        emailJP(idOC, oc, lineas, compradas);
        cache.put(key, "1", 43200);
      }
    }

    // ── Aviso al ejecutivo: OC completa en bodega ───────────
    const pendientesBodega = lineas.filter(l =>
      !["Recepcionado","Despachado","Directo proveedor","Retira cliente","Anulado"].includes(l.estado)
    );
    if (pendientesBodega.length === 0 && lineas.length > 0) {
      const key = `ejec_${idOC}`;
      if (!cache.get(key)) {
        const email = PANEL_CONFIG.EJECUTIVOS[oc.ejecutivo] || null;
        if (email) {
          emailEjecutivo(idOC, oc, lineas, email);
          cache.put(key, "1", 86400);
        }
      }
    }

    // ── Alerta ejecutivo: sin encargado >2 días hábiles ─────
    if (sinEncargado && hh_solicitud !== null && hh_solicitud > 16) {
      const key = `sinenc_${idOC}`;
      if (!cache.get(key)) {
        const email = PANEL_CONFIG.EJECUTIVOS[oc.ejecutivo] || null;
        if (email) emailSinEncargado(idOC, oc, email);
        cache.put(key, "1", 28800);
      }
    }

    // ── Alerta ejecutivo: línea en Comprado >3 días sin cambio
    const compradasAntiguas = lineas.filter(l => {
      if (l.estado !== "Comprado") return false;
      const dh = oc.fechaCarga ? diasHabiles(new Date(oc.fechaCarga), hoy) : 0;
      return dh > 3;
    });
    if (compradasAntiguas.length > 0) {
      const key = `compold_${idOC}`;
      if (!cache.get(key)) {
        const email = PANEL_CONFIG.EJECUTIVOS[oc.ejecutivo] || null;
        if (email) emailCompradoSinActualizar(idOC, oc, compradasAntiguas, email);
        cache.put(key, "1", 28800);
      }
    }

    // ── Alerta: OC vencida sin despachar ────────────────────
    if (oc.entregaOC) {
      const fe   = new Date(oc.entregaOC);
      const dias = diasHabiles(fe, hoy);
      const sinDespachar = lineas.filter(l =>
        !["Despachado","Directo proveedor","Retira cliente","Anulado"].includes(l.estado)
      );
      if (dias > 0 && sinDespachar.length > 0) {
        const key = `atraso_${idOC}`;
        if (!cache.get(key)) {
          emailAtraso(idOC, oc, dias, sinDespachar.length, lineas.length);
          if (dias >= 5) emailAtrasoJulio(idOC, oc, dias);
          cache.put(key, "1", 21600);
        }
      }
    }

    // ── Alerta: Anulado + Recepcionado en misma OC ──────────
    if (estados.includes("Anulado") && estados.includes("Recepcionado")) {
      const key = `anulrec_${idOC}`;
      if (!cache.get(key)) {
        emailAnuladoRecepcionado(idOC, oc, lineas);
        cache.put(key, "1", 86400);
      }
    }

    // ── Alerta: Cotizado >24h sin avanzar ───────────────────
    const cotizadas = lineas.filter(l => l.estado === "Cotizado");
    if (cotizadas.length > 0 && hh_solicitud !== null && hh_solicitud > 24) {
      const key = `cotiz_${idOC}`;
      if (!cache.get(key)) {
        emailCotizadoAtrasado(idOC, oc, cotizadas);
        cache.put(key, "1", 28800);
      }
    }

    // ── Alerta: Pendiente de pago sin movimiento ─────────────
    const pendPago = lineas.filter(l => l.estado === "Pendiente de pago");
    if (pendPago.length > 0 && hh_solicitud !== null && hh_solicitud > 24) {
      const key = `pendpago_${idOC}`;
      if (!cache.get(key)) {
        emailPendientePago(idOC, oc, pendPago);
        cache.put(key, "1", 28800);
      }
    }
  }
}

// ── RESUMEN DIARIO 8:00 AM ───────────────────────────────────
function resumenDiario() {
  const { ocMap, hoy } = leerOCs();

  const atrasadas  = [];
  const express    = [];
  const normales   = [];
  const sinAsignar = [];

  for (const idOC in ocMap) {
    const oc     = ocMap[idOC];
    const lineas = oc.lineas;

    const todasCerradas = lineas.every(l =>
      PANEL_CONFIG.ESTADOS_CERRADOS.includes(l.estado)
    );
    if (todasCerradas) continue;

    const lineasPend = lineas.filter(l =>
      ["Cotizado","En pago","Pendiente de pago"].includes(l.estado)
    );
    if (lineasPend.length === 0) continue;

    const hh     = oc.fechaCarga ? horasHabiles(new Date(oc.fechaCarga), hoy) : 0;
    const sinEnc = !oc.encargado || oc.encargado.trim() === "";
    const esExp  = oc.tipoCompra === "Compra express";

    const item = {
      idOC: oc.idOC,
      cliente: oc.cliente,
      ejecutivo: oc.ejecutivo,
      encargado: oc.encargado,
      horas: Math.round(hh),
      lineasPendientes: lineasPend.length,
      totalLineas: lineas.length,
      esExpress: esExp,
    };

    if (sinEnc)       sinAsignar.push(item);
    else if (hh > 24) atrasadas.push(item);
    else if (esExp)   express.push(item);
    else              normales.push(item);
  }

  atrasadas.sort((a,b) => b.horas - a.horas);
  express.sort((a,b) => b.horas - a.horas);

  const filaTabla = (item, color) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:6px 10px;font-size:12px;font-weight:500">${item.idOC}</td>
      <td style="padding:6px 10px;font-size:12px">${item.cliente}</td>
      <td style="padding:6px 10px;font-size:12px">${item.ejecutivo}</td>
      <td style="padding:6px 10px;font-size:12px;text-align:center">
        <span style="background:${color};color:#fff;padding:1px 6px;border-radius:3px;font-size:11px">
          ${item.horas}h
        </span>
      </td>
      <td style="padding:6px 10px;font-size:12px;text-align:center">${item.lineasPendientes}/${item.totalLineas}</td>
      <td style="padding:6px 10px;font-size:12px">${item.encargado || '—'}</td>
    </tr>`;

  const seccion = (titulo, color, items) => {
    if (items.length === 0) return "";
    return `
      <div style="margin-top:20px">
        <div style="font-size:11px;font-weight:500;color:${color};text-transform:uppercase;
                    letter-spacing:.05em;padding:6px 10px;background:#f8f8f6;border-left:3px solid ${color}">
          ${titulo} (${items.length})
        </div>
        <table style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e0e0d8">
          <thead><tr style="background:#f0efe8">
            <th style="padding:6px 10px;font-size:11px;text-align:left;color:#5f5e5a">OC</th>
            <th style="padding:6px 10px;font-size:11px;text-align:left;color:#5f5e5a">Cliente</th>
            <th style="padding:6px 10px;font-size:11px;text-align:left;color:#5f5e5a">Ejecutivo</th>
            <th style="padding:6px 10px;font-size:11px;text-align:center;color:#5f5e5a">Tiempo</th>
            <th style="padding:6px 10px;font-size:11px;text-align:center;color:#5f5e5a">Líneas</th>
            <th style="padding:6px 10px;font-size:11px;text-align:left;color:#5f5e5a">Encargado</th>
          </tr></thead>
          <tbody>${items.map(i => filaTabla(i, color)).join("")}</tbody>
        </table>
      </div>`;
  };

  const fecha = Utilities.formatDate(hoy, "America/Santiago", "EEEE dd 'de' MMMM yyyy");

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto">
    <div style="background:#185FA5;padding:16px 24px;border-radius:8px 8px 0 0">
      <h2 style="color:#fff;margin:0;font-size:18px">📋 Resumen diario — Adquisiciones</h2>
      <p style="color:#B5D4F4;margin:4px 0 0;font-size:13px">${fecha}</p>
    </div>
    <div style="background:#f8f8f6;padding:20px 24px;border:1px solid #e0e0d8">
      ${seccion("🔴 Sin encargado asignado", "#A32D2D", sinAsignar)}
      ${seccion("🟡 Atrasadas >24h hábiles", "#854F0B", atrasadas)}
      ${seccion("🟢 Express — priorizar", "#0F6E56", express)}
      ${seccion("🔵 Pendientes normales", "#185FA5", normales)}
    </div>
  </div>`;

  MailApp.sendEmail({
    to: [PANEL_CONFIG.EMAIL.ARIEL, PANEL_CONFIG.EMAIL.PEDRO, PANEL_CONFIG.EMAIL.WENDY].join(","),
    subject: `📋 Adquisiciones ${Utilities.formatDate(hoy,"America/Santiago","dd/MM")} — ${sinAsignar.length} sin asignar · ${atrasadas.length} atrasadas`,
    htmlBody: html,
  });
}

// ── EMAILS INDIVIDUALES ──────────────────────────────────────

function emailJP(idOC, oc, todasLineas, compradas) {
  const fecha = oc.entregaOC ? Utilities.formatDate(new Date(oc.entregaOC),"America/Santiago","dd/MM/yyyy") : "Sin fecha";
  const pendientes = todasLineas.filter(l =>
    !["Recepcionado","Despachado","Directo proveedor"].includes(l.estado)
  ).length;

  let filas = compradas.map(l => `<tr style="border-bottom:1px solid #eee">
    <td style="padding:7px 10px;font-size:12px">${l.producto || "—"}</td>
    <td style="padding:7px 10px;font-size:12px;text-align:center">${l.cantidad || "—"}</td>
    <td style="padding:7px 10px;font-size:12px;color:#5f5e5a">${l.proveedor || "—"}</td>
    <td style="padding:7px 10px;font-size:12px;color:#5f5e5a">${l.obsLogistica || "—"}</td>
  </tr>`).join("");

  const html = `<div style="font-family:Arial,sans-serif;max-width:680px">
    <div style="background:#185FA5;padding:14px 20px;border-radius:8px 8px 0 0">
      <h2 style="color:#fff;margin:0;font-size:17px">📦 Pedido listo para recepcionar</h2>
    </div>
    <div style="background:#f8f8f6;padding:18px 20px;border:1px solid #e0e0d8">
      <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
        <tr><td style="font-size:12px;color:#5f5e5a;padding:3px 8px 3px 0">OC</td>
            <td style="font-size:13px;font-weight:600;padding:3px 16px 3px 0">${idOC}</td>
            <td style="font-size:12px;color:#5f5e5a;padding:3px 8px 3px 0">Cliente</td>
            <td style="font-size:13px;padding:3px 0">${oc.cliente}</td></tr>
        <tr><td style="font-size:12px;color:#5f5e5a;padding:3px 8px 3px 0">Ejecutivo</td>
            <td style="font-size:13px;padding:3px 16px 3px 0">${oc.ejecutivo}</td>
            <td style="font-size:12px;color:#5f5e5a;padding:3px 8px 3px 0">Entrega</td>
            <td style="font-size:13px;padding:3px 0">${fecha}</td></tr>
        <tr><td style="font-size:12px;color:#5f5e5a;padding:3px 8px 3px 0">Líneas pendientes</td>
            <td style="font-size:13px;font-weight:600;color:#185FA5;padding:3px 0" colspan="3">${pendientes} de ${todasLineas.length}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0d8;background:#fff">
        <thead><tr style="background:#E6F1FB">
          <th style="padding:6px 10px;font-size:11px;text-align:left;color:#0C447C">Producto</th>
          <th style="padding:6px 10px;font-size:11px;text-align:center;color:#0C447C">Cant.</th>
          <th style="padding:6px 10px;font-size:11px;text-align:left;color:#0C447C">Proveedor</th>
          <th style="padding:6px 10px;font-size:11px;text-align:left;color:#0C447C">Obs. logística</th>
        </tr></thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
  </div>`;

  MailApp.sendEmail({
    to: PANEL_CONFIG.EMAIL.JP,
    subject: `📦 [BODEGA] ${idOC} — ${compradas.length} línea(s) · ${oc.cliente}`,
    htmlBody: html,
  });
}

function emailEjecutivo(idOC, oc, lineas, emailEjec) {
  const fecha = oc.entregaOC ? Utilities.formatDate(new Date(oc.entregaOC),"America/Santiago","dd/MM/yyyy") : "Sin fecha";
  let filas = lineas.map(l => `<tr style="border-bottom:1px solid #eee">
    <td style="padding:7px 10px;font-size:12px">${l.producto || "—"}</td>
    <td style="padding:7px 10px;font-size:12px;text-align:center">${l.cantidad || "—"}</td>
  </tr>`).join("");

  const html = `<div style="font-family:Arial,sans-serif;max-width:680px">
    <div style="background:#0F6E56;padding:14px 20px;border-radius:8px 8px 0 0">
      <h2 style="color:#fff;margin:0;font-size:17px">✅ OC completa en bodega</h2>
    </div>
    <div style="background:#f8f8f6;padding:18px 20px;border:1px solid #e0e0d8">
      <p style="font-size:13px;margin:0 0 14px">Hola <strong>${oc.ejecutivo}</strong>, todos los productos de <strong>${idOC}</strong> están en bodega.</p>
      <div style="background:#E1F5EE;border-left:4px solid #1D9E75;padding:10px 14px;border-radius:4px;margin-top:14px">
        <p style="margin:0;font-size:12px;color:#085041">
          <strong>Acción requerida:</strong> Contacta al cliente, confirma despacho y avisa a administración.
        </p>
      </div>
    </div>
  </div>`;

  MailApp.sendEmail({
    to: [emailEjec, PANEL_CONFIG.EMAIL.WENDY].join(","),
    subject: `✅ [DESPACHO] ${idOC} — ${oc.cliente} · todo en bodega`,
    htmlBody: html,
  });
}

function emailSinEncargado(idOC, oc, emailEjec) {
  MailApp.sendEmail({
    to: emailEjec,
    subject: `⚠️ [SIN GESTIONAR] ${idOC} — ${oc.cliente} lleva más de 2 días sin encargado`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px">
      <p style="font-size:14px">Hola <strong>${oc.ejecutivo}</strong>,</p>
      <p style="font-size:13px">Tu pedido <strong>${idOC}</strong> (${oc.cliente}) lleva más de 2 días hábiles sin encargado.</p>
      <p style="font-size:11px;color:#888;margin-top:16px">SCC Hub Operacional · Alerta automática</p>
    </div>`,
  });
}

function emailCompradoSinActualizar(idOC, oc, lineas, emailEjec) {
  MailApp.sendEmail({
    to: emailEjec,
    subject: `🔍 [SEGUIMIENTO] ${idOC} — ${lineas.length} línea(s) en "Comprado" hace más de 3 días`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px">
      <p style="font-size:14px">Hola <strong>${oc.ejecutivo}</strong>,</p>
      <p style="font-size:13px">El pedido <strong>${idOC}</strong> (${oc.cliente}) tiene ${lineas.length} línea(s) en estado <strong>Comprado</strong> hace más de 3 días sin actualización. Puede que estén en bodega sin recepcionar.</p>
      <p style="font-size:11px;color:#888;margin-top:16px">SCC Hub Operacional · Alerta automática</p>
    </div>`,
  });
}

function emailAtraso(idOC, oc, dias, sinDespachar, totalLineas) {
  const critico = dias >= 3;
  const color   = critico ? "#A32D2D" : "#BA7517";
  MailApp.sendEmail({
    to: PANEL_CONFIG.EMAIL.WENDY,
    subject: `${critico ? "🔴" : "🟡"} [ATRASO] ${idOC} — ${dias}d · ${oc.cliente} · ${oc.ejecutivo}`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;background:${critico?"#FCEBEB":"#FAEEDA"}">
      <h3 style="color:${color};margin:0 0 12px">OC con atraso de ${dias} día(s) hábil(es)</h3>
      <p style="font-size:13px"><strong>OC:</strong> ${idOC} · <strong>Cliente:</strong> ${oc.cliente}</p>
      <p style="font-size:13px"><strong>Ejecutivo:</strong> ${oc.ejecutivo} · <strong>Sin despachar:</strong> ${sinDespachar} de ${totalLineas} líneas</p>
      <p style="font-size:11px;color:#888;margin-top:16px">SCC Hub Operacional · Re-alerta cada 6h</p>
    </div>`,
  });
}

function emailAtrasoJulio(idOC, oc, dias) {
  MailApp.sendEmail({
    to: PANEL_CONFIG.EMAIL.JULIO,
    subject: `🔴 [CRÍTICO] ${idOC} — ${dias}d hábiles vencida · ${oc.cliente}`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;background:#FCEBEB">
      <h3 style="color:#A32D2D;margin:0 0 12px">OC con ${dias} días hábiles de atraso</h3>
      <p style="font-size:13px"><strong>OC:</strong> ${idOC} · <strong>Cliente:</strong> ${oc.cliente}</p>
      <p style="font-size:13px"><strong>Ejecutivo:</strong> ${oc.ejecutivo} · <strong>Empresa:</strong> ${oc.empresa}</p>
      <p style="font-size:11px;color:#888;margin-top:16px">SCC Hub Operacional · Alerta automática</p>
    </div>`,
  });
}

function emailAnuladoRecepcionado(idOC, oc, lineas) {
  const recepcionadas = lineas.filter(l => l.estado === "Recepcionado");
  let filas = recepcionadas.map(l =>
    `<tr><td style="padding:6px 10px;font-size:12px">${l.producto}</td>
         <td style="padding:6px 10px;font-size:12px;text-align:center">${l.cantidad}</td>
         <td style="padding:6px 10px;font-size:12px">${l.proveedor || "—"}</td></tr>`
  ).join("");

  MailApp.sendEmail({
    to: [PANEL_CONFIG.EMAIL.WENDY, PANEL_CONFIG.EMAIL.BEA].join(","),
    subject: `⛔ [DEVOLUCIÓN] ${idOC} — ${oc.cliente} · productos recepcionados con líneas anuladas`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:680px">
      <div style="background:#A32D2D;padding:14px 20px;border-radius:8px 8px 0 0">
        <h2 style="color:#fff;margin:0;font-size:17px">⛔ Devolución pendiente</h2>
      </div>
      <div style="background:#FCEBEB;padding:18px 20px;border:1px solid #e0e0d8">
        <p style="font-size:13px">La OC <strong>${idOC}</strong> (${oc.cliente}) tiene líneas anuladas con productos ya recepcionados.</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e0e0d8;background:#fff;margin-top:12px">
          <thead><tr style="background:#FCEBEB">
            <th style="padding:6px 10px;font-size:11px;text-align:left">Producto</th>
            <th style="padding:6px 10px;font-size:11px;text-align:center">Cant.</th>
            <th style="padding:6px 10px;font-size:11px;text-align:left">Proveedor</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
      </div>
    </div>`,
  });
}

function emailCotizadoAtrasado(idOC, oc, lineas) {
  MailApp.sendEmail({
    to: [PANEL_CONFIG.EMAIL.ARIEL, PANEL_CONFIG.EMAIL.PEDRO, PANEL_CONFIG.EMAIL.WENDY].join(","),
    subject: `⚠️ [COTIZADO ATRASADO] ${idOC} — ${oc.cliente} · más de 24h sin avanzar`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;background:#FAEEDA">
      <h3 style="color:#854F0B;margin:0 0 12px">Líneas en "Cotizado" sin avanzar >24h</h3>
      <p style="font-size:13px"><strong>OC:</strong> ${idOC} · <strong>Cliente:</strong> ${oc.cliente}</p>
      <p style="font-size:13px"><strong>Ejecutivo:</strong> ${oc.ejecutivo} · <strong>Encargado:</strong> ${oc.encargado || "Sin asignar"}</p>
      <p style="font-size:11px;color:#888;margin-top:16px">SCC Hub Operacional · Alerta automática</p>
    </div>`,
  });
}

function emailPendientePago(idOC, oc, lineas) {
  MailApp.sendEmail({
    to: [PANEL_CONFIG.EMAIL.BEA, PANEL_CONFIG.EMAIL.WENDY].join(","),
    subject: `💳 [PAGO PENDIENTE] ${idOC} — ${oc.cliente} · ${lineas.length} línea(s) esperando pago`,
    htmlBody: `<div style="font-family:Arial,sans-serif;max-width:600px;padding:20px;background:#E6F1FB">
      <h3 style="color:#185FA5;margin:0 0 12px">Líneas en "Pendiente de pago" sin movimiento</h3>
      <p style="font-size:13px"><strong>OC:</strong> ${idOC} · <strong>Cliente:</strong> ${oc.cliente}</p>
      <p style="font-size:13px"><strong>Ejecutivo:</strong> ${oc.ejecutivo} · <strong>Encargado:</strong> ${oc.encargado || "—"}</p>
      <p style="font-size:11px;color:#888;margin-top:16px">SCC Hub Operacional · Alerta automática</p>
    </div>`,
  });
}

// ── INSTALACIÓN DE TRIGGERS ──────────────────────────────────
function instalarTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    const fn = t.getHandlerFunction();
    if (fn === "verificarCambiosEstado" || fn === "resumenDiario") {
      ScriptApp.deleteTrigger(t);
    }
  });
  ScriptApp.newTrigger("verificarCambiosEstado")
    .timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger("resumenDiario")
    .timeBased().atHour(8).everyDays(1).inTimezone("America/Santiago").create();
  Logger.log("✅ Triggers instalados");
}

function testManual() {
  const data = obtenerDatos();
  Logger.log("adquisiciones: " + data.adquisiciones.length);
  Logger.log("bodega: "        + data.bodega.length);
  Logger.log("alertas: "       + data.alertas.length);
  Logger.log("despacho: "      + data.despacho.length);
  Logger.log("retiros: "       + data.retiros.retiros.length);
  Logger.log("despachosRM: "   + data.retiros.despachos.length);
}
function debugCobranza() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("BASE DE DATOS COBRANZA");
  if (!sheet) { Logger.log("Hoja no encontrada"); return; }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log("Columnas: " + headers.join(" | "));
  // Ver primera fila de datos
  const fila = sheet.getRange(2, 1, 1, sheet.getLastColumn()).getValues()[0];
  Logger.log("Ejemplo fila: " + fila.join(" | "));
}
function debugRutOC() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("GESTOR DE COMPRAS");
  const rows = sheet.getDataRange().getValues();
  // Ver fila 3 (primera de datos)
  Logger.log("Col 30 (RUT): '" + rows[2][30] + "'");
  Logger.log("Col 29: '" + rows[2][29] + "'");
  Logger.log("Col 31: '" + rows[2][31] + "'");
}
function debugEncontrarRut() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("GESTOR DE COMPRAS");
  const rows = sheet.getDataRange().getValues();
  
  // Buscar columna RUT en headers (filas 1 y 2)
  Logger.log("FILA 1: " + rows[0].join(" | "));
  Logger.log("FILA 2: " + rows[1].join(" | "));
  
  // Buscar en qué columna hay algo parecido a un RUT en las primeras 10 filas de datos
  for (let i = 2; i < 12; i++) {
    rows[i].forEach((val, col) => {
      const str = String(val || "").trim();
      // RUT chileno tiene formato XX.XXX.XXX-X
      if (str.includes("-") && str.includes(".") && str.length > 8) {
        Logger.log("Fila " + (i+1) + " Col " + col + ": '" + str + "'");
      }
    });
  }
}
function debugRutFinal() {
  const { ocMap } = leerOCs();
  const moraMap = obtenerMorosidad();
  Logger.log("RUTs en mora: " + Object.keys(moraMap).length);
  let con = 0;
  for (const id in ocMap) {
    const rut = ocMap[id].rut;
    if (moraMap[rut]) {
      con++;
      Logger.log("OC: " + id + " | RUT: " + rut + " | diasMax: " + moraMap[rut].diasMax + " | saldo: " + moraMap[rut].saldoTotal);
    }
  }
  Logger.log("OCs con mora detectada: " + con);
}
function debugColumnas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName("GESTOR DE COMPRAS");
  
  // Buscar en las primeras 5 filas
  for (let fila = 0; fila < 5; fila++) {
    const row = sheet.getRange(fila + 1, 1, 1, 40).getValues()[0];
    Logger.log("=== FILA " + (fila + 1) + " ===");
    for (let i = 0; i < row.length; i++) {
      if (row[i] !== "") {
        Logger.log("Índice " + i + " = " + row[i]);
      }
    }
  }
}
function testMetricasOC() {
  const datos = obtenerDatos();
  const muestra = datos.adquisiciones[0] || datos.bodega[0];
  if (!muestra) {
    Logger.log("No hay OCs para probar");
    return;
  }
  Logger.log("Muestra de OC:");
  Logger.log("idOC: " + muestra.idOC);
  Logger.log("cliente: " + muestra.cliente);
  Logger.log("montoVenta: " + muestra.montoVenta);
  Logger.log("costoTotal: " + muestra.costoTotal);
  Logger.log("margenPct: " + muestra.margenPct);
  Logger.log("cantProveedores: " + muestra.cantProveedores);
  Logger.log("proveedoresUnicos: " + JSON.stringify(muestra.proveedoresUnicos));
}
// ============================================================
// MÓDULO RECEPCIÓN EN BODEGA (JP) — v1.0
// Agregado: buscarPorProveedor / registrarRecepcion
//
// Reglas de diseño (acordadas con Julio):
//   - ESTADO (S) es POR LÍNEA. registrarRecepcion escribe SOLO la fila
//     de la línea recibida. Nunca toca otras filas de la misma OC:
//     pueden tener estados de adquisiciones (Retiro Pte., Directo
//     proveedor, Anulado) y pisarlos corrompería datos.
//   - El estado consolidado de la OC NO se escribe nunca. Se CALCULA
//     al leer y viaja como campo informativo para el frontend.
//   - AB (OBS_LOGISTICA) = rack. Era SOLO LECTURA; desde v1.1 JP puede
//     editarla al confirmar. Alimenta la Ruta Logística de Daniel, que
//     parsea "Proveedor - Dirección - Tel - Horario", así que el frontend
//     manda el campo PRECARGADO con lo que ya hay: JP edita, no pisa a
//     ciegas. El riesgo además se cierra solo: la ruta solo mira líneas
//     en estado "Retiro", y al confirmar la línea pasa a Recepcionado o
//     Recepcion Parcial, o sea que ya salió de la ruta de Daniel.
//     Por si acaso, el valor anterior queda en el Logger.
//
// Cambios v1.1:
//   - "Retiro" entra a los estados recepcionables: Daniel retira durante
//     el día y JP cierra esas líneas cuando llegan a la oficina.
//   - registrarRecepcion acepta dos comentarios opcionales y los escribe
//     en AB (observación logística) y AD (factura recibida folio).
// ============================================================

// ⚠️ VERIFICAR CONTRA EL DROPDOWN DEL SHEET ANTES DE USAR EN PRODUCCIÓN.
// Estos son los strings que se ESCRIBEN en la columna S. No pude leer el
// Sheet desde el entorno de desarrollo (cuenta distinta), así que estos
// valores vienen del código existente + acuerdo con Julio, NO de la fuente.
// Si el dropdown difiere, corregir SOLO aquí: el resto del módulo compara
// normalizado (minúsculas sin tildes), así que tolera diferencias de
// mayúsculas y acentos sin más cambios.
const RECEPCION_ESTADOS = {
  COMPRADO:     "Comprado",
  PARCIAL:      "Recepcion Parcial",
  RECEPCIONADO: "Recepcionado",
  RETIRO:       "Retiro",
};

// Estados de línea que el módulo de bodega muestra y puede recepcionar.
// Incluye PARCIAL y RECEPCIONADO a propósito: una línea ya recepcionada
// no se oculta (se marca completa), y una parcial debe seguir visible
// para que JP pueda terminar de recibirla.
// Incluye RETIRO porque esa mercadería también termina en el mostrador de
// JP: Daniel la retira durante el día y al llegar a la oficina hay que
// recepcionarla como cualquier otra. NO incluye "Retiro Pte.", que sigue
// siendo trabajo de adquisiciones (ver ESTADOS_ADQ): esa mercadería todavía
// no salió de donde el proveedor, así que JP no puede tenerla al frente.
const RECEPCION_ESTADOS_VISIBLES = [
  RECEPCION_ESTADOS.COMPRADO,
  RECEPCION_ESTADOS.PARCIAL,
  RECEPCION_ESTADOS.RECEPCIONADO,
  RECEPCION_ESTADOS.RETIRO,
];

// ── Caché ────────────────────────────────────────────────────
// Medido en la hoja real: getValues() cuesta ~8,4 s SIN IMPORTAR el
// tamaño (1 columna = 8.426 ms, 36 columnas = 8.505 ms). El costo es por
// LLAMADA, no por volumen: la hoja recalcula fórmulas antes de devolver.
// Por eso lo único que sirve es no llamar. De los 8.915 ms de una
// búsqueda, 8.505 son la lectura y 410 ms toda la lógica.
// v2: el dataset suma folioFactura. La clave sube de versión para no
// servir líneas viejas sin ese campo durante los 120 s de TTL.
const RECEPCION_CACHE_KEY    = "recep_ds_v2";
const RECEPCION_CACHE_TTL    = 120;     // segundos de desfase tolerado
const RECEPCION_CACHE_CHUNK  = 90000;   // bytes por trozo (tope duro: 100 KB)
const RECEPCION_CACHE_MAX    = 25;      // trozos máximos antes de rendirse
// Las fichas de Mercado Libre traen 2.000+ caracteres. Se recortan para
// que el dataset entre en caché y para no inflar la respuesta.
const RECEPCION_PROD_MAX     = 400;

// Caché del panel. Medido: obtenerDatos() son 13.404 ms, de los cuales
// 10.704 son leerOCs() sobre GESTOR DE COMPRAS (9556x36). Mismo problema
// que en recepción: el costo es por llamada, así que la salida es no llamar.
// TTL de 5 min: el frontend ya se autorefresca cada 10, o sea que el dato
// nunca fue más fresco que eso.
const PANEL_CACHE_KEY = "panel_ds_v1";
// TTL 15 min contra un trigger que refresca cada 10: el solape evita que
// quede un hueco frío entre ejecuciones. Si el trigger se cae, el dato
// puede llegar a 15 min de antigüedad y después se relee solo.
const PANEL_CACHE_TTL = 900;
const PANEL_CACHE_MINUTOS_TRIGGER = 10;

// Primera fila de datos del sheet (1-based). El GESTOR tiene 2 filas de
// encabezado — por eso leerOCs() arranca en el índice 2 del array.
const RECEPCION_PRIMERA_FILA = 3;

// Ventana temporal del módulo de bodega, sobre FECHA_CARGA (col G).
// NO hereda DIAS_HISTORICO (180d) de leerOCs(): eso son ~6 meses y JP
// terminaría viendo OCs viejas que nadie va a recepcionar.
// 90 días = mismo corte que detectarRetiros() en Retiros.gs.
// Las filas SIN fecha de carga NO se descartan (mismo criterio que
// leerOCs): ante un dato faltante se prefiere mostrar de más que ocultar.
const RECEPCION_DIAS_HISTORICO = 90;

// ── Normalizador compartido ──────────────────────────────────
// Minúsculas, sin tildes, sin espacios sobrantes. Se usa tanto para la
// búsqueda por proveedor como para TODA comparación de estados.
function normalizar_(txt) {
  return String(txt === null || txt === undefined ? "" : txt)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")   // colapsa espacios/tabs/saltos múltiples a uno
    .trim();
}

// ── Compara dos estados ignorando mayúsculas y tildes ────────
function mismoEstado_(a, b) {
  return normalizar_(a) === normalizar_(b);
}

// ── ¿El estado está en la lista? (normalizado) ───────────────
function estadoEnLista_(estado, lista) {
  const n = normalizar_(estado);
  return lista.some(function (x) { return normalizar_(x) === n; });
}

// ── Caché troceado (CacheService tope 100 KB por clave) ──────
// Genérico: lo usan tanto recepción como el panel. Si el dato no cabe,
// simplemente no se cachea y se degrada al comportamiento anterior
// (lento pero correcto). Nunca devuelve datos a medias.
function cacheGuardarTroceado_(prefijo, valor, ttl) {
  try {
    const txt = JSON.stringify(valor);
    const n   = Math.ceil(txt.length / RECEPCION_CACHE_CHUNK);
    if (n > RECEPCION_CACHE_MAX) {
      Logger.log("[cache] " + prefijo + " muy grande (" + txt.length + " bytes), no se cachea");
      return false;
    }
    const obj = {};
    for (let i = 0; i < n; i++) {
      obj[prefijo + "_" + i] = txt.substr(i * RECEPCION_CACHE_CHUNK, RECEPCION_CACHE_CHUNK);
    }
    obj[prefijo + "_n"] = String(n);
    CacheService.getScriptCache().putAll(obj, ttl);
    return true;
  } catch (err) {
    Logger.log("[cache] no se pudo guardar " + prefijo + ": " + err.message);
    return false;
  }
}

function cacheLeerTroceado_(prefijo) {
  try {
    const cache = CacheService.getScriptCache();
    const n = parseInt(cache.get(prefijo + "_n"), 10);
    if (!n) return null;
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(prefijo + "_" + i);
    const got = cache.getAll(keys);
    let txt = "";
    for (let i = 0; i < n; i++) {
      const parte = got[prefijo + "_" + i];
      // Un trozo vencido invalida el conjunto: mejor releer que devolver
      // un JSON truncado.
      if (parte === null || parte === undefined) return null;
      txt += parte;
    }
    return JSON.parse(txt);
  } catch (err) {
    return null;
  }
}

// Envoltorios de recepción sobre los helpers genéricos.
function recepCacheGuardar_(ocMap) {
  return cacheGuardarTroceado_(RECEPCION_CACHE_KEY, ocMap, RECEPCION_CACHE_TTL);
}

function recepCacheLeer_() {
  return cacheLeerTroceado_(RECEPCION_CACHE_KEY);
}

// ── Lector dedicado del sheet para recepción ─────────────────
// NO reusa leerOCs(): ese filtra por DIAS_HISTORICO (180d) y descarta el
// número de fila, que aquí es imprescindible para poder escribir.
// Devuelve { ocMap, sheet }. Cada línea trae filaSheet (1-based, real).
function leerOCsParaRecepcion_(forzar) {
  if (!forzar) {
    const cacheado = recepCacheLeer_();
    if (cacheado) return { ocMap: cacheado, sheet: null, desdeCache: true };
  }

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(PANEL_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Hoja no encontrada: " + PANEL_CONFIG.SHEET_NAME);

  const rows  = sheet.getDataRange().getValues();
  const ocMap = {};

  const corte = new Date();
  corte.setDate(corte.getDate() - RECEPCION_DIAS_HISTORICO);

  for (let i = 2; i < rows.length; i++) {
    const r    = rows[i];
    const idOC = String(r[PANEL_CONFIG.COL.ID_OC] || "").trim();
    if (!idOC) continue;

    // Fuera de ventana → no es trabajo de bodega hoy.
    const fechaCarga = r[PANEL_CONFIG.COL.FECHA_CARGA];
    if (fechaCarga && new Date(fechaCarga) < corte) continue;

    if (!ocMap[idOC]) {
      ocMap[idOC] = {
        idOC:      idOC,
        empresa:   String(r[PANEL_CONFIG.COL.EMPRESA]      || "").trim(),
        cliente:   String(r[PANEL_CONFIG.COL.CLIENTE]      || "").trim(),
        dir:       String(r[PANEL_CONFIG.COL.DIR_DESPACHO] || "").trim(),
        encargado: String(r[PANEL_CONFIG.COL.ENCARGADO]    || "").trim(),
        fechaCarga: fechaCarga ? new Date(fechaCarga).toISOString() : null,
        lineas:    [],
      };
    }

    const estadoLinea = String(r[PANEL_CONFIG.COL.ESTADO] || "").trim();
    const esperada    = Number(r[PANEL_CONFIG.COL.CANTIDAD]          || 0);
    const brutoAJ     = Number(r[PANEL_CONFIG.COL.CANT_RECEPCIONADA] || 0);

    // Completitud derivada del ESTADO, no solo de AJ.
    // Las líneas que JP marcó "Recepcionado" a mano ANTES de que existiera
    // la columna AJ tienen AJ=0. Sin esta regla aparecerían como 100%
    // pendientes y JP podría recibirlas dos veces.
    // El estado manda: si dice Recepcionado, está completa.
    const yaCerradaPorEstado = mismoEstado_(estadoLinea, RECEPCION_ESTADOS.RECEPCIONADO);
    const recepcionada = yaCerradaPorEstado ? Math.max(brutoAJ, esperada) : brutoAJ;

    ocMap[idOC].lineas.push({
      filaSheet:    i + 1,   // 1-based, fila real del Sheet
      producto:     recortarProd_(r[PANEL_CONFIG.COL.NOMBRE_PROD]),
      proveedor:    String(r[PANEL_CONFIG.COL.PROVEEDOR]   || "").trim(),
      estado:       estadoLinea,
      // AB = rack / dirección de retiro. JP puede editarla al confirmar,
      // y llega precargada al frontend justamente para que no la pise.
      rack:         String(r[PANEL_CONFIG.COL.OBS_LOGISTICA] || "").trim(),
      // AD = folio de la factura del proveedor. Se manda para que el campo
      // aparezca con lo ya anotado y JP no lo escriba dos veces.
      folioFactura: String(r[PANEL_CONFIG.COL.FACTURA_FOLIO] || "").trim(),
      esperada:     esperada,
      recepcionada: recepcionada,
      saldo:        Math.max(esperada - recepcionada, 0),
      completa:     recepcionada >= esperada && esperada > 0,
    });
  }

  recepCacheGuardar_(ocMap);
  return { ocMap: ocMap, sheet: sheet, desdeCache: false };
}

// Recorta la ficha larga de Mercado Libre conservando el nombre del
// producto, que siempre va al principio.
function recortarProd_(txt) {
  const s = String(txt || "").trim();
  if (s.length <= RECEPCION_PROD_MAX) return s;
  return s.slice(0, RECEPCION_PROD_MAX).trim() + "…";
}

// ── Estado consolidado de la OC (CALCULADO, nunca se escribe) ─
// Se evalúa solo sobre líneas "vivas": las cerradas por adquisiciones
// (Anulado, Devuelto, Directo proveedor, Retira cliente, Despachado)
// no cuentan, porque nunca van a pasar por bodega.
function calcularEstadoOC_(lineas) {
  const vivas = lineas.filter(function (l) {
    return !estadoEnLista_(l.estado, PANEL_CONFIG.ESTADOS_CERRADOS);
  });

  if (vivas.length === 0) return null;                 // nada que recepcionar
  if (vivas.every(function (l) { return l.completa; })) {
    return RECEPCION_ESTADOS.RECEPCIONADO;
  }
  if (vivas.some(function (l) { return l.recepcionada > 0; })) {
    return RECEPCION_ESTADOS.PARCIAL;
  }
  return null;                                          // ninguna recibida aún
}

// ── FUNCIÓN 1: buscar OCs por proveedor ──────────────────────
// texto: búsqueda parcial, insensible a mayúsculas y tildes.
// Devuelve solo OCs con al menos una línea recepcionable de ese
// proveedor, y dentro de cada OC SOLO las líneas de ese proveedor.
function buscarPorProveedor(texto) {
  const q = normalizar_(texto);
  if (!q) return { ok: true, resultados: [], total: 0 };

  return buscarLineas_(function (l) {
    return normalizar_(l.proveedor).indexOf(q) !== -1;
  });
}

// ── Búsqueda de líneas SIN proveedor asignado (columna Z vacía) ──
// Estas líneas son inalcanzables desde buscarPorProveedor(): su proveedor
// normalizado es "" y nunca contiene un texto de búsqueda no vacío.
// Sin esta función quedarían invisibles para JP de forma permanente.
// El frontend la expone como filtro aparte ("Sin proveedor asignado"),
// NO como un texto que JP pueda teclear: un término mágico podría
// colisionar con el nombre real de un proveedor.
function buscarSinProveedor() {
  return buscarLineas_(function (l) {
    return normalizar_(l.proveedor) === "";
  });
}

// ── Núcleo compartido de búsqueda (SOLO LECTURA) ─────────────
// filtroLinea: predicado que decide si una línea entra por proveedor.
// El resto de las reglas (estado recepcionable, saldo pendiente, forma
// del resultado) es idéntico para todas las búsquedas y vive solo aquí.
function buscarLineas_(filtroLinea) {
  const { ocMap } = leerOCsParaRecepcion_();
  const resultados = [];

  for (const idOC in ocMap) {
    const oc = ocMap[idOC];

    const lineasProv = oc.lineas.filter(function (l) {
      return filtroLinea(l)
          && estadoEnLista_(l.estado, RECEPCION_ESTADOS_VISIBLES);
    });

    if (lineasProv.length === 0) continue;

    // Solo OCs que aún tengan algo pendiente de recibir de este proveedor.
    const pendientes = lineasProv.filter(function (l) { return l.saldo > 0; });
    if (pendientes.length === 0) continue;

    resultados.push({
      idOC:       oc.idOC,
      empresa:    oc.empresa,
      cliente:    oc.cliente,
      encargado:  oc.encargado,
      // Informativo, CALCULADO sobre la OC completa (no solo las líneas
      // del proveedor buscado). No se escribe nunca en el Sheet.
      estadoOC:   calcularEstadoOC_(oc.lineas),
      totalLineasOC: oc.lineas.length,
      lineas:     lineasProv,
      saldoTotal: lineasProv.reduce(function (s, l) { return s + l.saldo; }, 0),
    });
  }

  resultados.sort(function (a, b) { return a.idOC.localeCompare(b.idOC); });
  return { ok: true, resultados: resultados, total: resultados.length };
}

// ── FUNCIÓN 2: registrar recepción de UNA línea ──────────────
// filaSheet: número de fila real del Sheet (1-based), tal como lo
//            devuelve buscarPorProveedor().
// cantidadRecibida: cantidad a SUMAR a lo ya recepcionado en AJ.
// obsLogistica: OPCIONAL. Texto para AB. Si viene vacío o no viene, la
//               celda NO se toca: un campo en blanco jamás borra lo escrito.
// folioFactura: OPCIONAL. Texto para AD, mismas reglas.
//
// Escribe hasta 4 celdas, todas en filaSheet: AJ y S siempre, AB y AD solo
// si llegan con texto. Nunca toca otra fila.
function registrarRecepcion(filaSheet, cantidadRecibida, obsLogistica, folioFactura) {
  const fila = Number(filaSheet);
  const cant = Number(cantidadRecibida);

  // Los comentarios son opcionales: se normaliza a texto y se ignora el vacío.
  const obsNueva   = String(obsLogistica === null || obsLogistica === undefined ? "" : obsLogistica).trim();
  const folioNuevo = String(folioFactura === null || folioFactura === undefined ? "" : folioFactura).trim();

  if (!fila || fila < RECEPCION_PRIMERA_FILA) {
    throw new Error("Fila inválida: " + filaSheet);
  }
  if (!isFinite(cant) || cant <= 0) {
    throw new Error("La cantidad recibida debe ser mayor que 0. Recibido: " + cantidadRecibida);
  }

  // Ariel, Pedro y JP editan el Sheet en paralelo → lock obligatorio.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error("El sistema está ocupado, intenta de nuevo en unos segundos.");
  }

  try {
    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(PANEL_CONFIG.SHEET_NAME);
    if (!sheet) throw new Error("Hoja no encontrada: " + PANEL_CONFIG.SHEET_NAME);
    if (fila > sheet.getLastRow()) throw new Error("La fila " + fila + " no existe.");

    const ancho = Math.max(
      PANEL_CONFIG.COL.CANT_RECEPCIONADA,
      PANEL_CONFIG.COL.OBS_LOGISTICA,
      PANEL_CONFIG.COL.FACTURA_FOLIO
    ) + 1;

    // RELECTURA DENTRO DEL LOCK: la suma nunca se basa en datos rancios.
    const r = sheet.getRange(fila, 1, 1, ancho).getValues()[0];

    const idOC     = String(r[PANEL_CONFIG.COL.ID_OC]       || "").trim();
    const producto = String(r[PANEL_CONFIG.COL.NOMBRE_PROD] || "").trim();
    const estadoAc = String(r[PANEL_CONFIG.COL.ESTADO]      || "").trim();
    const esperada = Number(r[PANEL_CONFIG.COL.CANTIDAD]          || 0);
    const brutoAJ  = Number(r[PANEL_CONFIG.COL.CANT_RECEPCIONADA] || 0);

    // Misma regla que el lector: el ESTADO manda sobre AJ. Protege contra
    // recibir dos veces una línea marcada "Recepcionado" a mano con AJ=0.
    const yaCerradaPorEstado = mismoEstado_(estadoAc, RECEPCION_ESTADOS.RECEPCIONADO);
    const yaRecep = yaCerradaPorEstado ? Math.max(brutoAJ, esperada) : brutoAJ;

    if (!idOC) throw new Error("La fila " + fila + " no tiene OC.");
    if (esperada <= 0) {
      throw new Error("La línea no tiene cantidad esperada válida (fila " + fila + ").");
    }
    if (!estadoEnLista_(estadoAc, RECEPCION_ESTADOS_VISIBLES)) {
      throw new Error(
        'No se puede recepcionar una línea en estado "' + estadoAc + '". ' +
        "Solo: " + RECEPCION_ESTADOS_VISIBLES.join(", ") + "."
      );
    }

    if (yaRecep >= esperada) {
      throw new Error(
        "Esta línea ya está recepcionada completa (" + yaRecep + "/" + esperada + "). " +
        "Si el proveedor trajo más, corrígelo en el Sheet."
      );
    }

    const nuevoTotal = yaRecep + cant;
    if (nuevoTotal > esperada) {
      throw new Error(
        "Excede lo esperado: ya hay " + yaRecep + " de " + esperada +
        ", intentas sumar " + cant + " (total " + nuevoTotal + "). " +
        "Máximo que puedes recibir: " + (esperada - yaRecep) + "."
      );
    }

    const nuevoEstadoLinea = nuevoTotal >= esperada
      ? RECEPCION_ESTADOS.RECEPCIONADO
      : RECEPCION_ESTADOS.PARCIAL;

    // Escrituras. Solo esta fila, nunca otra.
    sheet.getRange(fila, PANEL_CONFIG.COL.CANT_RECEPCIONADA + 1).setValue(nuevoTotal);
    sheet.getRange(fila, PANEL_CONFIG.COL.ESTADO + 1).setValue(nuevoEstadoLinea);

    // AB: el valor previo queda en el Logger. Es la única forma de recuperar
    // una dirección de retiro si alguien la borra sin querer desde el hub.
    const obsPrevia = String(r[PANEL_CONFIG.COL.OBS_LOGISTICA] || "").trim();
    if (obsNueva && obsNueva !== obsPrevia) {
      sheet.getRange(fila, PANEL_CONFIG.COL.OBS_LOGISTICA + 1).setValue(obsNueva);
      Logger.log(
        "[RECEPCION][AB] fila " + fila + " · antes: " + JSON.stringify(obsPrevia) +
        " · ahora: " + JSON.stringify(obsNueva)
      );
    }

    // AD: texto plano a propósito. Un folio con ceros a la izquierda o con
    // letra ("F-0048") se guardaría mal si el Sheet lo interpreta como número.
    const folioPrevio = String(r[PANEL_CONFIG.COL.FACTURA_FOLIO] || "").trim();
    if (folioNuevo && folioNuevo !== folioPrevio) {
      sheet.getRange(fila, PANEL_CONFIG.COL.FACTURA_FOLIO + 1)
        .setNumberFormat("@")
        .setValue(folioNuevo);
    }

    SpreadsheetApp.flush();

    const obsFinal   = obsNueva   || obsPrevia;
    const folioFinal = folioNuevo || folioPrevio;

    // Estado consolidado: se CALCULA para devolver, no se escribe.
    // El caché se PARCHEA con lo recién escrito en vez de invalidarlo:
    // invalidar obligaría a la próxima búsqueda a pagar los ~8,5 s de
    // relectura, y releer acá los pagaría en cada confirmación.
    let res = leerOCsParaRecepcion_();
    let oc  = res.ocMap[idOC];
    let linea = oc && oc.lineas.filter(function (l) { return l.filaSheet === fila; })[0];

    if (!linea && res.desdeCache) {
      // La fila no está en el caché (quedó de antes de que existiera).
      // Releer de verdad antes que devolver un estado inventado.
      res   = leerOCsParaRecepcion_(true);
      oc    = res.ocMap[idOC];
      linea = oc && oc.lineas.filter(function (l) { return l.filaSheet === fila; })[0];
    }

    if (linea) {
      linea.recepcionada = nuevoTotal;
      linea.saldo        = Math.max(esperada - nuevoTotal, 0);
      linea.estado       = nuevoEstadoLinea;
      linea.completa     = nuevoTotal >= esperada && esperada > 0;
      linea.rack         = obsFinal;
      linea.folioFactura = folioFinal;
      if (res.desdeCache) recepCacheGuardar_(res.ocMap);
    }

    const estadoOC = oc ? calcularEstadoOC_(oc.lineas) : null;

    Logger.log(
      "[RECEPCION] fila " + fila + " · " + idOC + " · " + producto +
      " · +" + cant + " → " + nuevoTotal + "/" + esperada +
      " · línea: " + nuevoEstadoLinea + " · OC: " + estadoOC +
      (folioNuevo ? " · factura: " + folioNuevo : "")
    );

    return {
      ok:            true,
      idOC:          idOC,
      producto:      producto,
      filaSheet:     fila,
      esperada:      esperada,
      recepcionada:  nuevoTotal,
      saldo:         Math.max(esperada - nuevoTotal, 0),
      estadoLinea:   nuevoEstadoLinea,
      estadoOC:      estadoOC,   // informativo — NO escrito en el Sheet
      // Se devuelve lo que quedó en la celda, no lo que se pidió: el
      // frontend pinta esto y así la pantalla no miente si no se escribió.
      obsLogistica:  obsFinal,
      folioFactura:  folioFinal,
    };
  } finally {
    lock.releaseLock();
  }
}

// ── Test manual (ejecutar desde el editor web de Apps Script) ─
// SOLO LECTURA por defecto. Para probar la escritura hay que editar
// PROBAR_ESCRITURA y poner una fila real de prueba.
function testManual_recepcion() {
  // Dejar VACÍO ("") para que liste los 10 proveedores con más pendientes
  // y elijas uno real. Luego pegar ese nombre aquí y volver a correr.
  const PROVEEDOR_PRUEBA  = "mercado libre";
  const PROBAR_ESCRITURA  = false;      // ← true SOLO con fila de prueba
  const FILA_PRUEBA       = 0;          // ← fila real del Sheet
  const CANTIDAD_PRUEBA   = 1;

  Logger.log("═══ TEST normalizar_() ═══");
  [
    ["  DiMerc  S.A. ", "dimerc s.a."],
    ["Comercial   Los\tAndes", "comercial los andes"],
    ["Recepción Parcial", "recepcion parcial"],
    ["RECEPCION PARCIAL", "recepcion parcial"],
    ["Ferretería Ñuñoa", "ferreteria nunoa"],
    [null, ""],
  ].forEach(function (par) {
    const got = normalizar_(par[0]);
    Logger.log((got === par[1] ? "OK  " : "FALLA ") + JSON.stringify(par[0]) + " → " + JSON.stringify(got));
  });

  Logger.log("");
  Logger.log("═══ TEST comparación de estados (case/tilde insensible) ═══");
  Logger.log("Recepcion parcial vs Recepcion Parcial: " +
    mismoEstado_("Recepcion parcial", "Recepcion Parcial"));   // esperado true
  Logger.log("Recepción Parcial vs Recepcion Parcial: " +
    mismoEstado_("Recepción Parcial", "Recepcion Parcial"));   // esperado true
  Logger.log("Recepcionado vs Recepcion Parcial: " +
    mismoEstado_("Recepcionado", "Recepcion Parcial"));        // esperado false

  Logger.log("");
  if (!normalizar_(PROVEEDOR_PRUEBA)) {
    Logger.log("═══ PROVEEDOR_PRUEBA vacío → top 10 con pendientes ═══");
    const top = topProveedoresPendientes(10);
    if (top.length === 0) {
      Logger.log("Sin proveedores con líneas pendientes en la ventana de " +
                 RECEPCION_DIAS_HISTORICO + " días.");
      Logger.log("Revisa que la columna AJ exista y que haya líneas en: " +
                 RECEPCION_ESTADOS_VISIBLES.join(", "));
    } else {
      top.forEach(function (p, i) {
        Logger.log((i + 1) + ". " + p.proveedor +
                   "  —  " + p.lineas + " línea(s) pendiente(s)" +
                   " · " + p.ocs + " OC(s)" +
                   " · saldo total " + p.saldo);
      });
      Logger.log("");
      Logger.log("👉 Copia uno y ponlo en PROVEEDOR_PRUEBA, arriba en esta función.");
    }
    Logger.log("");
    Logger.log("(Se omiten los tests de buscarPorProveedor hasta que elijas uno.)");
    return;
  }

  Logger.log("═══ TEST buscarPorProveedor('" + PROVEEDOR_PRUEBA + "') ═══");
  const res = buscarPorProveedor(PROVEEDOR_PRUEBA);
  Logger.log("OCs encontradas: " + res.total);
  res.resultados.slice(0, 5).forEach(function (oc) {
    Logger.log("── " + oc.idOC + " · " + oc.cliente +
               " · estadoOC(calc): " + oc.estadoOC +
               " · saldo total: " + oc.saldoTotal);
    oc.lineas.forEach(function (l) {
      Logger.log("     fila " + l.filaSheet + " | " + l.producto +
                 " | " + l.recepcionada + "/" + l.esperada +
                 " | saldo " + l.saldo +
                 " | rack: " + (l.rack || "—") +
                 " | " + l.estado +
                 (l.completa ? "  ✅ COMPLETA" : ""));
    });
  });
  if (res.total === 0) {
    Logger.log("Sin resultados. Revisa que PROVEEDOR_PRUEBA exista en la columna Z");
    Logger.log("y que sus líneas estén en: " + RECEPCION_ESTADOS_VISIBLES.join(", "));
  }

  Logger.log("");
  Logger.log("═══ TEST búsqueda vacía (debe devolver 0, no reventar) ═══");
  Logger.log("total: " + buscarPorProveedor("").total);
  Logger.log("total: " + buscarPorProveedor("   ").total);

  Logger.log("");
  Logger.log("═══ TEST validaciones de registrarRecepcion() ═══");
  [
    [1,   1, "fila de encabezado → debe fallar"],
    [999999, 1, "fila inexistente → debe fallar"],
    [RECEPCION_PRIMERA_FILA, 0,  "cantidad 0 → debe fallar"],
    [RECEPCION_PRIMERA_FILA, -5, "cantidad negativa → debe fallar"],
  ].forEach(function (c) {
    try {
      registrarRecepcion(c[0], c[1]);
      Logger.log("FALLA (no lanzó error): " + c[2]);
    } catch (err) {
      Logger.log("OK  " + c[2] + " → " + err.message);
    }
  });

  if (!PROBAR_ESCRITURA || !FILA_PRUEBA) {
    Logger.log("");
    Logger.log("⏭️  Escritura NO probada (PROBAR_ESCRITURA=false).");
    Logger.log("    Para probarla: poner FILA_PRUEBA con una fila real y PROBAR_ESCRITURA=true.");
    return;
  }

  Logger.log("");
  Logger.log("═══ TEST registrarRecepcion() — ESCRITURA REAL ═══");
  Logger.log("⚠️  Esto MODIFICA el Sheet en la fila " + FILA_PRUEBA);
  try {
    const out = registrarRecepcion(FILA_PRUEBA, CANTIDAD_PRUEBA);
    Logger.log(JSON.stringify(out, null, 2));
    Logger.log("Sobre-recepción (debe fallar):");
    try {
      registrarRecepcion(FILA_PRUEBA, 999999);
      Logger.log("FALLA: aceptó más de lo esperado");
    } catch (err) {
      Logger.log("OK  → " + err.message);
    }
  } catch (err) {
    Logger.log("Error: " + err.message);
  }
}

// ── Diagnóstico: parciales históricas (SOLO LECTURA) ─────────
// No escribe nada. Solo Logger.log.
// Cuenta las líneas en "Recepcion Parcial" dentro de la ventana de 90 días,
// para decidir si hay que hacer algo con ellas antes de arrancar el módulo.
function contarParcialesHistoricas() {
  const { ocMap } = leerOCsParaRecepcion_();

  const parciales = [];
  const ocsDistintas = {};

  for (const idOC in ocMap) {
    const oc = ocMap[idOC];
    oc.lineas.forEach(function (l) {
      if (!mismoEstado_(l.estado, RECEPCION_ESTADOS.PARCIAL)) return;
      parciales.push({
        idOC:         idOC,
        producto:     l.producto,
        proveedor:    l.proveedor,
        fechaCarga:   oc.fechaCarga,
        filaSheet:    l.filaSheet,
        esperada:     l.esperada,
        recepcionada: l.recepcionada,
      });
      ocsDistintas[idOC] = true;
    });
  }

  Logger.log("═══ PARCIALES HISTÓRICAS (ventana " + RECEPCION_DIAS_HISTORICO + " días) ═══");
  Logger.log("Líneas en \"" + RECEPCION_ESTADOS.PARCIAL + "\": " + parciales.length);
  Logger.log("OCs distintas involucradas: " + Object.keys(ocsDistintas).length);

  // Sin fecha de carga → al final del orden (no se pueden comparar).
  parciales.sort(function (a, b) {
    if (!a.fechaCarga) return 1;
    if (!b.fechaCarga) return -1;
    return new Date(a.fechaCarga) - new Date(b.fechaCarga);
  });

  const sinFecha = parciales.filter(function (p) { return !p.fechaCarga; }).length;
  if (sinFecha > 0) Logger.log("(" + sinFecha + " sin fecha de carga — van al final)");

  Logger.log("");
  Logger.log("── Las 10 más antiguas ──");
  if (parciales.length === 0) {
    Logger.log("Ninguna. No hay nada que decidir. 🎉");
  } else {
    parciales.slice(0, 10).forEach(function (p, i) {
      const f = p.fechaCarga
        ? Utilities.formatDate(new Date(p.fechaCarga), Session.getScriptTimeZone(), "dd-MM-yyyy")
        : "sin fecha";
      Logger.log(
        (i + 1) + ". " + p.idOC +
        " | " + (p.producto || "—") +
        " | prov: " + (p.proveedor || "—") +
        " | carga: " + f +
        " | fila " + p.filaSheet +
        " | AJ " + p.recepcionada + "/" + p.esperada
      );
    });
  }

  Logger.log("");
  Logger.log(parciales.length < 20
    ? "→ Menos de 20: opción (a), que JP las corrija a mano."
    : "→ 20 o más: conviene evaluar la opción (b).");

  return { total: parciales.length, ocs: Object.keys(ocsDistintas).length };
}

// ── Diagnóstico: top proveedores con pendientes (SOLO LECTURA) ─
// No escribe nada. Sirve para elegir un PROVEEDOR_PRUEBA real.
function topProveedoresPendientes(n) {
  const limite = n || 10;
  const { ocMap } = leerOCsParaRecepcion_();
  const acc = {};   // proveedor → { lineas, saldo, ocs{} }

  for (const idOC in ocMap) {
    ocMap[idOC].lineas.forEach(function (l) {
      if (!estadoEnLista_(l.estado, RECEPCION_ESTADOS_VISIBLES)) return;
      if (l.saldo <= 0) return;
      // Etiqueta informativa: NO es un texto buscable. Estas líneas se
      // alcanzan con buscarSinProveedor(), no escribiéndolo en el buscador.
      const key = l.proveedor || "(sin proveedor — usar buscarSinProveedor())";
      if (!acc[key]) acc[key] = { lineas: 0, saldo: 0, ocs: {} };
      acc[key].lineas += 1;
      acc[key].saldo  += l.saldo;
      acc[key].ocs[idOC] = true;
    });
  }

  const lista = Object.keys(acc).map(function (nombre) {
    return {
      proveedor: nombre,
      lineas:    acc[nombre].lineas,
      saldo:     acc[nombre].saldo,
      ocs:       Object.keys(acc[nombre].ocs).length,
    };
  }).sort(function (a, b) { return b.lineas - a.lineas; });

  return lista.slice(0, limite);
}

// ── Test sin parámetros para buscarSinProveedor() ────────────
// SOLO LECTURA. Existe para poder lanzarlo desde el desplegable del
// editor web y para leer el resultado formateado en el log.
function testSinProveedor() {
  const res = buscarSinProveedor();

  Logger.log("═══ LÍNEAS SIN PROVEEDOR ASIGNADO (columna Z vacía) ═══");
  Logger.log("Ventana: últimos " + RECEPCION_DIAS_HISTORICO + " días");
  Logger.log("OCs encontradas: " + res.total);

  if (res.total === 0) {
    Logger.log("");
    Logger.log("Ninguna línea huérfana pendiente. 🎉");
    return res;
  }

  let totalLineas = 0;
  let totalSaldo  = 0;

  res.resultados.forEach(function (oc) {
    totalLineas += oc.lineas.length;
    totalSaldo  += oc.saldoTotal;

    Logger.log("");
    Logger.log("── OC " + oc.idOC +
               "  ·  " + oc.lineas.length + " línea(s) sin proveedor" +
               "  ·  cliente: " + (oc.cliente || "—") +
               "  ·  saldo OC: " + oc.saldoTotal);

    oc.lineas.forEach(function (l) {
      Logger.log(
        "     fila " + l.filaSheet +
        "  |  " + (l.producto || "—") +
        "  |  saldo " + l.saldo + " (de " + l.esperada + ")" +
        "  |  rack: " + (l.rack || "—") +
        "  |  " + l.estado +
        (l.completa ? "  ✅ COMPLETA" : "")
      );
    });
  });

  Logger.log("");
  Logger.log("── Totales ──");
  Logger.log("OCs: " + res.total + "  ·  líneas: " + totalLineas +
             "  ·  saldo pendiente: " + totalSaldo);
  Logger.log("");
  Logger.log("Para asignarles proveedor hay que editar la columna Z del Sheet.");
  Logger.log("Este módulo NO escribe la columna Z.");

  return res;
}

// ── Diagnóstico de rendimiento (SOLO LECTURA) ────────────────
// No escribe nada. Mide dónde se va el tiempo y revela cómo está
// ordenada la hoja, que es lo que asumí mal al intentar optimizar.
function diagnosticoRecepcion() {
  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(PANEL_CONFIG.SHEET_NAME);
  if (!sheet) throw new Error("Hoja no encontrada");

  const t0 = new Date();
  const ultimaFila = sheet.getLastRow();
  const ultimaCol  = sheet.getLastColumn();
  const tDim = new Date() - t0;

  Logger.log("═══ DIAGNÓSTICO DE RENDIMIENTO ═══");
  Logger.log("Dimensiones: " + ultimaFila + " filas x " + ultimaCol + " columnas");
  Logger.log("  (getLastRow/getLastColumn tardó " + tDim + " ms)");
  Logger.log("Celdas totales: " + (ultimaFila * ultimaCol).toLocaleString());

  // ¿Cómo está ordenada la hoja? Esto es lo que asumí sin verificar.
  const t1 = new Date();
  const fechas = sheet
    .getRange(RECEPCION_PRIMERA_FILA, PANEL_CONFIG.COL.FECHA_CARGA + 1,
              ultimaFila - RECEPCION_PRIMERA_FILA + 1, 1)
    .getValues();
  const tCol = new Date() - t1;
  Logger.log("");
  Logger.log("Leer SOLO la columna de fecha: " + tCol + " ms (" + fechas.length + " celdas)");

  const fmt = function (d) {
    return d ? Utilities.formatDate(new Date(d), Session.getScriptTimeZone(), "dd-MM-yyyy") : "(vacía)";
  };
  Logger.log("  Fila 3 (primera de datos): " + fmt(fechas[0][0]));
  Logger.log("  Última fila (" + ultimaFila + "):       " + fmt(fechas[fechas.length - 1][0]));

  const corte = new Date();
  corte.setDate(corte.getDate() - RECEPCION_DIAS_HISTORICO);

  let enVentana = 0, sinFecha = 0, primeraEnVentana = -1;
  for (let k = 0; k < fechas.length; k++) {
    const f = fechas[k][0];
    if (!f) { sinFecha++; if (primeraEnVentana === -1) primeraEnVentana = k; continue; }
    if (new Date(f) >= corte) {
      enVentana++;
      if (primeraEnVentana === -1) primeraEnVentana = k;
    }
  }
  Logger.log("");
  Logger.log("Filas dentro de los " + RECEPCION_DIAS_HISTORICO + " días: " + enVentana);
  Logger.log("Filas SIN fecha de carga: " + sinFecha);
  Logger.log("Primera fila que entra a la ventana: " +
             (primeraEnVentana === -1 ? "ninguna"
              : (RECEPCION_PRIMERA_FILA + primeraEnVentana)));
  Logger.log("");
  if (primeraEnVentana <= 0) {
    Logger.log("⚠️  La ventana arranca en la PRIMERA fila de datos.");
    Logger.log("    Acotar por rango no sirve: habría que leer la hoja igual.");
    Logger.log("    Esto explica por qué la 'optimización' salió más lenta.");
  } else {
    const ahorro = Math.round(100 - ((ultimaFila - (RECEPCION_PRIMERA_FILA + primeraEnVentana) + 1) / fechas.length) * 100);
    Logger.log("→ Acotando por rango se leerían " + ahorro + "% menos filas.");
  }

  // Costo de la lectura completa, que es lo que hacemos hoy
  const t2 = new Date();
  const todo = sheet.getDataRange().getValues();
  Logger.log("");
  Logger.log("getDataRange().getValues() completo: " + (new Date() - t2) + " ms (" +
             todo.length + " filas)");

  const t3 = new Date();
  buscarPorProveedor("mercado libre");
  Logger.log("buscarPorProveedor() de punta a punta: " + (new Date() - t3) + " ms");
}

// ── Diagnóstico del panel (SOLO LECTURA) ─────────────────────
// No escribe nada. Mide en qué se van los ~13 s de obtenerDatos()
// y verifica el cruce de morosidad, que hoy llega vacío.
function diagnosticoPanel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  Logger.log("═══ HOJAS DEL LIBRO (nombre exacto) ═══");
  ss.getSheets().forEach(function (sh) {
    Logger.log("  · \"" + sh.getName() + "\"  —  " +
               sh.getLastRow() + " filas x " + sh.getLastColumn() + " col");
  });

  Logger.log("");
  Logger.log("═══ RESOLUCIÓN DE NOMBRES ═══");
  [PANEL_CONFIG.SHEET_NAME, PANEL_CONFIG.SHEET_COBRANZA, "BASE DE DATOS COBRANZA"]
    .forEach(function (n) {
      Logger.log("  getSheetByName(\"" + n + "\") → " +
                 (ss.getSheetByName(n) ? "ENCONTRADA" : "❌ null"));
    });

  Logger.log("");
  Logger.log("═══ TIEMPOS POR FASE ═══");
  const t1 = new Date();
  const oc = leerOCs();
  const tOC = new Date() - t1;
  Logger.log("  leerOCs():          " + tOC + " ms  (" + Object.keys(oc.ocMap).length + " OCs)");

  const t2 = new Date();
  const mora = obtenerMorosidad();
  const tMora = new Date() - t2;
  Logger.log("  obtenerMorosidad(): " + tMora + " ms  (" + Object.keys(mora).length + " RUTs)");

  const t3 = new Date();
  const cob = leerCobranza();
  const tCob = new Date() - t3;
  Logger.log("  leerCobranza():     " + tCob + " ms  (" + cob.filas.length + " filas, " +
             Object.keys(cob.porRut).length + " RUTs)");

  const t4 = new Date();
  const datos = obtenerDatos();
  const tTotal = new Date() - t4;
  Logger.log("  obtenerDatos() total: " + tTotal + " ms");
  Logger.log("  → lectura de hojas: " + (tOC + tMora + tCob) + " ms de " + tTotal +
             " (" + Math.round((tOC + tMora + tCob) / tTotal * 100) + "%)");

  Logger.log("");
  Logger.log("═══ POR QUÉ NO SE VE LA MOROSIDAD ═══");
  Logger.log("  RUTs en moraMap (obtenerMorosidad): " + Object.keys(mora).length);
  Logger.log("  RUTs en porRut  (leerCobranza):     " + Object.keys(cob.porRut).length);
  const ruts = datos.adquisiciones.slice(0, 5).map(function (o) {
    return { id: o.idOC, rut: o.rut, rutCliente: o.rutCliente };
  });
  Logger.log("  Muestra de RUTs en OCs de adquisiciones:");
  ruts.forEach(function (r) {
    Logger.log("    " + r.id + " → oc.rut=\"" + r.rut + "\"  oc.rutCliente=\"" + r.rutCliente + "\"" +
               "  ¿en moraMap? " + (mora[r.rut] ? "sí" : "no") +
               "  ¿en porRut? "  + (cob.porRut[r.rut] ? "sí" : "no"));
  });
  const muestraCob = Object.keys(cob.porRut).slice(0, 5);
  Logger.log("  Muestra de RUTs en cobranza: " + JSON.stringify(muestraCob));
  Logger.log("");
  Logger.log("  Con mora poblada: " +
             datos.adquisiciones.filter(function (o) { return o.mora; }).length +
             " de " + datos.adquisiciones.length + " OCs");
}

// ── Precalentado del caché del panel ─────────────────────────
// Handler del trigger. Recalcula obtenerDatos() y lo deja cacheado para
// que el primer usuario del día tampoco espere los ~13 s.
// Es SOLO LECTURA sobre las hojas: calcula y guarda en CacheService.
function calentarCachePanel() {
  const t0 = new Date();
  try {
    const data = obtenerDatos();
    const ok   = cacheGuardarTroceado_(PANEL_CACHE_KEY, data, PANEL_CACHE_TTL);
    Logger.log("[cache] panel " + (ok ? "recalentado" : "NO cacheado (muy grande)") +
               " en " + (new Date() - t0) + " ms");
  } catch (err) {
    // Nunca dejar que el trigger falle en silencio ni que reviente:
    // si esto falla, el endpoint simplemente relee en vivo.
    Logger.log("[cache] fallo al recalentar: " + err.message);
  }
}

// Instalador dedicado. NO usar instalarTriggers(), que reactivaría
// verificarCambiosEstado y resumenDiario (desactivados a propósito).
// Idempotente: borra solo los triggers de calentarCachePanel.
function instalarTriggerCache() {
  let borrados = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "calentarCachePanel") {
      ScriptApp.deleteTrigger(t);
      borrados++;
    }
  });
  ScriptApp.newTrigger("calentarCachePanel")
    .timeBased().everyMinutes(PANEL_CACHE_MINUTOS_TRIGGER).create();

  Logger.log("✅ Trigger de caché instalado — cada " + PANEL_CACHE_MINUTOS_TRIGGER + " min" +
             (borrados ? " (se reemplazaron " + borrados + " anteriores)" : ""));
  listarTriggers();
}

function desinstalarTriggerCache() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "calentarCachePanel") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log("Triggers de caché eliminados: " + n);
  listarTriggers();
}

// Solo lectura: qué triggers hay hoy en el proyecto compartido.
function listarTriggers() {
  Logger.log("");
  Logger.log("═══ TRIGGERS DEL PROYECTO ═══");
  const ts = ScriptApp.getProjectTriggers();
  if (ts.length === 0) { Logger.log("  (ninguno)"); return; }
  ts.forEach(function (t) {
    Logger.log("  · " + t.getHandlerFunction() + "  [" + t.getEventType() + "]");
  });
}
