# Sala de Juntas (HTML/CSS/JS + Supabase)

Versión web estática: mismo backend Supabase (auth, tabla `reservations`, realtime).

## Configuración

1. En **`js/config.js`** sustituye `TU_ANON_KEY_AQUI` por tu clave anon de Supabase (Settings → API).
2. (Opcional) Copia `logo.png` a la carpeta **`assets/`** dentro de `web-static`.

## Probar en local

Abre `index.html` en el navegador o sirve la carpeta con un servidor local (ej. `npx serve .`).

## Desplegar en GitHub Pages

- Opción A: Sube el contenido de `web-static` a la raíz de tu repo (o a una carpeta `docs`) y activa Pages desde esa carpeta.
- Opción B: Usa el workflow que despliega esta carpeta (sin compilar Flutter).

La URL de la app será la de tu Pages (ej. `https://sistemastsjavier.github.io/Agenda_semanal_TS/`). Si está en un subpath, los enlaces ya son relativos.
