# Sala de Juntas (TypeScript + Vite + Supabase)

Agenda web de la sala de juntas de **TACTICAL SUPPORT**: autenticación, horario diario, altas/bajas y actualizaciones en tiempo real.

## Requisitos

- Node.js 20+
- Proyecto Supabase con Auth y tabla `reservations`

## Configuración

1. Copia `.env.example` a `.env` y rellena:

```env
VITE_SUPABASE_URL=https://TU_PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=tu_anon_key
```

2. (Opcional) Coloca el logo en `public/assets/logo.png`.

3. (Recomendado) Ejecuta las políticas RLS de `supabase/rls.sql` en el SQL Editor de Supabase.

## Desarrollo

```bash
npm install
npm run dev
```

## Build / producción

```bash
npm run build
npm run preview
```

La salida queda en `dist/`. Puedes publicar esa carpeta en GitHub Pages, Netlify, Cloudflare Pages, etc.

## Estructura

```
src/
  app.ts              # UI, auth, reservas, realtime
  main.ts             # Entrada
  supabaseClient.ts   # Cliente Supabase
  types.ts
  lib/                # Fechas, horas, mailto, HTML
  styles/style.css
public/assets/        # Estáticos (logo)
supabase/rls.sql      # Políticas recomendadas
```

## Campos usados en `reservations`

| Campo | Uso |
|-------|-----|
| `fecha` | Día (YYYY-MM-DD) |
| `hora` / `hora_fin` | Inicio y fin del rango |
| `responsable` | Organizador |
| `asunto` | Título |
| `colaboradores` | Nombres de asistentes a la reunión |
| `participantes` | Invitados (correos) |
| `reservado_por` | Email del usuario autenticado (dueño) |

Si la tabla aún no tiene `colaboradores`, ejecuta `supabase/add_colaboradores.sql`.

Para la tablet (sincronización en vivo), ejecuta también `supabase/realtime.sql` para publicar `reservations` en Realtime.

Para evitar reservas duplicadas al guardar al mismo tiempo, ejecuta `supabase/create_reservation_safe.sql` (función atómica: el primero que guarda gana).
