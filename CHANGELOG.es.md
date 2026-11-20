# Registro de cambios

Lo que cambia en cada versión de Nyra Bot. Las mismas notas en inglés están en [CHANGELOG.md](CHANGELOG.md).

## 0.9.5 · 2026-11-20

### Novedades
- Graba a la vez el audio de tu equipo y tu micrófono, para tener el audio de cualquier aplicación.
- Elige en Configuración qué micrófono usa Nyra.
- Escucha los audios del chat: al abrir uno aparece un reproductor.

### Arreglos
- «Automático» ya no se desactiva solo cuando eliges un modelo en otra ventana.
- La caja de texto ya no se queda esperando la respuesta a un comando que ya terminó.
- Cuando Nyra hace clic en tu pantalla, ya no lo confunde con su propia ventana si hay otra delante.

## 0.9.4 · 2026-11-17

### Novedades
- Los instaladores ahora tienen el aspecto de Nyra, en macOS, Windows y Linux.

### Mejoras
- Nyra elige mejor entre buscar en internet, su navegador y tu pantalla. Si le pides buscar algo en Chrome, abre el navegador en vez de buscar primero.

### Arreglos
- Detener una respuesta ahora también detiene al momento lo que Nyra estaba haciendo en tu pantalla.
- Cuando Nyra usa tu teclado, ya no escribe en su propia ventana. Te pide que primero hagas clic en tu app.
- Nyra ya no se queda congelada al cambiar el idioma de la interfaz.

## 0.9.3 · 2026-11-15

### Mejoras
- En macOS, Nyra ahora conserva sus permisos de pantalla, Accesibilidad y micrófono al actualizarse. Después de esta actualización te los pedirá una última vez.

## 0.9.2 · 2026-11-15

### Novedades
- Pulsa un diagrama o un gráfico de una respuesta para verlo en grande. Acerca con la rueda o pellizcando, arrastra para moverte y haz doble clic para encajarlo.
- Los bloques de código largos muestran solo sus primeras líneas hasta que los abres, y las líneas demasiado largas para el chat se pueden ajustar.

### Mejoras
- Las respuestas se leen mejor, con títulos más claros, separadores, tachado, listas de tareas con casillas en tu color de acento y diffs que sombrean las líneas añadidas y quitadas.
- Nyra encuentra las cosas con más precisión en pantallas grandes, como las 4K, cuando usa tu ratón y tu teclado.
- El icono de macOS ahora tiene el mismo tamaño que el de las demás apps del Dock.

### Arreglos
- Los números de las notas al pie te llevan a la nota y de vuelta, y ya no aparece encima un título en otro idioma. En un PDF se numeran y van al final.
- El modelo por defecto que eliges en la bienvenida se usa al momento, también en la barra rápida, sin reiniciar Nyra.

## 0.9.1 · 2026-11-15

### Mejoras
- Un nombre de modelo largo ya no ensancha la caja de mensajes: se corta con «…» y se ve entero al pasar el ratón.

### Arreglos
- La barra rápida ya no muestra una banda gris debajo en Windows.

## 0.9.0 · 2026-11-15

### Novedades
- Primera versión pública de Nyra Bot para macOS, Windows y Linux.
- Chatea con modelos locales (Ollama y LM Studio) o en la nube (Claude, OpenAI y Gemini), y cambia de modelo en mitad de una conversación.
- Conecta una carpeta para que el modelo lea tus archivos y proponga cambios que revisas antes de aplicarlos.
- El espacio Código, con proyectos, cambios pendientes y Git.
- Búsqueda en internet con las fuentes citadas, recuerdos, skills y conexiones MCP.
- Transcripción de audio y dictado en tu equipo.
- El navegador de Nyra, y ayuda en tu pantalla con el ratón y el teclado.
- Importa tus conversaciones de Claude Code, con sus archivos.
