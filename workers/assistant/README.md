# BernAudio AI — Cloudflare Worker

El asistente de `app.html` envía únicamente un resumen numérico reducido a
`https://bernaudio-ai.eddyflores100.workers.dev/api/assistant`. No envía muestras
de audio, nombres de dispositivos ni identificadores de hardware.

## Arquitectura

- UI: `js/app/assistant.js` y estilos en `css/app.css`.
- API: `workers/assistant/src/index.mjs`.
- Inferencia: binding `AI` de Cloudflare Workers AI, modelo
  `@cf/qwen/qwen3.8-27b`.
- Endpoint de salud: `GET /health`.
- Chat: `POST /api/assistant`.

El asistente interpreta y explica. No cambia ajustes, no controla dispositivos,
no inicia señales y no ejecuta acciones en el equipo. Las recomendaciones son
orientativas y deben contrastarse con mediciones repetibles.

## Seguridad y privacidad

- Lista de orígenes permitidos: dominio publicado y localhost de desarrollo.
- Solo POST JSON para el chat; límite de tamaño, mensajes y caracteres.
- Roles admitidos: `user` y `assistant`; el cliente no puede inyectar un mensaje
  `system`.
- El Worker no guarda conversaciones ni mediciones.
- El navegador manda solo muestras numéricas resumidas, sin audio bruto ni IDs.
- No introduzcas información personal en las preguntas.

## Despliegue

El Worker ya se publicó en Cloudflare como `bernaudio-ai`, con binding `AI`. La subruta pública `workers.dev` del script está habilitada en el subdominio de la cuenta.
Para actualizarlo desde GitHub Actions, añade el secreto de repositorio
`CLOUDFLARE_API_TOKEN` con permisos para editar Workers. El workflow usa el
Account ID incluido como variable de despliegue no secreta y actualiza el Worker
cuando cambian sus fuentes en `main`.

El sitio estático conserva el dominio del archivo `CNAME` y la publicación de
GitHub Pages desde la rama principal. Al fusionar cambios en `main`, Pages
debe publicar la nueva versión automáticamente si el ajuste de Pages del repo
sigue apuntando a `main` y a la raíz.

## Pruebas

`npm test` incluye pruebas del Worker con un binding AI simulado; no generan
consumo de inferencia. La prueba de salud no llama al modelo. La validación
física de micrófonos e interfaces sigue siendo independiente.


## Contexto meteorológico de campo

La ruta `POST /api/environment` acepta latitud y longitud en un cuerpo JSON, no en la URL, para no incluir coordenadas en los registros de query strings. La observabilidad del Worker también redacta query strings. El Worker consulta WeatherAPI.com
desde el Worker y devuelve ubicación, fecha de captura, presión, temperatura,
humedad, viento y otros campos meteorológicos sanitizados. La clave debe quedar
en un secreto Cloudflare llamado `WEATHERAPI_KEY`. No se envía al navegador.
Si no está, devuelve `503 weather_not_configured`, sin afectar el chat AI ni
el analizador local.

El cliente solo solicita ubicación tras pulsar «Actualizar ambiente». Las
coordenadas de cada zona son opt-in y no se guardan automáticamente. Los datos
de clima son contexto externo; no se usan para cambiar niveles SPL, EQ, delay ni
aplicar correcciones físicas automáticas.
