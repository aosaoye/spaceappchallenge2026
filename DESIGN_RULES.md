# Reglas de Diseño y Arquitectura UI (`DESIGN_RULES.md`)

Este documento establece las reglas de diseño obligatorias para **SPHEREx Explorer**. Cualquier modificación o extensión de la interfaz debe cumplir estrictamente estos principios.

---

## 1. Modelo de Diseño Basado en Herencia (Cero Proliferación de Componentes)

1. **Prohibido crear componentes duplicados o paralelos**:
   - No se deben crear nuevos archivos de componentes para variantes de desplegables, menús flotantes, selectores o controles.
   - Todo selector o panel desplegable debe **heredar de [`CustomSelect.tsx`](file:///c:/Users/kali/Pictures/spaceappchallenge2026/frontend/app/components/CustomSelect.tsx)**.
2. **Herencia desde `CustomSelect`**:
   - `CustomSelect` actúa como la clase/componente base que define:
     - El botón disparador tipo píldora (`h-10 rounded-full px-4 border border-black/[.08] dark:border-white/[.145]`).
     - El icono `ChevronDown` perfectamente alineado con rotación suave (`rotate-180` al abrir).
     - El contenedor flotante (`rounded-2xl border p-1.5 shadow-xl`) con soporte `dropUp` y scroll estilizado (`custom-select-scroll`).
     - El cierre automático al hacer clic fuera (`mousedown`) o pulsar `Escape`.
   - Las variantes especializadas (listas de opciones simples, opciones con indicador de color `colorDot`, cabeceras de acción `headerContent` o paneles de ajustes compuestos mediante `children`) heredan directamente de `CustomSelect` sin crear nuevos componentes.

---

## 2. Reglas de los Selects (`CustomSelect`)

1. **Solo el nombre de la muestra (Sin subtítulos ni etiquetas dobles)**:
   - Las opciones de muestras y ejemplos deben mostrar **únicamente `label: target.name`** en una sola línea limpia (`WISE 0855`, `Estrella de Barnard`, `Epsilon Indi B`, etc.), sin subtítulos (`sublabel`), sin frases secundarias (`publicTitle`) y sin etiquetas que provoquen truncado o desbordamiento.
2. **Ítem activo limpio (Estilo Píldora)**:
   - La opción seleccionada destaca con fondo sólido inverso (`bg-foreground text-background`), bordes redondeados (`rounded-xl`), texto en una línea y el icono `Check` a la derecha.
3. **Prohibido el scroll horizontal y las flechas nativas**:
   - El contenedor del desplegable aplica `overflow-x-hidden` y la clase `.custom-select-scroll` (definida en [`globals.css`](file:///c:/Users/kali/Pictures/spaceappchallenge2026/frontend/app/globals.css)), que elimina las flechas nativas (`::-webkit-scrollbar-button { display: none; }`) y usa una barra vertical fina de `5px`.
4. **Variantes con icono (`iconOnly`) y FAB por herencia**:
   - Los desplegables secundarios en barras compactas y el botón flotante (**FAB**) de coordenadas heredan de `CustomSelect` mediante la propiedad `iconOnly`, evitando textos truncados (`Zoom y ...`, `Filtros y ajus...`).
5. **Uso obligatorio de `CustomSelect`**:
   - Queda prohibido usar `<select>` nativo del navegador o listas de botones apilados para elegir objetos, filtros, paletas o detectores.

---

## 3. Reglas de Controles, Inputs y Botones

1. **Geometría unificada (`rounded-full` / radio 100%)**:
   - Todos los botones, inputs de texto/número y disparadores de `CustomSelect` comparten la misma altura (`h-10` o `h-9` en controles compactos), el mismo padding horizontal (`px-4`) y `rounded-full`.
2. **Sliders de Zoom y Contraste**:
   - El control de zoom y contraste se realiza mediante deslizador personalizado (`input[type="range"]` con `accent-foreground`), sin botones de zoom sueltos en la cabecera superior.
3. **Tema Claro / Oscuro (`dark` / `light`)**:
   - Todos los elementos heredan las variables `--background` y `--foreground` con bordes `border-black/[.08]` en claro y `dark:border-white/[.145]` en oscuro.

---

## 4. Dualidad de Experiencia: «Modo Mi Abuela (Paseo Estelar)» vs «Modo Investigador (NASA)»

1. **Modo Paseo Estelar (`audienceMode === "public"`)**:
   - **Visor a pantalla completa (`100vh`)**: El lienzo del cielo ([`SkyVideoCanvas.tsx`](file:///c:/Users/kali/Pictures/spaceappchallenge2026/frontend/app/components/SkyVideoCanvas.tsx)) ocupa todo el viewport (`h-[calc(100vh-53px)] w-full`) para ofrecer la sensación inmersiva de dar un paseo por el espacio, sin paneles laterales ni bloques de texto técnico.
   - **Barra flotante inferior con desplegables heredados de `CustomSelect`**:
     1. **Selector de Estrella / Ejemplo**: `CustomSelect` limpio, en una sola línea y sin subtítulos.
     2. **Desplegable de Zoom y Contraste**: Hereda de `CustomSelect` (`dropUp`) y contiene los sliders de `Zoom · Campo de visión (FOV)` y `Contraste (asinh)`.
     3. **Desplegable de Filtros y Ajustes de Imagen**: Hereda de `CustomSelect` (`dropUp`) y contiene `Colección SPHEREx`, `Banda espectral`, `Paleta de color` y las casillas de verificación (`Retícula central`, `Rejilla WCS`, `Resaltar trayectoria / variabilidad`, `Comparar con AllWISE y Gaia`, `Apilar por detector`).
     4. **Desplegable de Detectores y Nitidez (D1–D6)**: Hereda de `CustomSelect` (`dropUp`) permitiendo activar `Apilar exposiciones por detector (Mejorar nitidez)` y elegir entre los 6 detectores (`6 Detectores (102 bandas)`, `D1`–`D6`) **sin párrafos de texto técnico**.
2. **Modo Investigador (`audienceMode === "researcher"`)**:
   - Conserva el panel lateral izquierdo completo, la telemetría científica, la comparación con Aladin Lite v3 / FITS→PNG, el panel espectral de 102 canales LVF ([`SpherexSpectrumPanel.tsx`](file:///c:/Users/kali/Pictures/spaceappchallenge2026/frontend/app/components/SpherexSpectrumPanel.tsx)) y el inspector FITS Multi-Extensión ([`FitsScientificInspector.tsx`](file:///c:/Users/kali/Pictures/spaceappchallenge2026/frontend/app/components/FitsScientificInspector.tsx)).
