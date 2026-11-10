# M.R.M. La Riera · MRM Analysis Tool

**Modelo de Residuo Morfológico (MRM) y rugosidad residual local (Rqr) aplicados a la macroindustria lítica.**

Repositorio asociado al artículo:

> García-Noriega, C. y Arias, P. (2026). Aplicación de la técnica de Modelo de Residuo Morfológico (MRM) a la macroindustria lítica: el caso de la azuela pulimentada de La Riera (Llanes, Asturias). *Trabajos de Prehistoria*, 83(2): 1109. <https://doi.org/10.3989/tp.2026.1109>

Contiene:

1. **Scripts en Python** para [CloudCompare](https://www.cloudcompare.org/) (plugin de Python) y [CloudComPy](https://github.com/CloudCompare/CloudComPy), con los que se realizaron los análisis del artículo.
2. **MRM Analysis Tool**, una aplicación de escritorio para Windows, autónoma (no requiere CloudCompare ni Python), que integra el cálculo del MRM y de la rugosidad sobre uno o varios modelos 3D y permite compararlos.
3. **Datos**: el modelo fotogramétrico escalado de la azuela de La Riera (`data/Azuela_LaRiera_S.obj`, con su material `.mtl` y su textura `.jpg`; almacenado con Git LFS; licencia CC BY 4.0).
4. **Validación**: pruebas automáticas y comparación numérica con CloudCompare/CloudComPy (`validation/`).

*English summary at the end of this document.*

---

## Estructura

```
├── Pythonplugin/                    # Ejecutar DENTRO de CloudCompare (Plugins > Python)
│   ├── mrm_cloudcompare.py          #   MRM (variante por decimado + suavizado laplaciano), v1
│   └── mrm_roughness.py             #   Rqr + clasificación (v2)
├── CloudComPy/                      # Ejecutar FUERA de CloudCompare, con CloudComPy
│   ├── mrm_cloudcompy.py            #   MRM (Sample Points > Poisson > Laplaciano > C2M), procedimiento del artículo, v1
│   ├── mrm_roughness_cloudcompy.py  #   Rqr + clasificación (v2)
│   ├── run_mrm_cloudcompy.bat       #   Lanzador del MRM (activa el entorno de CloudComPy)
│   ├── run_rqr_cloudcompy.bat       #   Lanzador de la rugosidad (activa el entorno de CloudComPy)
│   └── install_cloudcompy.ps1       #   Instalador de CloudComPy para Windows
├── data/                            # Modelo de la azuela de La Riera (Git LFS)
│   ├── Azuela_LaRiera_S.obj         #   Malla (423 224 vértices, 846 300 caras, en metros)
│   ├── Azuela_LaRiera_S.mtl
│   └── Azuela_LaRiera_S.jpg         #   Textura
├── docs/METODOLOGIA.md              # Descripción detallada de los cálculos
├── validation/                      # Pruebas automáticas y validación frente a CloudCompare
├── src/                             # Código de la aplicación (TypeScript)
│   ├── engine/                      #   Motor MRM + Rqr (independiente de la interfaz)
│   ├── workers/                     #   Cálculo en segundo plano
│   ├── state/                       #   Artefactos, cola de proceso, clasificación, exportaciones
│   └── components/                  #   Interfaz (visor 3D, cuadrícula, comparación, paneles)
├── native/win-x64/                  # PoissonRecon.exe (M. Kazhdan, licencia MIT)
├── electron-main.cjs, preload.cjs   # Contenedor de escritorio (Electron)
├── CITATION.cff, LICENSE, LICENSE-DATA.md, THIRD_PARTY_NOTICES.md, CHANGELOG.md
└── package.json
```

> Para descargar el modelo de `data/` hay que tener instalado [Git LFS](https://git-lfs.com/) (`git lfs install` antes de clonar), o descargar los archivos desde la web de GitHub.

---

## 1. Aplicación de escritorio (MRM Analysis Tool)

### Instalación

Descarga el instalador `MRM-Analysis-Tool-Setup-x.y.z.exe` desde la sección **Releases** del repositorio y ejecútalo. Windows 10/11 de 64 bits.

> El instalador no está firmado digitalmente: Windows SmartScreen puede mostrar un aviso («Más información» → «Ejecutar de todas formas»). Para comprobar que el archivo es el publicado, compara su huella SHA-256 con la del archivo `SHA256SUMS.txt` de la misma Release:
>
> ```powershell
> Get-FileHash .\MRM-Analysis-Tool-Setup-1.0.0.exe -Algorithm SHA256
> ```

### Uso

1. **Añadir modelos**: uno o varios archivos OBJ, PLY o STL (o arrastrarlos a la lista). Cada pieza se procesa en segundo plano. Los archivos dañados o que no son mallas trianguladas se indican con un mensaje de error.
2. **Escala**: la aplicación **estima** la unidad del modelo (m, cm, mm o µm) a partir de su tamaño y lo indica como «unidad estimada» en la lista y en la ficha del artefacto. Comprueba las dimensiones en mm y pulsa **Confirmar unidad**, cambia la unidad o introduce la **longitud, anchura y/o espesor reales** (mm): en ese caso el modelo se reescala para ajustarse a esas medidas. La estimación puede equivocarse en piezas muy pequeñas (≈ 1,5–6 cm modeladas en mm), por eso debe confirmarse siempre.
3. **Visor**: original, superficie de tendencia, MRM, Rqr continuo y clases Rqr. Escala de color de azul (más pulido) a rojo (menos pulido).
4. **Clasificación** del Rqr (ver tabla) y **Comparación** entre piezas: tabla de estadísticos, distribución por clases, diagramas de caja e histogramas.
5. **Exportar**:
   - **PLY** con campos escalares (`MRM_Residuals`, `Rqr`, `Rqr_Jenks`, `Rqr_Auto`, `Rqr_Sigma`) que se abre en CloudCompare, y superficie de tendencia (PLY). Como en CloudCompare, las coordenadas y los campos `MRM_Residuals` y `Rqr` del PLY están en las **unidades del modelo original**; la cabecera del archivo indica el factor de conversión a milímetros (`1 model unit = … mm`), que incluye el reescalado por dimensiones reales.
   - **Tabla CSV** (valores en mm): separador `;`, **coma decimal** y codificación UTF-8, de modo que se abre directamente en Excel en español. En R: `read.csv2()`; en Python: `pandas.read_csv(f, sep=';', decimal=',')`.
   - **Proyectos `.mrm`** con los modelos procesados, sus resultados y sus fichas.
6. **Figuras para publicación** (botones *Exportar figura* y *Exportar figuras*):
   - pieza individual (Visor) o conjunto (Cuadrícula, hasta 9 piezas), en PNG o JPG, a 300 ppp o más, con la leyenda de la escala de color de la vista seleccionada (MRM, Rqr o clases) y una **barra de escala métrica**;
   - proyección ortográfica desde la vista actual (escala exacta), recorte al contorno de la pieza y, en la cuadrícula, la misma escala para todas las piezas;
   - gráficos de la comparación (distribución por clases, diagramas de caja, histogramas) en PNG, JPG o **SVG** vectorial, y la tabla de datos en CSV;
   - ancho en cm (8,5 / 12 / 17,5 cm o libre), tamaño de letra en puntos, fondo blanco, negro o transparente. La resolución se guarda en los metadatos del archivo. Los números usan coma decimal en español y punto en inglés.

Todos los valores de la interfaz, de las figuras y del CSV se expresan en **milímetros**. Interfaz en español e inglés.

> Los parámetros del MRM y de la clasificación no se conservan al cerrar la aplicación (vuelven a los valores del artículo); sí se conservan en los proyectos `.mrm`. Los vértices que no pertenecen a ninguna cara tienen Rqr = 0, como en los scripts de CloudCompare, y la ficha del artefacto avisa si existen.

### Superficie de tendencia

| Método | Pasos | Valores por defecto |
|---|---|---|
| **Poisson** (aproximación García-Noriega y Arias, 2026) | Muestreo de puntos sobre la malla → reconstrucción de superficie de Poisson (Kazhdan y Hoppe, 2013) → suavizado laplaciano → distancia con signo nube-malla | 10 % de los vértices; octree 8; 1,5 muestras/nodo; peso 2; 20 iteraciones; factor 0,2 |
| **Decimado QEM** (Pires et al., 2014, 2015) | Decimado por colapso de aristas (métrica cuádrica) → suavizado laplaciano → distancia con signo | 10 % de los triángulos; 20 iteraciones; factor 0,2 |

Después: suavizado de fronteras de signo (como el script de CloudComPy) y **Rqr** = raíz cuadrática media de los residuos respecto a su media local en el vecindario de dos anillos de cada vértice.

### Clasificación del Rqr

| Método | Descripción |
|---|---|
| **Jenks (6)** | Seis clases (R1–R6) por cortes naturales de Fisher-Jenks (Fisher, 1958; Jenks, 1977): conceptualización de los grados de pulido de Pétrequin et al. (2012b) en 6 clases para la macroindustria lítica pulimentada (García-Noriega y Arias, 2026). Algoritmo exacto por defecto; la opción «Compatibilidad scripts v1» reproduce los valores publicados. |
| **Auto-k** | Jenks con número de clases (2–10) elegido por el método del codo sobre el GVF. |
| **μ ± σ** *(en prueba)* | Umbrales μ−2σ, μ−σ, μ−0,5σ, μ+0,5σ y μ+σ, planteados para comparar conjuntos. |

**Escala**: *por pieza* (umbrales de la distribución de cada artefacto) o *común* *(en prueba)*: umbrales de la distribución conjunta de las piezas comparadas, con el mismo peso para cada una.

> **En prueba.** La clasificación μ ± σ y la escala común están pensadas para comparar conjuntos. Hasta comprobar que funcionan correctamente en el estudio de conjuntos arqueológicos completos, sus resultados deben tomarse con cautela. Como se indica en el artículo, la comparación entre piezas requiere establecer una escala de referencia a partir de muestras experimentales y arqueológicas.

### Validación (azuela de La Riera, 423 224 vértices / 846 300 caras)

| Comprobación | Resultado |
|---|---|
| Rqr calculado sobre los residuos de CloudCompare | diferencia relativa máxima 6·10⁻⁸ |
| Clases Jenks *legacy*, auto-k y μ ± σ frente a CloudComPy | idénticas vértice a vértice (100 %) |
| Flujo completo de la aplicación frente a CloudCompare | residuos r = 0,975; Rqr r = 0,989; Rqr medio 0,0164 mm (CloudCompare 0,0165), σ 0,0122 mm (0,0124) |
| Modelo sin escalar + dimensiones reales introducidas | Rqr medio 0,01639 mm (modelo escalado: 0,01639 mm); clases Jenks en escala común idénticas en el 96,1 % de los vértices (las diferencias se concentran junto a los umbrales) |

La tabla se reproduce con `npm run validate:cloudcompare -- data/Azuela_LaRiera_S.obj Azuela_LaRiera_S_MRM_mesh_Rqr.ply [modelo_sin_escalar.obj]`, donde el segundo archivo es el resultado de los scripts de CloudComPy sobre el modelo (`run_mrm_cloudcompy.bat` y después `run_rqr_cloudcompy.bat` con los scripts v1, o con la v2 y `JENKS_METHOD = "legacy"`; también se adjunta a la Release). Detalles en [`validation/README.md`](validation/README.md).

### Seguridad y privacidad

- La aplicación **no se conecta a Internet** ni envía datos: todo el cálculo es local. La ventana bloquea cualquier petición de red, permiso (cámara, micrófono, etc.), navegación o ventana emergente; los enlaces del cuadro «Acerca de» (DOI, repositorio) se abren en el navegador del sistema.
- La interfaz se sirve desde un esquema privado (`app://mrm`), no desde `file://`, se ejecuta aislada (*sandbox*, sin acceso a Node.js ni a los archivos del equipo) y solo puede pedir al proceso principal unas pocas operaciones —reconstrucción de Poisson, guardar un archivo, guardar varios en una carpeta elegida y avisar de que hay trabajo sin guardar—, cuyos argumentos se validan. El ejecutable empaquetado tiene desactivadas las opciones que permitirían usarlo como intérprete de Node.js y comprueba la integridad de su código (*Electron fuses*).
- Los modelos y proyectos `.mrm` recibidos de terceros se validan antes de usarse (índices, tamaños, valores numéricos, textos y parámetros). Las celdas de texto del CSV que empiezan por `=`, `+`, `-` o `@` se exportan como texto para que Excel no las ejecute como fórmulas.
- Si se intenta cerrar la ventana con artefactos procesados que no se han guardado en un proyecto, la aplicación pide confirmación. Los errores al guardar (archivo abierto en otro programa, carpeta sin permiso, disco lleno) se muestran con un mensaje.

Ver también [SECURITY.md](SECURITY.md).

### Compilar desde el código

Requiere [Node.js](https://nodejs.org/) ≥ 20.19 y Windows.

```bash
npm install
npm run electron:dev      # compila y abre la aplicación
npm test                  # pruebas automáticas del motor y de los formatos de archivo
npm run test:e2e          # prueba completa de la aplicación de escritorio
npm run lint              # comprobación de tipos
npm run electron:build    # tipos + pruebas + instalador de Windows en release/
npm run test:packaged     # prueba completa del ejecutable empaquetado (Node.js ≥ 22)
```

---

## 2. Scripts en Python (CloudCompare / CloudComPy)

**Dentro de CloudCompare** (plugin de Python):

1. Cargar la malla y seleccionarla en el árbol de la base de datos.
2. *Plugins → Python → Run Script* → `Pythonplugin/mrm_cloudcompare.py` (añade el campo `MRM_Residuals`).
3. Con la malla seleccionada, ejecutar `Pythonplugin/mrm_roughness.py`.

**Con CloudComPy** (fuera de CloudCompare; procedimiento del artículo):

```bat
powershell -ExecutionPolicy Bypass -File CloudComPy\install_cloudcompy.ps1
CloudComPy\run_mrm_cloudcompy.bat data\Azuela_LaRiera_S.obj
CloudComPy\run_rqr_cloudcompy.bat data\Azuela_LaRiera_S_MRM_mesh.ply
```

El instalador deja CloudComPy y su entorno de Python 3.12 en `C:\CloudComPy`. Si ya tienes CloudComPy en otra carpeta, define antes las variables `CLOUDCOMPY_DIR` (carpeta de CloudComPy312) y `VENV_DIR` (entorno de Python). El primer lanzador genera `<modelo>_MRM.ply` (nube), `<modelo>_MRM_mesh.ply` (malla con `MRM_Residuals`) y `<modelo>_MRM_trend.ply`; el segundo, `<modelo>_MRM_mesh_Rqr.ply`.

Los scripts de rugosidad generan los campos `Rqr`, `Rqr_Jenks`, `Rqr_Sigma` y `Rqr_Auto`.

**Versiones de los scripts**

- `mrm_cloudcompare.py` y `mrm_cloudcompy.py` se conservan **sin cambios** respecto a la versión 1 utilizada en el artículo. El comentario de cabecera de `mrm_cloudcompare.py` menciona un decimado QEM, pero el procedimiento que implementa (y que se describe en [METODOLOGIA](docs/METODOLOGIA.md)) es un decimado por agrupación de vértices en rejilla (*vertex clustering*).
- La **versión 1 de los scripts de rugosidad**, tal como se usaron en el artículo, está en el historial del repositorio: [commit 5fa4d58](https://github.com/cgarnor/M.-R.-M.-La-Riera/tree/5fa4d586651f55ca8430493df8194cd45b17ca23).
- **Versión 2 de los scripts de rugosidad**:
  - `JENKS_METHOD = "exact"` (por defecto): Fisher-Jenks exacto por programación dinámica sobre 4000 cuantiles. No depende de las unidades del modelo y da los mismos cortes que la aplicación.
  - `JENKS_METHOD = "legacy"`: algoritmo de la versión 1, que reproduce los valores publicados. La v1 detenía el ajuste con una tolerancia absoluta de 0,0001. Con modelos en metros, los valores de Rqr son menores que esa tolerancia, así que el ajuste se detenía tras una iteración y daba clases casi de igual tamaño.

---

## Declaraciones

### Declaración de uso de inteligencia artificial

Los autores declaran que no se utilizaron herramientas de inteligencia artificial generativa en la elaboración del código en Python empleado para los análisis presentados en García-Noriega y Arias (2026) (versión 1 de los scripts de `Pythonplugin/` y `CloudComPy/`). Los scripts de la versión 1 que se incluyen en el repositorio (`mrm_cloudcompare.py`, `mrm_cloudcompy.py`) se conservan sin modificaciones.

Para la adaptación de ese código a la aplicación en entorno TypeScript/JavaScript (`src/`, `electron-main.cjs`, `preload.cjs`), para la versión 2 de los scripts de rugosidad (`mrm_roughness.py`, `mrm_roughness_cloudcompy.py`), para los scripts auxiliares de instalación y ejecución de CloudComPy (`install_cloudcompy.ps1`, `run_mrm_cloudcompy.bat`, `run_rqr_cloudcompy.bat`), para las pruebas y la validación (`validation/`) y para la documentación de este repositorio se han utilizado como herramientas de apoyo:

- el modelo de inteligencia artificial Claude Opus 4.7, desarrollado por Anthropic, en su versión de pago, desde marzo de 2026;
- el entorno de desarrollo Google Antigravity (Google), con modelos Gemini (Google) y Claude (Anthropic), en octubre de 2026.

Su asistencia se ha limitado a tareas de apoyo en la adaptación, estructuración, depuración y documentación del código, y en la preparación de pruebas de comprobación numérica frente a los resultados de CloudCompare/CloudComPy. Estas herramientas no han intervenido en el diseño metodológico, la obtención o interpretación de los resultados del artículo ni en la validación científica de los procedimientos, que corresponden a los autores.

### Fuentes de financiación

Este trabajo no ha recibido financiación específica de agencias del sector público, sector comercial o entidades sin ánimo de lucro.

### Declaración de contribución de autoría

- **Carlos García-Noriega** ([ORCID 0000-0002-3827-4643](https://orcid.org/0000-0002-3827-4643)): conceptualización, análisis formal, investigación, metodología, redacción (borrador original), software.
- **Pablo Arias** ([ORCID 0000-0003-0481-7563](https://orcid.org/0000-0003-0481-7563)): conceptualización, redacción (revisión y edición).

### Declaración de conflicto de intereses

Los autores declaran que no tienen ningún conflicto de intereses financiero o personal que haya podido influir en el trabajo descrito.

---

## Cómo citar

Si utilizas este código o la aplicación, cita el artículo:

> García-Noriega, C. y Arias, P. (2026). Aplicación de la técnica de Modelo de Residuo Morfológico (MRM) a la macroindustria lítica: el caso de la azuela pulimentada de La Riera (Llanes, Asturias). *Trabajos de Prehistoria*, 83(2): 1109. <https://doi.org/10.3989/tp.2026.1109>

Los metadatos de cita están en [`CITATION.cff`](CITATION.cff) (botón «Cite this repository» de GitHub).

## Licencia

- **Código** (scripts y aplicación): licencia **MIT** ([LICENSE](LICENSE)). La aplicación incluye componentes de terceros con sus propias licencias, todas de código abierto (ver [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)), entre ellos PoissonRecon © Michael Kazhdan (MIT).
- **Datos** (modelo 3D de `data/`: `Azuela_LaRiera_S.obj`, `.mtl` y `.jpg`): licencia **CC BY 4.0** ([LICENSE-DATA.md](LICENSE-DATA.md)), la misma que el artículo. Pueden reutilizarse libremente citando el artículo.

## Referencias

- Fisher, W. D. (1958). On Grouping for Maximum Homogeneity. *Journal of the American Statistical Association*, 53(284), pp. 789-798. https://doi.org/10.1080/01621459.1958.10501479
- García-Noriega, C. y Arias, P. (2026). *Trabajos de Prehistoria*, 83(2): 1109. https://doi.org/10.3989/tp.2026.1109
- Jenks, G. F. (1977). *Optimal Data Classification for Choropleth Maps*. Occasional Paper No. 2. Lawrence, KS: Department of Geography, University of Kansas.
- Kazhdan, M. y Hoppe, H. (2013). Screened Poisson Surface Reconstruction. *ACM Transactions on Graphics*, 32(3), 29.
- Pétrequin, P., Cassen, S., Gauthier, E., Klassen, L., Pailler, Y., Sheridan, A. y Fábregas Valcarce, R. (2012b). Typologie, chronologie et répartition des grandes haches alpines en Europe occidentale. En: Pétrequin, P., Cassen, S., Errera, M., Klassen, L., Sheridan, A. y Pétrequin, A.-M. (Eds.). *JADE: Grandes haches alpines du Néolithique européen. Ve et IVe millénaires av. J.-C.* Les Cahiers de la MSHE C.N. Ledoux, 17. Besançon: Presses Universitaires de Franche-Comté, Centre de Recherche Archéologique de la Vallée de l'Ain, vol. 2, pp. 574-727.
- Pires, H., Gonçalves Seco, L., Fonte, J., Correia Santos, M. J. y Sousa, O. (2014). Morphological Residual Model: A Tool for Enhancing Epigraphic Readings of Highly Erosioned Surfaces. *Information Technologies for Epigraphy and Cultural Heritage*. Studi Umanistici - Serie Antichistica. Sapienza Università Editrice, pp. 133-144.
- Pires, H., Martínez Rubio, J. y Elorza Arana, A. (2015). Techniques for revealing 3D hidden archaeological features: Morphological residual models as virtual-polynomial texture maps. *The International Archives of the Photogrammetry, Remote Sensing and Spatial Information Sciences*, XL-5/W4, pp. 415-420. https://doi.org/10.5194/isprsarchives-XL-5-W4-415-2015

---

## English summary

Repository of García-Noriega & Arias (2026), *Trabajos de Prehistoria* 83(2): 1109 (<https://doi.org/10.3989/tp.2026.1109>). It contains the Python scripts for CloudCompare/CloudComPy used in the article (the v1 MRM scripts are kept unchanged; the roughness scripts are v2, whose `legacy` mode reproduces v1, and v1 is preserved in [commit 5fa4d58](https://github.com/cgarnor/M.-R.-M.-La-Riera/tree/5fa4d586651f55ca8430493df8194cd45b17ca23)), the scaled photogrammetric model of the La Riera adze (`data/Azuela_LaRiera_S.obj`, Git LFS), and **MRM Analysis Tool**, a standalone Windows application that computes the Morphological Residue Model (Poisson trend surface following García-Noriega & Arias 2026, or QEM decimation following Pires et al. 2014, 2015) and the local residual roughness Rqr for one or many 3D models. It classifies Rqr with Jenks (6 classes, a conceptualisation of the polishing grades of Pétrequin et al. 2012b), auto-k, or μ ± σ (testing), and compares artefacts. The μ ± σ classification and the common scale are still being tested for complete archaeological assemblages. The model unit is estimated automatically and must be confirmed (or real dimensions entered). Exported PLY files keep the original model units (the mm factor is written in the header); the CSV uses `;` and decimal comma. The application works offline, runs sandboxed and validates every input file. Automated tests (`npm test`, `npm run test:e2e`) and a numerical comparison with CloudCompare (`npm run validate:cloudcompare`) are included in `validation/`. Generative AI tools were used as support to adapt the original Python code into the application, for the v2 roughness scripts, the CloudComPy helper scripts, the tests and the documentation (see the AI statement above). Licence: MIT (code), CC BY 4.0 (data).
