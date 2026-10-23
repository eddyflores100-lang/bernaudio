# BernAudio: operación y validación

Actualizado el 22 de octubre de 2026. Alicelabs LLC.

## Publicación

La app no necesita un servidor de audio ni claves API. Sirve los archivos de la
raíz en HTTPS. `CNAME` conserva `bernaudio.utalabs.tech`. Las pruebas y los
controles de enlaces/sintaxis se ejecutan con `npm test` y `npm run check`.
El workflow de CI solo tiene permiso de lectura del repositorio. `deploy.sh`
verifica el proyecto y publica la rama local sin forzar ni reescribir el historial.

Al inicio de la revisión, el subdominio devolvía NXDOMAIN. En la comprobación
final ya resolvía y `https://bernaudio.utalabs.tech/` respondía HTTP 200,
sirviendo los archivos nuevos después del despliegue correcto de GitHub Pages.
La zona `utalabs.tech` utiliza Cloudflare (`pearl.ns.cloudflare.com`,
`zahir.ns.cloudflare.com`). No se modificó DNS desde esta sesión y no queda un
cambio DNS pendiente para la publicación comprobada.

Referencia para una futura reconstrucción de la ruta hacia GitHub Pages
(conserva los registros actuales mientras el sitio funcione):

| Campo | Valor |
| --- | --- |
| Zona | `utalabs.tech` |
| Tipo | `CNAME` |
| Nombre | `bernaudio` |
| Destino | `eddyflores100-lang.github.io` |
| Proxy | Solo DNS durante una nueva emisión/verificación del certificado de Pages |
| TTL | Automático |

Comprueba primero que Pages tenga configurado `bernaudio.utalabs.tech` como dominio
personalizado del repositorio. Tras resolver DNS y emitir el certificado, activa
Enforce HTTPS. No uses un CNAME dirigido a una URL con protocolo o ruta.
Guía oficial: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site

## Evidencia automatizada

Las pruebas Node usan señales deterministas, el DSP real, las páginas HTML y
fronteras simuladas de dispositivos/Canvas. Cubren:

- FFT frente a DFT y normalización RMS/Parseval, DC/Nyquist y WAV.
- A/C persistente con interpolación, tonos de referencia hasta 20 kHz,
  invariancia frente a partición en callbacks y energía de transitorios.
- SPL integrado por tiempo de audio, cambio de ponderación, calibración y exportación.
- Captura mono/estéreo reportada, canales emparejados, fallos y cancelación de permisos.
- TF con delay positivo/negativo conocido, ganancia y coherencia; fases envueltas.
- Delay secuencial y dual; señales no correlacionadas, ambiguas o invertidas.
- IR con barrido conocido; rechazo de ruido ajeno/clics/saturación, cancelación,
  límites de memoria y análisis en Worker local.
- Arreglos de fuentes puntuales: suma coherente, frente/atrás, banda ancha,
  leyenda, teclado y controles de animación.
- Flujos completos cargando los scripts en el orden real de `app.html`, incluidos
  cambio de dispositivo, permiso denegado, exportaciones, solo generador y cierre.

También se verificó en Chrome de escritorio el sitio HTTPS publicado: landing,
cambio de vistas, apertura de la app, arranque sin micrófono, salida senoidal de
1 kHz y su monitor, parada, pestaña de calibración y simulador de gradiente con
vista polar, tabla de delays/polaridades y descarga CSV real de seis fuentes
con tres polaridades traseras invertidas. La salida quedó detenida al terminar.

Las pruebas no equivalen a una medición física certificada. La matriz de
micrófonos/interfaces reales y la revisión visual en hardware móvil/iPad siguen
pendientes; las pruebas automatizadas simulan esas fronteras de dispositivos.

## Límites que deben comunicarse

- El nivel necesita una referencia conocida para toda la cadena. El offset se
  declara por el usuario y se invalida al cambiar entrada, curva o iniciar captura.
  Comprueba de nuevo el nivel si cambia la ganancia física.
- A/C son filtros digitales aproximados; Z incluye rechazo continuo de DC a 1 Hz.
  La interpolación A/C añade 48 muestras de retardo por debajo de 192 kHz, y el
  estado de los filtros se conserva al reiniciar solo las estadísticas.
- El espectrograma muestra potencia por bin FFT, no SPL total de banda completa.
- La transferencia usa ventanas de 8192 muestras. La búsqueda circular de delay
  está limitada a ±4096 muestras (aprox. ±85,3 ms a 48 kHz); evita Bluetooth y
  trayectos más largos que ese rango. El gráfico de Delay Finder muestra ±40 ms.
- La referencia interna incluye latencia de navegador/interfaz/salida. Su
  equivalente en metros no es una distancia acústica medida.
- RT/EDT/T20/T30/C50/C80 son estimaciones de banda completa. Las métricas IR se
  ocultan si no hay evidencia suficiente del barrido; los umbrales no son una
  probabilidad ni una certificación del resultado.
- El simulador de subs usa fuentes puntuales ideales, campo libre y niveles
  relativos. No incluye suelo, salas, respuesta/dirección real de las cajas ni
  niveles absolutos; requiere comprobación física antes de aplicar delays.
- Sin IA de alineación, colaboración cloud, webviewer remoto, sincronización
  inalámbrica ni aplicaciones nativas; no se anuncian funciones inexistentes.
