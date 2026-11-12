# Protocolo de validación con hardware real

Este protocolo complementa `npm test` y `npm run check`. Las pruebas automatizadas verifican algoritmos y fronteras simuladas; no demuestran por sí solas la exactitud de una cadena acústica física.

## 1. Registrar la cadena

Para cada ejecución, anota:

- Fecha, versión/commit de BernAudio y navegador con versión.
- Sistema operativo y dispositivo (PC, tablet o móvil).
- Interfaz de audio, firmware/controlador y frecuencia de muestreo.
- Micrófono, número de serie y archivo de corrección utilizado.
- Ganancia física, alimentación phantom si corresponde, filtros y procesamiento del sistema.
- Calibrador acústico y referencia utilizada, si se dispone de uno.

No publiques números de serie, nombres personales ni grabaciones privadas en incidencias públicas.

## 2. Verificar captura

1. Concede permiso de micrófono y selecciona explícitamente la entrada.
2. Confirma que la frecuencia de muestreo y el número de canales mostrados corresponden a la configuración real.
3. Comprueba que mono se identifica como mono aunque la interfaz solicite estéreo.
4. Desconecta la interfaz durante la captura: la aplicación debe detenerse y comunicarlo sin conservar una lectura como si siguiera activa.
5. Cambia de entrada y vuelve a iniciar: la calibración de nivel anterior debe quedar invalidada para evitar reutilizar un offset que quizá ya no corresponda.

## 3. Verificar nivel y calibración

- Distingue la corrección de respuesta en frecuencia del micrófono de la calibración de sensibilidad absoluta. Son operaciones distintas.
- Si se dispone de calibrador acústico, realiza la calibración en el nivel de referencia indicado por su fabricante y registra el valor aplicado.
- Repite la lectura sin cambiar la cadena; registra dispersión y estabilidad.
- Cambia la ganancia física o el dispositivo y confirma que se vuelve a exigir una verificación del nivel.
- Compara Leq y respuesta temporal con un instrumento de referencia adecuado. Registra duración, ponderación y condiciones de la señal.

No interpretes un offset escrito manualmente como una calibración certificada. Los micrófonos integrados de teléfonos y tablets no deben asumirse como instrumentos de SPL absoluto.

## 4. Verificar transferencia y delay

- Usa una interfaz que exponga dos entradas independientes; comprueba el canal 1 y el canal 2 por separado.
- Para transferencia con loopback, documenta la ruta exacta de salida y retorno, y evita que el retorno sature.
- Comprueba coherencia, estabilidad de fase y repetibilidad antes de guardar una traza.
- Introduce un retardo conocido en una ruta de prueba segura y verifica el signo y magnitud del resultado.
- Repite la medición varias veces. Una correlación débil o ambigua debe considerarse inválida, no una recomendación de alineación.

## 5. Verificar respuesta al impulso

- Usa un nivel de prueba moderado y verifica la ruta de salida antes de iniciar.
- Registra frecuencia de muestreo, duración del barrido, nivel y posición de micrófono/altavoz.
- Repite la captura y compara el pico principal y las reflexiones visibles.
- Comprueba que ruido, clipping o una captura incompleta no produzcan métricas de RT/EDT/T20/T30 presentadas como válidas.

## 6. Verificar simulador de subgraves

- Contrasta la geometría, separación, polaridad y delays exportados con la configuración introducida.
- Comprueba que los resultados se etiquetan como niveles relativos de un modelo ideal de fuentes puntuales.
- No traslades delays calculados directamente a un sistema real sin medición y validación física.

## 7. Matriz mínima de compatibilidad

| Plataforma | Captura | Estéreo / loopback | UI y exportación |
| --- | --- | --- | --- |
| Windows + Chrome/Edge | Pendiente de validar por versión | Pendiente con interfaz 2×2 | Verificar |
| macOS + Safari/Chrome | Pendiente de validar por versión | Pendiente con interfaz 2×2 | Verificar |
| Linux + Chrome/Firefox | Pendiente de validar por versión | Pendiente con interfaz 2×2 | Verificar |
| iPadOS + Safari | Pendiente de validar por modelo | Depende de interfaz y permisos | Verificar orientación/táctil |
| Android + Chrome | Pendiente de validar por modelo | Depende de interfaz y permisos | Verificar suspensión y audio |

Una fila solo debe marcarse como validada cuando exista evidencia reproducible de un dispositivo físico concreto. No extrapoles un resultado de escritorio a todos los móviles.

## 8. Plantilla de resultado

```text
Commit:
Fecha/hora:
Sistema / versión:
Navegador / versión:
Interfaz / firmware:
Micrófono:
Frecuencia de muestreo:
Canales reportados:
Motor de captura (AudioWorklet/compatibilidad):
Calibración de frecuencia:
Referencia de nivel:
Prueba realizada:
Instrumento de comparación:
Resultado / dispersión:
Incidencias:
Evidencia (sin datos personales):
```

## Criterio de aceptación

Una medición se considera repetible solo si la cadena está documentada, la señal no satura, la calibración aplicable está vigente y las repeticiones concuerdan dentro de una tolerancia definida previamente para el instrumento y el procedimiento. Este protocolo no convierte BernAudio en un sonómetro certificado.
