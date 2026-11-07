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

## Estado actual: 0.5.3 (M3–M6, auditorías de Codex, estilo de hoja 2070 y veredicto de tiradas)

- **0.5.3:** botón «Tirar daño» en la franja del veredicto, en lugar de la gota de RED (que queda oculta); lo ven el dueño del atacante y el DJ cuando hay impacto o el ataque no tiene objetivo. Sin cambios de reglas.
- **0.5.2:** veredicto de tiradas (`scripts/verdict.js`, `styles/verdict.css`).
  - **Tiradas generales** (característica, habilidad y rol): desplegable «Dificultad (VD)» en la ventana de RED, con la tabla del Libro de reglas (9–29, *Asequible 13* por defecto) y «Sin VD (enfrentada)». Con Ctrl + clic no hay VD. El chat muestra éxito, fracaso, éxito crítico, «crítico… pero fracaso», pifia y «éxito pese a la pifia». Hay que superar la VD; el empate falla.
  - **Ataques con un objetivo marcado:**
    - la VD se calcula por distancia con la tabla de VD del arma de RED, y la ventana muestra objetivo, distancia y VD;
    - a distancia, si el objetivo tiene REF 8 o más, su propietario (o el DJ) elige «Usar VD» o «Esquivar»; con REF menor se usa la VD sin preguntar;
    - en cuerpo a cuerpo, el propietario pulsa «Defenderse (DES + Evasión)» y el DJ también puede usar una VD;
    - la esquiva es la tirada normal de RED del defensor, y el atacante tiene que superarla;
    - la gota de daño de RED se sustituye por un botón «Tirar daño» en la franja, visible para el dueño del atacante y el DJ solo cuando hay impacto (o si el ataque no tiene objetivo);
    - en fuego automático se muestra el margen sobre la VD.
  - **Herramientas del DJ** (iconos mínimos en todas estas tarjetas): asignar o cambiar el objetivo a posteriori, y ajustar la tirada (modificador o total final, VD y defensa). Los cambios son visibles para todos. Si el veredicto cambia tras tirar el daño, la tarjeta lo avisa.
  - El estado se guarda en la bandera del mensaje. Las decisiones de los jugadores las escribe el DJ activo tras comprobar que el jugador es propietario del objetivo. RED no se modifica.
- **0.5.1:** correcciones de la segunda auditoría de Codex (A050-01–A050-04): el DJ solo despacha solicitudes y manejadores registrados con clave propia (un nombre heredado como `constructor` se rechaza); un efecto temporal desactivado con su casilla nativa deja de actuar (retira sus estados, guarda sus Items temporales, levanta sus suspensiones de implantes y no hace daño periódico ni operaciones al caducar) y al reactivarlo vuelve a actuar; al desactivar el módulo desde su gestor, los efectos se suspenden antes de guardar y de ofrecer la recarga; rótulos del PNJ legibles con el tema. El ajuste del tema pasa a ser el desplegable **Estilo de hoja**: *Mantener hoja original*, *Hoja 2070* (sigue el modo claro u oscuro de RED, con paleta 2070 oscura propia) y *Hoja 2070 clara* (fondo claro aunque RED esté en modo oscuro). El valor de la casilla de 0.5.0 se conserva (activada → *Hoja 2070 clara*).
- **0.5.0:** correcciones de la auditoría independiente de Codex (R01–R05): el DJ solo acepta solicitudes tipadas y comprueba quién las envía (identidad que añade el servidor de Foundry) y las operaciones salen del propio Item; los estados y recursos de un efecto se limpian una sola vez en cualquier retirada (caducidad, borrado manual o borrado del Item origen) sin quitar estados ajenos o sostenidos por otro efecto; las mutaciones de PD, Humanidad y turno se hacen en serie; al desactivar el módulo sus efectos se suspenden y al reactivarlo se restauran. **Tema 2070** opcional (ajuste del DJ para todos): paleta amarillo y verde de las hojas del Mission Kit y fuentes libres Rajdhani y Saira Condensed (OFL), sin cambiar la distribución de las hojas de RED.
- **0.4.1:** todas las tiradas contra VD del módulo (cortafuegos, brechas, hackeos, segundo intento, efecto secundario) siguen la regla de RED: hay que superar la VD; el empate falla.
- **Requisitos:** Foundry V12 (verificado 12.343), sistema `cyberpunk-red-core` (verificado v0.92.4) y módulo `lib-wrapper`.
- **Capacidades (M3):** pestaña **2070** en la hoja de cualquier Item con las capacidades detectadas y su validación; editor JSON (solo DJ) que valida antes de guardar.
- **Netrunning (M4):** botón **Red 2070** en la cabecera de la hoja de personaje o PNJ, que abre una consola con:
  - Conexión al neuropuerto del objetivo marcado, a distancia o por cable: alcance según el equipo (capacidades `deck-range`, `deck-port`, `cable-link` o ajustes de mundo), muros, cortafuegos según el rango y tirada para saber si el objetivo lo advierte (Interface contra VOL; los netrunners siempre lo saben).
  - Arquitectura personal calculada: barreras por cada `self-ice`, hielo negro del ciberterminal conectado al puerto y nodo de control. **Abrir brecha** contra cada barrera; el DJ marca el hielo negro como superado tras resolverlo con las reglas de RED. El cable salta las barreras, pero no el hielo negro.
  - **Hackeos rápidos** definidos como Items del mundo con la capacidad `quickhack`: rango mínimo, un intento por objetivo y turno, Suerte y modificadores.
  - Expulsión de intrusos (VOL + Concentración contra Interface), desconexión segura, y desconexión insegura con bloqueo de 60 minutos si se sale del alcance o se suelta el cable.
  - Contador de acciones NET por turno (progresión de RED, +1 por cable y capacidades `net-actions`), que también cuenta las aptitudes de Interface lanzadas desde la ficha de RED y avisa al superar el máximo.
- **Armas y conversiones (M5):** botón **Equipo 2070** en la cabecera de la hoja de personaje o PNJ. Las capacidades pueden estar en el arma o en las mejoras (`itemUpgrade`) instaladas en ella:
  - `crit-bonus-damage` suma al +5 de RED en las heridas críticas; `mode-damage` cambia el daño según el modo (p. ej., tiro de precisión).
  - `ricochet`: el jugador prepara el rebote en la consola, el DJ lo autoriza y el siguiente ataque lleva su modificador (no en tiros de precisión, si así se indica).
  - `smart-weapon`: bloquea el ataque sin cable personal, empuñadura o neuropuerto (o lo que diga su `requires`); con munición `enhanced-smart-ammo`, ofrece en el chat un segundo intento si el fallo no supera el margen.
  - `chargeable`: carga desde la consola (con su duración); el siguiente ataque aplica `whileCharged` (consumo, CP del objetivo por `ignoreArmorPercent` de RED, avisos de CdT y cobertura) y la carga se gasta al disparar o al final de ese turno (`release`).
  - `ammo-per-attack`, `min-ammo-to-fire`, `bolt-action` y `multi-chamber` (cada recámara con su munición; RED ve en el cargador el total cargado).
  - `user-requirement`: al usar el arma sin cumplir la condición, aplica la herida crítica indicada salvo que ya la tenga.
  - `crit-choose`: tras un daño crítico, el atacante tira varias veces en la tabla de heridas de RED y elige; el DJ la aplica a los objetivos marcados.
- **Ciberequipo (M5):** requisito de neuropuerto para instalar (salvo `medical-grade`), requisitos `requires` y exclusividad por `exclusiveGroup`; neuropuerto de creación (`creationFree`) gratuito, sin pérdida ni reducción de Humanidad máxima; `activation` con coste de Humanidad, duración, enfriamiento y operaciones; `effective-stat` local (manejar armas, daño desarmado, y presas o forzar objetos preparándola en la consola) sin cambiar la característica ni los derivados; `ignore-wound-state` anula la penalización de estado de heridas.
- **Drogas (M6):** capacidad `drug` en Items de droga de RED. Al consumir (desde la ficha de RED o por API) se aplican sus operaciones `primary`; con `duration`, un efecto marca el efecto principal y otra dosis lo prolonga. Al terminar, se desactivan los ActiveEffects de RED de la droga y se tira el efecto secundario (VOL + Resistir torturas/drogas + 1d10, hay que superar la VD) con `secondary.onFail` u `onPass`. `humanity-revert` deshace el cambio de Humanidad de la droga; `on-expire` aplica operaciones al caducar si nadie retira antes el efecto.
- **Humanidad (M6, solo DJ):** botón **Humanidad 2070** en la hoja: incidentes de pérdida o ganancia (1d6–3d6, con motivo) y evaluación mensual por efectos ambientales (pérdidas primero, ganancias después, propuesta de «buena vida»). Usa el registro y la Humanidad máxima nativos de RED; el módulo nunca decide si corresponde un incidente.
- **Roles y compra (M6):** al comprar en una tienda de RED (actor contenedor), aviso al DJ y al comprador de qué aptitud de rol permite conseguir el artículo aunque no esté disponible (ajuste de mundo `roleAcquisition`, editable; no bloquea). Botón **Recargo 2070** en la hoja de la tienda (DJ): multiplicador del precio de compra (`Actor.F.vendor.buyMultiplier`); no cambia el precio del objeto ni la reventa.
- **Ampliaciones compatibles del esquema v1:** capacidades `tag` y `mode-damage`; parámetros `release` (`chargeable`) y `stackKey`/`minStack` (`effective-stat`); condiciones `actorHasTag`, `actorHasCyberwareType`, `anyOf`, `allOf` y `scope` en `statAtLeast`; operaciones `ignore-wound-state`, `humanity-revert` y `on-expire`; `drug.secondary` = `{ dv, skill, onFail, onPass }`.
- **Operaciones de efecto:** `stat-mod`, `move-mod` (con `formula` como reducción), `temp-injury`, `direct-damage` (inmediato o al final de cada turno del objetivo), `suspend-cyberware`, `control` (aviso manual), `eject-chip`, `unconscious` (termina al recibir daño), `initiative-top`, `extra-action`, `humanity` (registro nativo de RED), `self-damage-from-humanity` e `ignore-wound-state`. Duran por asaltos en combate y por tiempo de mundo fuera de él. Las aplica el cliente del DJ (los jugadores las solicitan por socket).
- **Envoltorios de RED (libWrapper):** `CPRItem.prototype.createRoll` y `confirmRoll` (armas, munición y contador NET), `CPRActor.prototype.installCyberware`, `_calcMaxHumanity`, `getWoundStateMods` y `createRoll`, el consumo de drogas (`snort`, clase obtenida de un documento temporal), `CPRContainerActorSheet.prototype._purchaseItem`, y `CPRActiveEffect.prototype.determineSuppression` (implantes suspendidos). Los ActiveEffects del módulo se crean con la API de documento para evitar un fallo de `createEmbeddedDocuments` de RED 0.92.4 con las hojas de PNJ abiertas.
- **Limitaciones conocidas:** la línea de visión se comprueba contra muros (el DJ arbitra el resto); activar programas no cuenta como acción NET; el catálogo de hackeos solo lee Items del mundo, no compendios; los PNJ en escena deben abrirse desde su token. En armas multirecámara hay que cargar desde la consola 2070 (la recarga de RED no conoce las recámaras); la CdT, la cobertura atravesada, las siluetas y la acción de movimiento al cargar son avisos para el DJ; el segundo intento pide la VD original al jugador.
- **Datos:** `flags["edgerunners-2070"] = { schemaVersion: 1, capabilities: [...] }`. Al desactivar el módulo, estos datos quedan inertes y los ActiveEffects temporales del módulo se suspenden (se restauran al reactivarlo). **Limitación:** si se desinstala el módulo o se arranca sin módulos sin desactivarlo antes, sus efectos temporales activos no se suspenden; antes de desinstalarlo, el DJ puede ejecutar `game.modules.get("edgerunners-2070").api.suspendAllCarriers()`.
- **Seguridad:** las acciones que afectan a otros actores las ejecuta el cliente del DJ tras validar la solicitud; las tiradas de dados se hacen en el cliente de quien actúa, como en el resto de Foundry y de RED.
- **API para importadores:** `game.modules.get("edgerunners-2070").api` → `schemaVersion`, `validate(itemOrData)`, `migrate(data)`, `getCapabilities(item)`; para el DJ, `suspendAllCarriers()` y `restoreSuspendedCarriers()`.

### Pruebas

Lógica pura del esquema, con datos sintéticos: `node --test "tests/*.test.mjs"` (Node 20 o superior). Las pruebas en Foundry están descritas en `../03-coordinacion/PRUEBAS.md`.

*Contenido no oficial, no aprobado ni respaldado por R. Talsorian Games.*
