# BernAudio — paquete de demostración y entrega QA

Fecha de validación automatizada: 2026-11-12

## Enlaces de demostración

- Portada y vista ilustrativa: https://bernaudio.utalabs.tech/
- Analizador: https://bernaudio.utalabs.tech/app.html
- Simulador de subgraves: https://bernaudio.utalabs.tech/subs.html
- Código y pruebas: https://github.com/eddyflores100-lang/bernaudio

> La portada contiene una vista sintética para explicar la interfaz; no es una medición de micrófono. El analizador procesa una entrada real cuando se concede permiso. El simulador de subgraves calcula un modelo ideal de fuentes puntuales.

## Resultado de pruebas virtuales

La ejecución de GitHub Actions asociada al PR de validación completó los trabajos de Node.js 22 y Node.js 24. Ambos pasos de `npm test` y `npm run check` finalizaron correctamente.

En el registro detallado de Node.js 22:
- **98 pruebas aprobadas**
- **0 fallidas**
- Duración de la suite: aproximadamente 4,9 segundos

Cobertura observada:
- FFT, espectros, normalización de potencia y ponderaciones A/C.
- SPL/Leq, límites entre bloques de captura y cambios de ponderación.
- Retardo con correlación cruzada, polaridad y rechazo de señales ambiguas.
- Función de transferencia con señales emparejadas, fase, coherencia y delay.
- Deconvolución, respuesta al impulso, decaimiento y métricas acústicas estimadas.
- Lectura e interpolación de curvas de corrección.
- Generación WAV y exportaciones.
- Ciclo de vida del audio, permisos denegados, desconexión, cancelación y limpieza.
- Navegación, controles accesibles y simulación de arreglos de subgraves.

La integración automatizada utiliza un navegador simulado y señales deterministas/sintéticas. **No utiliza micrófonos, altavoces ni interfaces físicas** y no demuestra exactitud acústica absoluta.

## Cómo presentar la demo

1. Abre la portada y explica que el panel animado usa datos sintéticos.
2. Abre el simulador de subgraves y cambia configuración, frecuencia, vista y temperatura para mostrar cómo responde el modelo.
3. Abre el analizador. En un equipo de pruebas, usa HTTPS o localhost y concede el permiso de entrada.
4. Recorre SPL, RTA, espectrograma, transferencia, Delay Finder, impulso, generador y calibración.
5. Muestra las exportaciones CSV, JSON de sesión, PNG y WAV donde corresponda.
6. Deja claro qué módulos se están demostrando con hardware conectado y cuáles son solo simulación o cálculos relativos.

### Ejecutar una copia local

Desde la raíz del repositorio:

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`. Para la captura de micrófono usa localhost o HTTPS; abrir el HTML mediante `file://` no es un entorno válido para probar permisos de audio.

Para repetir la validación automatizada:

```bash
npm test
npm run check
```

## Guion para pruebas físicas

| ID | Prueba | Resultado que debe registrar el tester |
| --- | --- | --- |
| P01 | Permitir y denegar el micrófono | Inicio correcto o mensaje de permiso claro; sin captura fantasma |
| P02 | Cambiar de entrada y desconectarla | Parada controlada; no conservar lecturas como si siguiera activa |
| P03 | Captura mono | Canal real reportado como mono |
| P04 | Interfaz con dos entradas independientes | Canales reales reportados; comprobar TF y Delay dual |
| P05 | SPL y calibración | Registrar instrumento de referencia, offset y condiciones; no llamar certificado al resultado |
| P06 | RTA y espectrograma | Comparar tendencias con una señal de prueba conocida y anotar FFT/ponderación |
| P07 | Transferencia | Registrar ruta de referencia, magnitud, fase, coherencia y repetibilidad |
| P08 | Delay secuencial A/B | Repetir medición y documentar confianza, polaridad y diferencia temporal |
| P09 | Delay de dos canales | Verificar sincronía y entradas separadas; no usar el modo dual con una entrada mono |
| P10 | Respuesta al impulso | Registrar barrido, sample rate, latencia, ruido y repetibilidad |
| P11 | Exportaciones | Abrir CSV/JSON/WAV/PNG y confirmar que los metadatos corresponden a la sesión |
| P12 | Simulador de subs | Comparar geometría, polaridad y delays mostrados con los valores configurados |

Usa niveles de prueba moderados, comprueba el volumen de salida antes de reproducir y detén la señal si hay acople o comportamiento inesperado. No se necesita elevar el volumen para verificar la interfaz.

## Registro que debe entregar cada tester

```text
Fecha y hora:
Commit / versión de BernAudio:
Sistema operativo y versión:
Navegador y versión:
Equipo:
Interfaz / controlador:
Micrófono:
Frecuencia de muestreo:
Canales físicos disponibles:
Pruebas P01–P12 ejecutadas:
Resultado por prueba (PASS / FAIL / NOT TESTED):
Instrumento de referencia (si aplica):
Condiciones y configuración:
Incidencias y pasos para reproducir:
Archivos exportados (sin audio privado ni datos personales):
```

## Límites conocidos que deben comunicarse

- Un offset manual no equivale a una calibración acústica trazable.
- La curva de respuesta en frecuencia del micrófono no calibra por sí sola el SPL absoluto.
- Micrófonos integrados de móviles y tablets no deben asumirse como instrumentos de nivel absoluto.
- La transferencia y el delay dependen de la ruta de señal, sincronía, latencia y entradas disponibles.
- La respuesta al impulso y RT/EDT/T20/T30 son estimaciones sensibles al ruido, clipping, sala y procedimiento.
- El simulador de subs usa fuentes puntuales idealizadas; no modela completamente cajas, sala ni acoplamiento real.
- No se declara certificación metrológica ni compatibilidad física universal.

**Estado de entrega:** listo para que testers ejecuten el guion físico y devuelvan evidencias. La aceptación física queda pendiente de sus resultados por dispositivo y cadena concreta.
