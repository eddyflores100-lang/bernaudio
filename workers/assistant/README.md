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

El Worker ya se publicó en Cloudflare como `bernaudio-ai`, con binding `AI`.
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
