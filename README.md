# 🎙️ Voz a Texto

App web para **dictar sin parar**: apretás REC, hablás y todo se va escribiendo en el mismo
documento. Podés pausar, seguir más tarde, escuchar la grabación y exportar el texto a PDF,
Word, notas y más.

No necesita instalación, ni cuenta, ni servidor: es HTML, CSS y JavaScript puro que corre en
tu navegador.

---

## Cómo se usa

### 1. Calibrar la voz (antes de grabar)

La primera vez que apretás REC se abre el asistente de calibración. Son tres pasos cortos y
sirven para que el dictado no se equivoque:

| Paso | Qué hace |
|---|---|
| **1. Micrófono** | Mide el **ruido de fondo** (4 s en silencio) y el **volumen de tu voz** (5 s hablando). Te dice si estás muy bajo, si saturás o si el ambiente es ruidoso, y calcula cuánto se destaca tu voz sobre el ruido. |
| **2. Prueba de dicción** | Leés 4 frases pensadas para cubrir sonidos difíciles del español, números y nombres. Se compara **palabra por palabra** lo que dijiste con lo que el dictado entendió y te da un porcentaje de precisión. |
| **3. Mis palabras** | Con los errores del paso 2 arma una lista de correcciones (*escuchó «indú» → escribir «hindú»*). Las confirmás y desde ahí se aplican solas mientras dictás. También podés agregar nombres propios o términos técnicos. |

El perfil queda guardado. Podés repetir la calibración cuando quieras desde **🎚️ Calibrar mi voz**.

### 2. Grabar, pausar y seguir

- **REC** empieza a dictar. El mismo botón pausa y reanuda; también están los botones **Pausar** y **Detener**.
- En pausa el dictado se corta pero el documento queda como estaba: cuando seguís —en un rato o
  mañana— el texto nuevo se **agrega al final del mismo documento**.
- Atajo de teclado: `Ctrl` + `Espacio`.
- El texto se guarda solo mientras hablás. Podés editarlo a mano en cualquier momento.
- Cuando terminás, **«✓ Terminar y cerrar»** guarda el documento, lo marca como listo (queda con
  un ✓ en la lista) y te abre uno nuevo. Si no le pusiste título, se lo pone solo con las
  primeras palabras de lo que dictaste. Podés volver a abrirlo y seguir cuando quieras.

### 3. Puntuación dictada

Con **Puntuación por voz** activado podés decir:

| Decís | Escribe |
|---|---|
| punto · punto y seguido | `.` |
| coma | `,` |
| punto y coma · dos puntos | `;` `:` |
| nueva línea | salto de línea |
| nuevo párrafo · punto y aparte | párrafo nuevo |
| signo de interrogación · abre interrogación | `?` `¿` |
| signo de exclamación · abre exclamación | `!` `¡` |
| abre/cierra paréntesis · comillas · guion · raya | `(` `)` `"` `-` `—` |
| barra · arroba · puntos suspensivos | `/` `@` `…` |

Con **Formato automático** además se corrigen los espacios y las mayúsculas de cada oración.

### Separar el texto en líneas

Dictar de corrido deja un bloque difícil de leer. El selector **Separar** decide cómo se acomoda
el texto mientras hablás:

| Opción | Resultado |
|---|---|
| **Todo seguido** | un párrafo corrido, como antes |
| **Una oración por línea** | después de cada punto, sigue abajo |
| **Lista con guiones** | igual, pero cada renglón arranca con `- ` |

Para el texto que ya está escrito está el botón **«⏎ Separar en líneas»**, que lo reacomoda de
una vez con el formato elegido. Se puede deshacer.

### 4. Las grabaciones

Cada vez que grabás se guarda el audio dentro del documento (podés desactivarlo con
**Guardar audio**). En la pestaña **🎧 Grabaciones** podés:

- escucharte con el reproductor,
- descargar el audio,
- **eliminar** una grabación (el texto transcripto se conserva) o borrarlas todas.

> **Si tu teléfono no deja grabar y dictar a la vez** (pasa en varios Android), la app lo
> detecta sola a los pocos segundos: te avisa y te ofrece apagar el guardado de audio con un
> toque, sin cortar la sesión. Lo que se grabó hasta ese momento se conserva.

### 5. Transcribir una grabación guardada

El dictado en vivo necesita el micrófono; esto no. En **🎧 Grabaciones**, cada audio tiene el
botón **«📝 Transcribir este audio»**: le pasa el archivo ya grabado a un modelo Whisper que
corre **dentro del navegador**, sin servidor ni cuentas.

Sirve justo para los teléfonos que no dejan grabar y dictar a la vez: grabás primero, transcribís
después.

- Elegís la calidad: **Rápido** (~40 MB), **Preciso** (~80 MB) o **Máximo** (~250 MB).
- La primera vez baja el modelo y queda guardado en el navegador; después no descarga más nada.
- Tarda: en un celular puede llevar varios minutos por cada minuto de audio. Podés dejarlo
  trabajando.
- Cuando termina, podés agregar el texto al documento o copiarlo.

### 6. Escuchar con otras voces

En **🗣️ Escuchar con otras voces** el documento se lee en voz alta con cualquiera de las voces
instaladas en tu sistema, con velocidad y tono regulables. Sirve para revisar el texto sin leerlo.

> Las voces que aparecen son las de tu sistema operativo. Si la lista está vacía, instalá voces
> desde la configuración del sistema (en Windows: *Configuración → Hora e idioma → Voz*).

### 7. Exportar

| Formato | Archivo | Para qué |
|---|---|---|
| **PDF** | `.pdf` | documento paginado, con título y numeración |
| **Word** | `.docx` | editable en Word, LibreOffice, Google Docs o Pages |
| **Notas** | `.txt` | pegar en Notas de Apple, Google Keep, cualquier bloc |
| **Markdown** | `.md` | Notion, Obsidian, GitHub |
| **HTML** | `.html` | página con formato lista para compartir |
| **JSON** | `.json` | respaldo con metadatos y lista de grabaciones |
| **Copiar** | — | manda todo al portapapeles |
| **Imprimir** | — | imprimir o "Guardar como PDF" desde el navegador |

El PDF y el `.docx` se generan **dentro del navegador**, sin librerías externas ni servicios de terceros.

> Si abrís la app incrustada en un visor que bloquea las descargas (por ejemplo un artifact de
> Claude), la exportación le pide permiso al visor para guardar el archivo. Algunos visores sólo
> admiten ciertos formatos; en ese caso la app te lo dice y podés usar Notas, Markdown o JSON.

---

## Cómo levantarla

El micrófono sólo funciona en `http://localhost` o en `https://`, así que **no alcanza con abrir
el `index.html` haciendo doble clic**. Levantá un servidor local con cualquiera de estas opciones:

```bash
# Con Python (viene instalado en macOS y Linux)
python3 -m http.server 8080

# Con Node
npx --yes http-server -p 8080

# Con npm, desde la carpeta del proyecto
npm start
```

Después entrá a **http://localhost:8080**.

## Instalarla como app en el celular

La app es una **PWA**: se instala desde el navegador, sin tiendas ni APK.

- **Android / Chrome** — abrí el sitio y tocá **«📲 Instalar como app»** abajo en la barra
  lateral (o el menú ⋮ → *Instalar aplicación*).
- **iPhone / Safari** — botón Compartir → **Agregar a inicio**.

Queda con ícono propio en la pantalla de inicio y se abre a pantalla completa, sin barra de
direcciones. **Funciona sin internet**: podés escribir, grabar audio, escucharte y exportar.
Lo único que necesita conexión es el dictado, porque lo resuelve el servicio de voz del
navegador.

Cada versión guarda su propio juego completo de archivos, así que nunca se mezclan piezas de
dos versiones distintas. Cuando se publica una nueva, la app muestra arriba **«Hay una versión
nueva — Actualizar ahora»**. En la barra lateral también está **«↻ Buscar actualización»** y el
número de versión que estás usando, por si querés forzarlo.

### Desde el celular

En el teléfono **no sirve `localhost`**: eso apunta al propio celular, donde no hay ningún
servidor. Además el micrófono sólo funciona con **HTTPS** (o en `localhost`, que es la excepción).
Para usarla desde el celular hay que publicarla en algún lado:

- **GitHub Pages** — gratis; en repositorios privados requiere cuenta de pago.
- **Netlify / Vercel / Cloudflare Pages** — arrastrás la carpeta y te dan una URL con HTTPS.

Son archivos sueltos, no hay nada que compilar.

### Un solo archivo

Si el lugar donde vas a publicarla acepta una sola página, `build.mjs` junta todo
(HTML, CSS y los módulos JS) en un archivo autocontenido:

```bash
node build.mjs      # genera dist/voz-a-texto.html
```

Ese archivo ya está en el repo, listo para subir a cualquier hosting.

### Navegadores

| | Dictado | Grabar audio | Exportar | Leer con otras voces |
|---|---|---|---|---|
| **Chrome / Edge escritorio** | ✅ | ✅ | ✅ | ✅ |
| Safari (macOS/iOS) | ⚠️ parcial | ✅ | ✅ | ✅ |
| Firefox | ❌ | ✅ | ✅ | ✅ |

El dictado usa la **Web Speech API**, que hoy sólo Chrome y Edge implementan de forma completa.
Si abrís la app en un navegador sin soporte, aparece un aviso arriba y el resto sigue andando.

---

## Privacidad

- Los **documentos, el vocabulario y los audios** se guardan en IndexedDB, o sea en tu propia
  computadora. No hay backend ni cuentas.
- El **dictado** usa el motor de voz del navegador: en Chrome y Edge el audio se envía al
  servicio de reconocimiento del proveedor para convertirlo en texto (por eso necesita internet).
  Es la misma tecnología que usa el dictado del teclado del celular.
- Nada más sale de tu equipo.

---

## Cómo está armado

```
index.html              pantalla completa de la app
vendor/transformers/    librería de IA incorporada (Apache-2.0)
manifest.webmanifest    datos de la app instalable (nombre, íconos, colores)
sw.js                   service worker: la app anda sin internet
build.mjs               empaqueta todo en dist/voz-a-texto.html
assets/styles.css       estilos (incluye responsive e impresión)
js/
  app.js                orquesta todo: estado, UI y eventos
  db.js                 IndexedDB: documentos, audios y ajustes
  recorder.js           MediaRecorder + medidor de nivel en tiempo real
  recognition.js        Web Speech API con reinicio automático para dictar sin cortes
  calibration.js        mediciones del micrófono, frases de prueba y puntaje
  textproc.js           vocabulario, puntuación por voz, formato y diff palabra por palabra
  tts.js                lectura del documento con otras voces
  pwa.js                instalación como app y modo sin conexión
  transcribe-file.js    transcribe grabaciones ya guardadas (decodifica el audio)
  whisper-worker.js     corre el modelo Whisper en segundo plano
  util.js               helpers (tiempos, descargas, avisos)
  export/
    exporters.js        arma cada formato
    pdf.js              generador de PDF propio (Helvetica + WinAnsi, acentos incluidos)
    docx.js             generador de .docx (OOXML)
    zip.js              escritor de ZIP mínimo que empaqueta el .docx
```

### Detalles que resuelven problemas típicos

- **El dictado se corta solo.** El navegador termina la escucha cada tanto: `recognition.js`
  la reinicia con *backoff* y tiene un vigilante que revive el motor si pasan 25 segundos sin
  actividad, así podés dejarlo grabando todo lo que quieras.
- **Los `.webm` no traen duración.** Se calcula al guardarlos y se le corrige la barra de avance
  al reproductor.
- **Palabras que siempre se entienden mal.** El vocabulario las reemplaza al vuelo (ignorando
  acentos y mayúsculas) y además se usa para elegir, entre las alternativas que devuelve el
  motor, la que contiene tus términos.
- **Lecturas largas que se cortan.** El texto se parte en frases y un latido mantiene viva la
  síntesis de voz.
