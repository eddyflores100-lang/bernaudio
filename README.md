# BernAudio Model 80

Herramientas web de análisis de audio y simulación de arreglos de subgraves.
HTML, CSS y JavaScript, con procesamiento de audio local mediante Web Audio.

- [Analizador de audio](app.html)
- [Simulador de subgraves](subs.html)
- [Sitio publicado](https://bernaudio.utalabs.tech)

## Herramientas

| Módulo | Uso y límites |
| --- | --- |
| RTA | Espectro por bandas, promediado y picos de la entrada seleccionada. |
| Espectrograma | Evolución de frecuencia y nivel, dibujada en Canvas 2D. |
| SPL | Fast/Slow y Leq integrados sobre el tiempo de audio capturado. El nivel absoluto requiere calibrar toda la cadena con una referencia conocida. |
| Transferencia | Magnitud, fase y coherencia con referencia interna o referencia cableada al canal 2. |
| Delay Finder | Estimación temporal con capturas secuenciales o dos entradas independientes. Revisa la correlación antes de interpretar el resultado. |
| Impulso | Estimación mediante barrido; sensible al ruido, la latencia y el procesamiento del dispositivo. |
| Corrección del micrófono | Importación de curva de frecuencia. La curva no calibra por sí sola el nivel SPL absoluto. |
| Generador | Ruido, tono y barrido. Empieza con un nivel de salida bajo. |
| Arreglos de subgraves | Modelo de fuentes puntuales con mapas, polar y delays. No incluye la respuesta completa de cajas ni de salas. |

La portada muestra una **simulación con datos sintéticos**. Abre `app.html` para
analizar una entrada real y `subs.html` para configurar una simulación de subgraves.

## Ejecutar localmente

No hace falta compilar la aplicación. Desde la raíz del repositorio:

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`. El micrófono necesita HTTPS o localhost y permiso del
usuario. No abras la app directamente mediante `file://`.

Para comprobar el proyecto con Node.js y npm:

```bash
npm test
npm run check
```

Después de modificar CSS o JavaScript, ejecuta `npm run version-assets` y guarda
los cambios de las páginas antes de publicar. Los identificadores de contenido
evitan reutilizar código de audio anterior desde la caché del navegador/CDN.

La aplicación se puede servir en un alojamiento estático. Para GitHub Pages, el
contenido está en la raíz y `CNAME` contiene el dominio personalizado. Cambia ese
archivo si publicas una copia en otro dominio.

## Preparar una medición

1. Selecciona la entrada y comprueba que la señal no satura.
2. Carga la curva del micrófono si está disponible; calibra por separado el nivel
   si necesitas interpretar SPL absoluto.
3. Para transferencia de dos canales, conecta una referencia por cable al canal 2
   y verifica que el navegador entrega entradas independientes.
4. Empieza las señales de prueba con poco nivel y verifica la salida física antes
   de aumentarlo.
5. Contrasta los resultados y conserva las exportaciones que necesites.

La selección de dispositivo, el número de canales, la frecuencia de muestreo, la
latencia y el procesamiento automático dependen del navegador, el sistema y el
hardware. Los dispositivos móviles pueden imponer límites adicionales.
BernAudio no es un sonómetro certificado ni garantiza precisión instrumental.

## Captura y exportaciones

La captura utiliza `AudioWorklet` cuando está disponible. Si no puede cargarse,
utiliza una ruta de compatibilidad con `ScriptProcessor` en el hilo principal;
esta ruta puede ser más sensible a la carga de la interfaz. La app informa del
motor activo y comprueba los canales reportados por la entrada antes de permitir
los modos de dos canales. Seleccionar «2 canales» no garantiza que el dispositivo
los entregue.

Las lecturas aparecen como estimadas hasta que el usuario realiza o declara la
calibración de nivel. Esa declaración debe revisarse al iniciar otra captura o
cambiar la entrada o la ganancia. No es una certificación del instrumento.

El CSV de SPL incluye la fecha de exportación, la duración medida, ponderación,
respuesta temporal, offset, estado de calibración declarado y tiempos relativos
de las muestras del historial. El informe de sesión JSON añade la frecuencia de
muestreo, los canales, la ruta de captura y la curva de corrección disponible.

## Datos y privacidad

El código procesa las muestras en el navegador y no incorpora envío de audio ni
mediciones a un servidor. La calibración de nivel y la curva del micrófono pueden
persistir en `localStorage`; se eliminan borrando los datos del sitio. Las
exportaciones se descargan al dispositivo.

Cargar el sitio realiza solicitudes al alojamiento y a Google Fonts. No hay un
modo de instalación sin conexión ni se garantiza la recarga sin red. Consulta
[Privacidad](privacy.html), [Términos](terms.html) y [Licencias](licencias.html).

## Código

- `js/app/`: motor de audio, DSP y módulos del analizador.
- `js/subarray.js` y `js/subarray-ui.js`: modelo y controles del simulador.
- `js/main.js`: navegación y visualizaciones sintéticas de la portada.
- `css/`: estilos de portada, aplicación, simulador y documentos legales.

Reporta problemas en [GitHub Issues](https://github.com/eddyflores100-lang/bernaudio/issues)
con navegador, sistema, interfaz y pasos para reproducirlos. No incluyas datos
personales ni grabaciones sensibles en incidencias públicas.

Código bajo [MIT](LICENSE), © 2026 Alicelabs LLC. La licencia no concede derechos
sobre las marcas del proyecto; consulta el aviso de marca incluido en `LICENSE`.
