# Recepción v1.1 — qué cambió y cómo subirlo

Dos cosas nuevas en la pestaña **Recepción** del hub: las líneas en estado
**Retiro** ahora se pueden recepcionar, y cada línea acepta dos comentarios que
se escriben en las columnas **AB** y **AD** del gestor de compras.

El cambio toca dos archivos. El frontend
([hub-operacional.html](hub-operacional.html)) ya está listo. El backend
([Gestor-ordenes-de-compra.gs](Gestor-ordenes-de-compra.gs)) hay que copiarlo a
mano al editor de Apps Script.

## Cómo subir el backend

1. Abre el proyecto de Apps Script y ubica el archivo donde vive este código.
   El encabezado dice `Archivo: PanelBackend.gs`, así que probablemente se llame
   así allá aunque acá esté como `Gestor-ordenes-de-compra.gs`.
2. Reemplaza su contenido completo por el de este archivo.
3. Guarda y publica: **Implementar**, **Administrar implementaciones**, editar la
   que está en uso y subir la versión. Si en vez de eso creas una implementación
   nueva, la URL cambia y hay que actualizar `API_URL` en el hub.

## Qué se modificó en el Apps Script

| Dónde | Cambio |
| --- | --- |
| `PANEL_CONFIG.COL` | Se agrega `FACTURA_FOLIO: 29`, que es la columna AD. |
| `RECEPCION_ESTADOS` | Se agrega `RETIRO: "Retiro"`. |
| `RECEPCION_ESTADOS_VISIBLES` | Entra `Retiro` a los estados recepcionables. |
| `RECEPCION_CACHE_KEY` | Sube a `recep_ds_v2` porque el dataset cambió de forma. |
| `leerOCsParaRecepcion_` | Cada línea ahora también devuelve `folioFactura`. |
| `registrarRecepcion` | Recibe dos parámetros opcionales y escribe AB y AD. |
| `doPost` | Le pasa esos dos campos a `registrarRecepcion`. |

**"Retiro Pte." sigue bloqueado a propósito.** Ese estado significa que la
mercadería todavía no sale de donde el proveedor, así que Juan Pablo no puede
tenerla al frente. Sigue siendo trabajo de adquisiciones, igual que antes. Si
en algún momento quieres que también se pueda recepcionar, se agrega
`"Retiro Pte."` a `RECEPCION_ESTADOS_VISIBLES` y no hace falta nada más.

## La columna AB y la ruta de Daniel

El módulo tenía escrito como regla de diseño que AB era **solo lectura**, porque
alimenta la Ruta Logística: ahí va la dirección del proveedor con el formato
`Proveedor - Dirección - Teléfono - Horario`, y el hub la parsea para armar la
ruta en Google Maps. Ahora esa regla cambia, así que quedaron tres resguardos:

- **El campo llega precargado** con lo que la celda ya tiene. Juan Pablo edita
  el texto existente en vez de reemplazarlo a ciegas.
- **El riesgo se cierra solo.** La ruta solo mira líneas en estado `Retiro`. Al
  confirmar, la línea pasa a `Recepcionado` o `Recepcion Parcial`, o sea que ya
  salió de la ruta de Daniel cuando el comentario se escribe.
- **El valor anterior queda en el Logger** de Apps Script, con la etiqueta
  `[RECEPCION][AB]`. Es la única forma de recuperar una dirección si alguien la
  borra sin querer.

Verificado además que el parser de direcciones sobrevive a un comentario
agregado al final: sobre `EASY - Av. Matta 1234 - 22334455 - L a V · retirado
por Daniel` sigue devolviendo `Av. Matta 1234`.

## Reglas de escritura

`registrarRecepcion` escribe hasta cuatro celdas, todas en la misma fila. AJ y S
siempre, como antes. AB y AD solo si el comentario llega con texto y además es
distinto de lo que ya había.

Un campo vacío **nunca borra** lo que está en la planilla: si Juan Pablo deja el
campo en blanco, la clave no viaja en el JSON y la celda no se toca. El costo de
esa decisión es que tampoco se puede vaciar una celda desde el hub. Para eso hay
que editar la planilla directamente.

El folio se guarda como texto plano, con `setNumberFormat("@")`. Sin eso, un
folio tipo `0048122` perdería los ceros de la izquierda al convertirse en número.

## Cómo probar después de publicar

1. En la planilla, deja una línea con estado `Retiro` en la columna S para un
   proveedor conocido.
2. Busca ese proveedor en la pestaña Recepción. La línea debe aparecer con el
   badge morado `Retiro`, y la cabecera de la OC con `🚚 1 de retiro`.
3. Abre **Comentarios de recepción** en esa línea. La observación logística debe
   venir precargada con lo que ya está en AB.
4. Escribe un folio, confirma, y revisa AB y AD en la planilla.
5. Confirma otra línea con los dos campos vacíos y verifica que AB y AD quedaron
   intactas.
6. Intenta recepcionar una línea en `Retiro Pte.`. Debe rechazarla con un
   mensaje que nombre los estados permitidos.
