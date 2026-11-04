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
