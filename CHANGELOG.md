# Registro de cambios / Changelog

## 1.0.0 (2026-11-10)

Primera versión pública de **MRM Analysis Tool** y versión 2 de los scripts de rugosidad.

### Aplicación de escritorio (nueva)

- Cálculo autónomo del MRM (sin CloudCompare ni Python):
  - superficie de tendencia por Poisson (aproximación García-Noriega y Arias, 2026) o decimado QEM (Pires et al., 2014, 2015);
  - suavizado laplaciano equivalente al de CloudCompare;
  - distancias con signo nube-malla.
- Rugosidad residual local (Rqr) sobre el vecindario de dos anillos.
- Clasificación del Rqr: Jenks (6 clases, conceptualización de Pétrequin et al., 2012b), auto-k y μ ± σ (en prueba). Escala por pieza o común (en prueba).
- Análisis por lotes de varios artefactos, vista en cuadrícula con cámaras sincronizadas y panel de comparación (tabla, distribución por clases, diagramas de caja, histogramas).
- Unidad del modelo estimada automáticamente, con aviso y confirmación; reescalado a partir de la longitud, anchura y/o espesor reales de la pieza.
- Exportación a PLY (campos escalares para CloudCompare, con el factor de conversión a mm en la cabecera), CSV (separador `;` y coma decimal, para Excel en español) y proyectos `.mrm`.
- Figuras para publicación: pieza individual o conjunto en PNG/JPG (≥ 300 ppp) con leyenda de color y barra de escala métrica (proyección ortográfica, recorte al contorno de la pieza); gráficos de comparación en PNG/JPG/SVG. Números con coma decimal en español.
- Interfaz en español e inglés, con mensajes de error traducidos.
- Seguridad: funcionamiento sin conexión, interfaz servida desde un esquema privado (`app://`) y aislada, bloqueo de red, permisos y lectura de archivos locales, enlaces externos limitados a DOI/GitHub/ORCID/Creative Commons, validación de todas las peticiones al proceso principal y de los archivos de entrada (modelos y proyectos), protección del CSV frente a fórmulas, *Electron fuses* endurecidos.
- Protección de datos: confirmación antes de cerrar con artefactos procesados sin guardar; mensajes claros si un archivo no se puede leer o guardar (abierto en otro programa, sin permiso, disco lleno, demasiado grande).
- Rendimiento: el visor 3D solo dibuja cuando algo cambia (uso de CPU/GPU en reposo de ≈ 84 % de un núcleo a ≈ 0 % con cuatro modelos en la cuadrícula) y libera la memoria gráfica al cambiar de artefacto.
- Visor: los colores (MRM, Rqr, clases) se conservan al volver desde las vistas Original o Tendencia, y el modelo y la iluminación se mantienen al alternar rápidamente entre Visor y Cuadrícula (las geometrías compartidas entre vistas ya no se liberan al cerrar una de ellas; las vistas cuyo contexto gráfico descarta el navegador se recrean solas).
- Accesibilidad: contraste del texto secundario conforme a WCAG AA, foco visible con teclado, nombres accesibles en campos y botones, diálogos que se cierran con Escape; la ventana se adapta a pantallas pequeñas o con escalado alto.
- Aviso si la malla tiene vértices que no pertenecen a ninguna cara.
- Pruebas automáticas (`npm test`, `npm run test:e2e`) y validación frente a CloudCompare/CloudComPy (`npm run validate:cloudcompare`).

### Scripts de rugosidad v2 (`mrm_roughness.py`, `mrm_roughness_cloudcompy.py`)

- Jenks exacto (Fisher-Jenks por programación dinámica) por defecto, independiente de las unidades del modelo e idéntico a la aplicación.
- Modo `JENKS_METHOD = "legacy"` que reproduce el algoritmo v1 y los valores publicados. La v1 usaba una tolerancia absoluta de 0,0001 que, con modelos en metros, detenía el ajuste tras una iteración.

### Scripts auxiliares de CloudComPy

- `install_cloudcompy.ps1`: instalación en `C:\CloudComPy` con comprobación de la firma del instalador de Python y del archivo descargado.
- `run_mrm_cloudcompy.bat` y `run_rqr_cloudcompy.bat`: lanzadores de los dos scripts (carpetas configurables con `CLOUDCOMPY_DIR` y `VENV_DIR`).

## Scripts v1

Versión utilizada en García-Noriega y Arias (2026), *Trabajos de Prehistoria* 83(2): 1109. Los scripts de MRM (`mrm_cloudcompare.py`, `mrm_cloudcompy.py`) se mantienen sin cambios; los de rugosidad v1 se conservan en el historial del repositorio ([commit 5fa4d58](https://github.com/cgarnor/M.-R.-M.-La-Riera/tree/5fa4d586651f55ca8430493df8194cd45b17ca23)).
