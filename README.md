# Edgerunners 2070 (`edgerunners-2070`)

Motor de reglas para **Foundry VTT 12** y el sistema **Cyberpunk RED – Core**, pensado para partidas ambientadas en los años 2070. Añade automatizaciones y herramientas de mesa sobre las fichas y tiradas de RED, sin modificar el sistema. No contiene objetos, actores, mapas ni textos comerciales: el contenido lo aportan otros módulos o el propio DJ mediante «capacidades» guardadas en los objetos.

Las herramientas del motor se abren desde el menú **«2070 ▾»** de la cabecera de la ficha: Equipo, Red y, para el DJ, Humanidad o Recargo según el tipo de actor. El menú admite teclado, Escape y clic fuera; sustituye los accesos separados para ahorrar espacio.

## Qué hace

**Veredicto de tiradas**
- Desplegable de dificultad (VD) en las tiradas de característica, habilidad y rol, con la tabla del libro. El chat indica éxito, fracaso, crítico o pifia. El empate falla, como en RED.
- Ataques contra un objetivo marcado: la VD se calcula por la distancia y la tabla de VD del arma. El defensor puede esquivar (REF 8 o más) o defenderse en cuerpo a cuerpo.
- Botón «Tirar daño» en la propia tarjeta, solo si el ataque impacta. En fuego automático pone el multiplicador según el margen del impacto, con el tope del arma.
- Herramientas del DJ: asignar el objetivo a posteriori y ajustar la tirada, la VD o la defensa. Todos ven los cambios.

**Ventana de ataque**
- Cobertura ligera (−1) o parcial (−2), como regla de la casa configurable.
- Rebote de las armas de potencia (−4; sin penalización en un tiro de precisión).
- Disparo cargado de las armas tecnológicas: la CP del objetivo cuenta a la mitad.
- Segundo intento con munición inteligente mejorada, solo si el ataque falla por 5 o menos.

**Armas y conversiones** (consola «Equipo 2070»)
- Bonificadores de daño crítico, daño por modo de disparo y armas inteligentes que exigen enlace (cable, empuñadura o neuropuerto).
- Armas cargables, consumo de munición por ataque, munición mínima para disparar, cerrojo manual y armas de varias recámaras.
- Requisitos de uso con herida crítica si no se cumplen, y elección de herida crítica tras un daño crítico.

**Ciberequipo**
- Exige neuropuerto para instalar (salvo equipo de grado médico), con requisitos y grupos exclusivos. El neuropuerto de creación es gratuito.
- Activaciones con coste de Humanidad, duración y enfriamiento.
- Características efectivas locales (p. ej., TCO para manejar armas o para el daño desarmado) e ignorar la penalización por heridas.

**Netrunning 2070** (consola «Red 2070»)
- Conexión al neuropuerto de un objetivo, a distancia o por cable, con alcance, cortafuegos y tirada para saber si el objetivo lo advierte.
- Arquitectura personal (barreras, hielo negro y nodo de control), apertura de brechas y hackeos rápidos.
- Expulsión de intrusos, desconexión segura o insegura, y contador de acciones NET por turno.
- Hackeo de dispositivos (cámaras, torretas, ascensores…) desde la misma consola: con ficha de dispositivo, o sin ficha eligiendo la VD. Cada cesión de un dispositivo controlable requiere que el DJ la autorice. «Solicitar control» permite pedirlo también por motivos ajenos al netrunning, sin tirada, alcance ni gasto NET.
- El jugador puede «Liberar» sus dispositivos. El DJ dispone de «Retirar control» en la consola, incluso si el personaje controlador ya no existe o el dispositivo está en otra escena. Las transferencias y retiradas restauran los permisos originales, incluidos los de los controladores anteriores.

**Drogas, Humanidad y compras**
- Drogas con efecto principal y duración, y tirada del efecto secundario al terminar.
- Consola de Humanidad para el DJ: incidentes de pérdida o ganancia y evaluación mensual.
- Aviso de qué aptitud de rol permite conseguir un artículo, y recargo de precio por tienda.

**Mesa**
- Efectos temporales (modificadores, heridas temporales, daño periódico, suspensión de implantes, inconsciencia…) que duran por asaltos o por tiempo de mundo.
- «Estilo de hoja» opcional: hoja original, hoja 2070 o hoja 2070 clara.
- **Modo seguro de tiradas:** interruptor del DJ que devuelve todas las tiradas al sistema base al momento.
- Las acciones que afectan a otros actores las valida y ejecuta el cliente del DJ.

## Cambios de la versión 0.6.1

- Menú único «2070» en las cabeceras de las fichas, con las herramientas disponibles para cada usuario.

- Aprobación explícita del DJ antes de conceder control; rechazar o cerrar conserva los permisos.
- Solicitud manual para cesiones fuera del netrunning y retirada exclusiva del DJ.
- Corrección de permisos persistentes al transferir un dispositivo entre jugadores, también en tokens sin enlazar. Se descartan autorizaciones pendientes si cambia el control o la propiedad.

Los dispositivos con control activo de 0.6.0 conservan la instantánea necesaria para restaurar sus permisos. Si ya se liberaron con aquella versión y perdieron esa instantánea, el DJ debe revisar manualmente cualquier permiso residual desde la configuración de propiedad de Foundry.

## Dependencias

| Tipo | Paquete | Versión |
|---|---|---|
| Plataforma | Foundry VTT | 12 (verificado 12.343) |
| Sistema | Cyberpunk RED – Core (`cyberpunk-red-core`) | verificado v0.92.4 |
| Módulo obligatorio | libWrapper (`lib-wrapper`) | cualquiera compatible con V12 |

**Se integra con (opcionales):**
- `edgerunners-mission-kit`: aporta las armas, conversiones, munición y ciberequipo con capacidades que este motor interpreta.
- `cyberpunk-tr-esp`: traducción de los compendios de RED. Respeta los nombres internos que usa el motor, como las tablas de VD.
- `cyberpunk-generador`: con este motor y el Mission Kit activos, ofrece la «Partida de Edgerunners».

**Lo necesitan:** `edgerunners-mission-kit` (obligatorio, 0.5.1 o posterior).

## Instalación

En Foundry, «Instalar módulo» → «URL del manifiesto»:

```
https://github.com/Ellyjah/cyberpunk-edgerunners/releases/latest/download/module.json
```

Activa también libWrapper en el mundo. La configuración del módulo (veredicto, cobertura, estilo de hoja, modo seguro…) está en «Configurar ajustes» → «Edgerunners 2070».

## Para desarrolladores

El esquema de capacidades, la API (`game.modules.get("edgerunners-2070").api`), los envoltorios de RED, las limitaciones conocidas y el historial detallado están en [DESARROLLO.md](DESARROLLO.md). Pruebas de lógica pura: `node --test "tests/*.test.mjs"` (Node 20 o superior).
