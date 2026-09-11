# Calculadora de Flete — Corp Premier

Herramienta interna del equipo comercial para estimar el costo de flete de una
cotizacion, comparando los dos couriers con los que trabajamos.

## Archivos de esta herramienta

| Archivo | Para que sirve |
| --- | --- |
| `index.html` | La calculadora. Compara U Send y Starken lado a lado. |
| `actualizar-tarifas.html` | Convierte los Excel de los couriers en los archivos de datos. No requiere programar. |
| `data/tarifas-usend.js` | Precios U Send por grupo de cobro y zona. |
| `data/tarifas-starken.js` | Precios Starken por destino. |
| `data/destinos.js` | Maestro de destinos: zona, agencia y SLA de U Send mas el precio de Starken. |
| `herramientas/generar_tarifas.py` | Genera los tres archivos de `data/` desde la linea de comandos. |
| `tarifarios/` | Los Excel originales tal como los envio cada courier. |

Los otros archivos del repositorio (`hub-operacional.html`, `dashboard.html`,
`buscador-proveedores.html`) son proyectos distintos y no comparten codigo con
la calculadora.

## Como actualizar las tarifas

Cuando un courier envia un tarifario nuevo:

1. Abre `actualizar-tarifas.html` desde el link **Actualizar tarifarios** de la
   calculadora.
2. Arrastra el Excel del courier. La pagina lo lee en tu navegador, no lo sube
   a ningun servidor.
3. Escribe las fechas de vigencia. La calculadora las usa para avisar al equipo
   cuando el tarifario este por vencer.
4. Revisa la tabla de comparacion contra las tarifas actuales. Si ves una
   variacion que no cuadra con lo que negocio el area, detente y confirma antes
   de publicar.
5. Descarga los archivos generados y subelos a la carpeta `data/` del
   repositorio en GitHub: **Add file**, luego **Upload files**, arrastrar y
   confirmar el commit.
6. Guarda tambien el Excel original en `tarifarios/`, para dejar el respaldo de
   donde salieron los numeros.

El archivo `destinos.js` cruza los dos tarifarios, asi que se regenera completo
solo cuando cargas los dos Excel en la misma sesion. Si actualizas un courier
solo, sube unicamente su archivo de precios y deja el maestro de destinos como
esta.

### Alternativa por linea de comandos

Con Python 3 y openpyxl instalados:

```bash
python3 herramientas/generar_tarifas.py
```

Lee los Excel de `tarifarios/`, escribe los tres archivos de `data/` e informa
cuantos destinos quedaron con cobertura de cada courier. Las fechas de vigencia
y los nombres de archivo estan en las constantes del inicio del script.

## Como se calculan los precios

Los dos tarifarios son **valores netos con origen Santiago**, por lo que son
comparables entre si. La calculadora muestra el neto y agrega el buffer; el IVA
es opcional con el switch de la pantalla.

**U Send.** Hasta 15 kg cobra el valor fijo del tramo. Sobre 15 kg cobra el
valor fijo del tramo de 9 a 15 kg mas los kilos excedentes al precio del tramo
donde cae el peso total. No es un calculo acumulativo por tramos: un envio de
90 kg paga los 75 kilos de exceso al precio del tramo 50-100, no una suma de
tramos sucesivos.

**Starken.** Precio cerrado hasta 15 kg. Entre 16 y 100 kg el tarifario publica
un valor para cada kilo exacto. Sobre 100 kg se toma el valor de 100 kg y se
suman los kilos adicionales al precio por kilo del destino.

**Peso volumetrico.** Si ingresas las medidas del bulto, cada courier cobra el
mayor valor entre peso real y volumetrico, con su propio factor: U Send usa
1 m3 = 250 kg, Starken divide el volumen en centimetros por 5000.

## Diferencias de cobertura entre los dos couriers

- Starken cobra todo el Gran Santiago como un unico destino llamado SANTIAGO.
  La calculadora mapea las comunas urbanas de la Region Metropolitana a ese
  destino y lo indica en pantalla.
- Algunas comunas aparecen con nombres distintos en cada tarifario, por ejemplo
  Aysen y Puerto Aysen. Esos casos se fusionan en un solo destino, que se
  encuentra buscando por cualquiera de los dos nombres. Las equivalencias estan
  en la constante `ALIAS_STARKEN` del script de Python y en `ALIAS` de la pagina
  de actualizacion. Si agregas una, agregala en los dos lugares.
- Chillan Viejo y Hualpen no tienen destino propio en el tarifario Starken. La
  calculadora usa la tarifa de la localidad vecina del mismo grupo y lo advierte
  en pantalla como valor referencial.
- Siete comunas quedan solo con U Send: Antartica, Cabo de Hornos, Isla de
  Pascua, Juan Fernandez, Ollague, Timaukel y Tirua. Tres de ellas tampoco
  tienen cobertura U Send y requieren cotizacion directa.

## Verificar despues de un cambio

La carpeta `data/` se puede validar contra los Excel originales volviendo a
correr el script de Python: informa la cantidad de destinos y avisa si un grupo
de cobro aparece con valores inconsistentes. La pagina de actualizacion hace el
mismo control en el navegador y no habilita la descarga si no pudo leer una
hoja completa.
