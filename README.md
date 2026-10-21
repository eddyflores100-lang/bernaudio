# BernAudio 🎛️

> **Medición y alineación de audio profesional en tiempo real.**
> El análisis de audio profesional, al alcance de todos.

Landing + **app web funcional** de **BernAudio** — la plataforma de medición acústica
en tiempo real para diseñar, afinar y monitorear sistemas de sonido en Windows, macOS,
Linux e iPad.

![BernAudio](assets/og.png)

## 🌐 BernAudio Web (app incluida en este repo)

**[▶ Lanzar la app](app.html)** — corre 100% en tu navegador (GitHub Pages sirve HTTPS,
requisito para acceder al micrófono). Sin registro, sin instalación.

**[🧉 Diseñador de arreglos de subs](subs.html)** — módulo web independiente, también gratis:

| Vista | Qué hace |
|-------|----------|
| **6 arreglos** | Línea recta, arco electrónico (steering), arco físico, end-fired, gradiente de 2 filas y stack invertido |
| **Mapa SPL** | Suma coherente de fuentes puntuales (1/r + delay + polaridad) por frecuencia o banda ancha 40–125 Hz, normalizado a 0 dB |
| **Polar 360°** | Directividad real del arreglo en círculo completo, escala −30…0 dB |
| **Ondas animadas** | Interferencia en el dominio del tiempo (ralentizada 4.5×) para ver cómo suman y cancelan |
| **Tabla de delays** | ms, muestras @48/96 kHz y polaridad por caja, lista para tipear en tu DSP y exportable a CSV |
| **Física ajustable** | Temperatura → velocidad del sonido (331.3 + 0.606·T), preset λ/4, frecuencias 31–125 Hz |

> Verificado numéricamente: gradiente a λ/4 ≈ 29 dB de rechazo trasero,
> end-fired 4× ≈ 26 dB, línea de 6 ≈ +15.4 dB de acople frontal.

| Módulo | Qué hace |
|--------|----------|
| **SPL** | Nivel sonoro con ponderación A/C/Z, respuesta Fast/Slow, LAeq acumulado, Lmin/Lmax, pico, historial de 120 s y calibración por offset |
| **RTA** | Analizador 1/1, 1/3 y 1/6 de octava (ANSI base 2), ponderación A/C/Z, promediado 1–16, peak-hold (decaimiento o fijo), FFT hasta 32K y hasta 4 curvas guardadas |
| **Espectrograma** | Cascada en tiempo real con eje logarítmico, escala completa de magnitud (barra de color dB) + crosshair de lectura (ratón/táctil), 4 colormaps, rango dinámico y techo ajustables |
| **Función de transferencia** | Magnitud, fase y coherencia con referencia interna (ruido rosa) o **canal 2 por cable loopback** (modo pro 2 canales). Delay automático por correlación cruzada + **ajuste fino ±20 ms**, **inversión de polaridad**, suavizado 1/6–1/12 oct, **trazas A/B/C para comparar dos o más fuentes** y **exportación CSV (f·mag·fase·coherencia) y PNG** |
| **Delay Finder** | **Tiempo de delay entre dos fuentes sonoras**: modo 1 micro secuencial A→B (ideal iPad) o modo 2 micros en vivo (interfaz estéreo). Δt, Δdistancia, confianza y recomendación de a qué fuente añadir el delay |
| **Impulso (IR)** | Medición por barrido logarítmico (método Farina) con deconvolución Wiener, delay en ms/metros, RT60 estimado (T20/Schroeder) y exportación WAV |
| **Calibración** | **Carga el archivo de corrección del micrófono (.cal/.csv/.txt/.frd) sin pistófono**: curva aplicada en vivo a SPL, RTA, espectrograma y TF; persistente en el navegador y exportable a CSV |
| **Generador** | Ruido rosa/blanco, seno variable, barrido log 3–20 s, nivel −60…0 dB y monitor de salida |

**Motor DSP propio** (`js/app/dsp.js`): FFT radix-2 validada contra DFT directa,
ponderaciones IEC 61672 (A/C), bandas de octava base-2, ventanas Hann/Blackman-Harris,
deconvolución regularizada, RT60 por integración inversa de Schroeder, correlación
cruzada FFT con signo verificado (delay finder/TF) e interpolación logarítmica de
curvas de calibración. 40 tests unitarios en Node (`scripts/test-dsp.js`).

## 🖥️📱 Plataformas

- **Computador (modo Pro con hardware)** — Windows/macOS/Linux (Chrome, Edge, Firefox):
  interfaz de audio USB 2×2, `Canales = 2`, y para TF de doble canal clásica un cable de
  **loopback** de la salida a la entrada 2 con `Referencia = Canal 2`. Dos micros de medición
  → Delay Finder en vivo entre fuentes.
- **iPad** — Safari (iPadOS 15+) o Chrome iOS: micrófono interno del iPad o micrófono
  externo / interfaz USB-C·Lightning clase compatible (se selecciona en `Entrada`).
  Toda la suite funciona igual; el Delay Finder secuencial 1 micro es ideal para iPad.

> ⚠️ **Nota de precisión**: el navegador aplica procesado al micrófono que BernAudio
> desactiva (`echoCancellation:false, noiseSuppression:false, autoGainControl:false`),
> pero la cadena de audio del sistema no es de grado instrumento. Para lectura SPL
> absoluta, carga la curva de calibración de tu micrófono y ajusta el offset con un
> calibrador acústico (todo se guarda en tu navegador). Para alineación relativa
> (delay, fase, EQ) funciona de maravilla.

## ✨ Características de la plataforma

| Motor | Descripción |
|-------|-------------|
| **RTA** | 1/1, 1/3 y 1/6 de octava · FFT hasta 128K · promediado espacial |
| **Espectrograma** | Mapa de calor continuo acelerado por GPU hasta 192 kHz |
| **Función de transferencia** | Magnitud, fase y coherencia · doble ventana FFT · MTW |
| **Impulse Response** | LIFFT integrado para delay y análisis de reflexiones |
| **Sync inalámbrico** | Transfer function sincronizada sin cable de referencia |
| **SPL remoto** | Logging multicanal + webviewer en vivo incluido |
| **Asistente IA** | Sugerencias de delay, ganancia y EQ justificadas |
| **Colaboración cloud** | Sesiones multiusuario en tiempo real |

## 🗂️ Estructura del repositorio

```
bernaudio/
├── index.html          # Landing completa (una sola página)
├── app.html            # BernAudio Web — app de medición funcional
├── subs.html           # Diseñador de arreglos de subs (nuevo módulo web)
├── css/
│   ├── styles.css      # Sistema de diseño dark premium (landing)
│   ├── app.css         # Estilos de la app
│   └── subs.css        # Estilos del diseñador de arreglos
├── js/
│   ├── main.js         # Motores de visualización canvas (landing)
│   ├── subarray.js     # Motor de física de arreglos de subs (mapa/polar/ondas)
│   ├── subarray-ui.js  # Cableado de UI del diseñador
│   └── app/
│       ├── dsp.js          # Motor DSP (FFT, ponderaciones, bandas, IR, RT60, xcorr, cal)
│       ├── audio-engine.js # AudioContext, micrófono 1/2 canales, taps de bloques
│       ├── modules-spl.js  # SPL · RTA · Espectrograma (con cal de micro aplicada)
│       ├── modules-tf.js   # Generador · Transferencia (trazas/loopback) · Impulso
│       ├── modules-delay.js# Delay Finder (1 micro secuencial / 2 micros en vivo)
│       ├── modules-cal.js  # Calibración de micrófono por archivo
│       └── ui.js           # Pestañas, calibración, canales, arranque
├── assets/
│   ├── logo.svg        # Logotipo horizontal
│   ├── favicon.svg     # Ícono del sitio
│   ├── og.png          # Imagen Open Graph 1200×630
│   └── og.svg          # Versión vectorial
├── 404.html            # Página de error amigable
├── deploy.sh           # Script de publicación automática en GitHub Pages
├── .nojekyll           # Sirve los archivos tal cual (sin procesamiento Jekyll)
└── README.md
```

## 🚀 Publicar en GitHub Pages (elige una vía)

### Vía A — Sin terminal (2 minutos, la más fácil)

1. Descarga **`bernaudio-github-pages.zip`** y descomprímelo.
2. Entra a [github.com/new](https://github.com/new) → nombre **`bernaudio`** → Público → **Create repository**.
3. En la página del repo nuevo, pulsa **«uploading an existing file»** (o *Add file → Upload files*) y **arrastra todo el contenido** de la carpeta descomprimida → **Commit changes**.
4. Ve a **Settings → Pages** → *Branch*: **`main`** + **`/ (root)`** → **Save**.
5. En 1–2 minutos vive en: `https://TU-USUARIO.github.io/bernaudio/`

### Vía B — Script automático (1 comando, hace todo)

```bash
cd bernaudio
bash deploy.sh
```

El script pide tu usuario y un token PAT, y se encarga de **crear el repo,
subir el código y activar GitHub Pages** automáticamente.

> 🔑 Para el token: abre [github.com/settings/tokens/new?scopes=repo](https://github.com/settings/tokens/new?scopes=repo),
> ponle descripción *BernAudio*, marca el scope **`repo`** y genera. Pégalo cuando
> el script lo pida (entrada oculta). El token **no queda guardado** en ninguna parte.

### Vía C — Manual con git

1. Crea el repositorio **`bernaudio`** en GitHub (sin README inicial).

2. Sube el contenido de esta carpeta a la rama `main`:

   ```bash
   cd bernaudio
   git init
   git add .
   git commit -m "feat: landing inicial de BernAudio"
   git branch -M main
   git remote add origin https://github.com/TU-USUARIO/bernaudio.git
   git push -u origin main
   ```

3. Ve a **Settings → Pages**.
4. En *Source* elige **Deploy from a branch**, rama **`main`**, carpeta **`/ (root)`** y guarda.
5. En 1–2 minutos tu landing estará viva en:

   ```
   https://TU-USUARIO.github.io/bernaudio/
   ```

> 💡 El archivo `.nojekyll` ya está incluido para que GitHub Pages sirva
> los archivos estáticos sin procesarlos con Jekyll.

## 🛠️ Desarrollo local

No necesitas dependencias. Cualquier servidor estático funciona:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .
```

Abre `http://localhost:8080` en tu navegador.

## 🎨 Sistema de diseño

- **Fondo:** `#06080C` (dark premium)
- **Acento principal:** teal `#FFA23E`
- **Acento secundario:** ámbar `#F5B04C`
- **Tipografías:** Space Grotesk (títulos) · Inter (cuerpo)
- Las visualizaciones del hero, la demo y el CTA son **canvas reales** (RTA, espectrograma y función de transferencia simulados), no videos ni GIFs.

## 📄 Licencia

MIT — ver [LICENSE](LICENSE).


---

© 2026 Alicelabs LLC. Todos los derechos reservados. BernAudio™ es una marca de Alicelabs LLC.
