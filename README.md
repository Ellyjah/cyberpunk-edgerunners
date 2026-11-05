# 01 — Módulo técnico reutilizable y potencialmente público

## Misión

Añadir a **Cyberpunk RED – Core** estructuras de datos, automatizaciones y UI opcional para partidas ambientadas en los años 2070. **No hay contenido comercial preinstalado**. El módulo no crea Items, Actores, PNJ, mapas ni compendios del *Mission Kit* al habilitarse.

## Lo que sí puede incluir

- `module.json` compatible con Foundry V12 y dependencia **real** del sistema instalado, tras verificar su `id`.
- Código JavaScript y plantillas originales necesarias para comportamientos configurables.
- Esquema de `flags`/datos adicionales versionado y documentación de API.
- Automatizaciones genéricas de conectividad, alcance, modificación de blindaje, munición, acciones, daños, efectos temporales, netrunning y Humanidad.
- Interfaz y CSS originales, opcionales, sin logos o activos de CD Projekt/RTG.
- Fixtures y tests inventados para comprobar operadores genéricos.
- Un aviso visible de contenido no oficial si se prepara distribución, conforme a la política aplicable.

## Lo que no puede incluir

- Registros de armas, implantes o hackeos comerciales del suplemento.
- Fichas, estadísticas completas, tablas, aventuras, mapas, tokens, imágenes y PDFs de material de terceros.
- Copias del código del sistema RED – Core si su licencia y el método de integración no lo autorizan.
- Un estilo que copie fuentes, marcas, logos o identidad gráfica protegida del anime o del videojuego.

## Condición de aceptación

Al habilitarlo sobre RED – Core en un **World vacío**, debe aparecer su configuración y ser posible crear un **Item genérico de prueba** mediante las capacidades del módulo. No deben aparecer objetos comerciales en compendios, barras laterales o inventarios.

La fuente autorizada para las reglas está documentada en `../03-coordinacion/REGLAS.md`; los contratos técnicos en `../03-coordinacion/CONTRATOS.md`. Inspeccionar API y código real antes de escribir implementaciones concretas.

## Estado actual: 0.2.0 (M4 — netrunning 2070)

- **Requisitos:** Foundry V12 (verificado 12.343), sistema `cyberpunk-red-core` (verificado v0.92.4) y módulo `lib-wrapper`.
- **Capacidades (M3):** pestaña **2070** en la hoja de cualquier Item con las capacidades detectadas y su validación; editor JSON (solo DJ) que valida antes de guardar.
- **Netrunning (M4):** botón **Red 2070** en la cabecera de la hoja de personaje o PNJ, que abre una consola con:
  - Conexión al neuropuerto del objetivo marcado, a distancia o por cable: alcance según el equipo (capacidades `deck-range`, `deck-port`, `cable-link` o ajustes de mundo), muros, cortafuegos según el rango y tirada para saber si el objetivo lo advierte (Interface contra VOL; los netrunners siempre lo saben).
  - Arquitectura personal calculada: barreras por cada `self-ice`, hielo negro del ciberterminal conectado al puerto y nodo de control. **Abrir brecha** contra cada barrera; el DJ marca el hielo negro como superado tras resolverlo con las reglas de RED. El cable salta las barreras, pero no el hielo negro.
  - **Hackeos rápidos** definidos como Items del mundo con la capacidad `quickhack`: rango mínimo, un intento por objetivo y turno, Suerte y modificadores.
  - Expulsión de intrusos (VOL + Concentración contra Interface), desconexión segura, y desconexión insegura con bloqueo de 60 minutos si se sale del alcance o se suelta el cable.
  - Contador de acciones NET por turno (progresión de RED, +1 por cable y capacidades `net-actions`), que también cuenta las aptitudes de Interface lanzadas desde la ficha de RED y avisa al superar el máximo.
- **Operaciones de efecto:** `stat-mod`, `move-mod` (con `formula` como reducción), `temp-injury`, `direct-damage` (inmediato o al final de cada turno del objetivo), `suspend-cyberware`, `control` (aviso manual), `eject-chip`, `unconscious` (termina al recibir daño), `initiative-top` y `extra-action`. Duran por asaltos en combate y por tiempo de mundo fuera de él. Las aplica el cliente del DJ (los jugadores las solicitan por socket). `humanity` y `self-damage-from-humanity` llegan en M5/M6.
- **Envoltorios de RED (libWrapper):** `CPRItem.prototype.confirmRoll` (contador NET) y `CPRActiveEffect.prototype.determineSuppression` (implantes suspendidos). Los ActiveEffects del módulo se crean con la API de documento para evitar un fallo de `createEmbeddedDocuments` de RED 0.92.4 con las hojas de PNJ abiertas.
- **Limitaciones conocidas:** la línea de visión se comprueba contra muros (el DJ arbitra el resto); activar programas no cuenta como acción NET; el catálogo de hackeos solo lee Items del mundo, no compendios; los PNJ en escena deben abrirse desde su token.
- **Datos:** `flags["edgerunners-2070"] = { schemaVersion: 1, capabilities: [...] }`. Al desactivar el módulo, estos datos quedan inertes.
- **API para importadores:** `game.modules.get("edgerunners-2070").api` → `schemaVersion`, `validate(itemOrData)`, `migrate(data)`, `getCapabilities(item)`.

### Pruebas

Lógica pura del esquema, con datos sintéticos: `node --test "tests/*.test.mjs"` (Node 20 o superior). Las pruebas en Foundry están descritas en `../03-coordinacion/PRUEBAS.md`.

*Contenido no oficial, no aprobado ni respaldado por R. Talsorian Games.*
