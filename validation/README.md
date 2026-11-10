# Validación / Validation

Programas para comprobar la aplicación. Se ejecutan desde la carpeta del repositorio, después de `npm install`.

| Orden | Qué comprueba | Datos necesarios | Duración |
|---|---|---|---|
| `npm test` | Motor, formatos de archivo y funciones del proceso principal (esquema `app://` sin acceso fuera de la interfaz, enlaces permitidos, nombres de archivo, errores de escritura): lectura de OBJ/PLY/STL (incluidos archivos dañados), Rqr frente a una implementación directa de la definición, suavizado laplaciano, Fisher-Jenks exacto frente a la solución óptima por fuerza bruta, percentiles como numpy, auto-k, μ ± σ, escala común, CSV (coma decimal, protección frente a fórmulas), proyectos `.mrm` (ida y vuelta y rechazo de archivos dañados o manipulados), metadatos de resolución PNG/JPEG, mensajes de error. | Ninguno | segundos |
| `npm run test:e2e` | La aplicación de escritorio completa: reconstrucción de Poisson con `PoissonRecon.exe`, errores traducidos, unidades estimadas y confirmación, clasificaciones, figuras PNG/JPG/SVG, CSV, proyectos, cancelación de un cálculo en curso, cámaras sincronizadas en la cuadrícula (arrastre real del ratón), aviso de trabajo sin guardar, diálogos accesibles y comprobaciones de seguridad (sin Node.js en la interfaz, red y archivos locales bloqueados, esquema `app://`, argumentos validados por el proceso principal). Al final mide el tiempo de arranque, el uso de CPU en reposo y la memoria. | Ninguno (genera modelos sintéticos) | ≈ 1 min |
| `npm run test:packaged` | El mismo recorrido sobre el ejecutable empaquetado (`release/win-unpacked`, tras `npm run electron:build`): comprueba además los *fuses* de Electron, la integridad de `app.asar`, el `PoissonRecon.exe` incluido y la edición con teclado sin menú de aplicación. Requiere Node.js ≥ 22. | Ninguno | ≈ 1 min |
| `npm run validate:cloudcompare -- <modelo.obj> <referencia_MRM_mesh_Rqr.ply> [modelo_sin_escalar.obj]` | Tabla «Validación» del README: Rqr y clases de la aplicación sobre los residuos de CloudCompare, flujo completo frente a CloudCompare y reescalado por dimensiones reales. | Modelo de `data/` y resultado de los scripts de CloudComPy | ≈ 1–3 min |

## Resultado de referencia (`validate:cloudcompare`, azuela de La Riera)

```
A. 423224 vertices, 846300 faces
   Rqr (app) vs Rqr (CloudComPy): max relative difference 6.0e-8
   Rqr_Jenks (jenks, legacy): identical classes in 100.000 % of the vertices
   Rqr_Auto (autok, legacy): identical classes in 100.000 % of the vertices
   Rqr_Sigma (sigma): identical classes in 100.000 % of the vertices

B. Full app pipeline (Poisson, default parameters of the article)...
   vertex correspondence: max coordinate difference 2.4e-7 · model unit: m
   residuals: r = 0.975
   Rqr:       r = 0.989
   Rqr mean 0.0164 mm (CloudCompare 0.0165 mm) · σ 0.0122 mm (CloudCompare 0.0124 mm)

C. Unscaled model + real dimensions (length, width, thickness of the scaled model, in mm)...
   real dimensions 118.16 × 49.88 × 30.84 mm · scale applied 1 unit = 18.3794 mm
   Rqr mean 0.01639 mm (scaled model: 0.01639 mm)
   common-scale Jenks classes identical in 96.106 % of the vertices
```

El archivo de referencia (`Azuela_LaRiera_S_MRM_mesh_Rqr.ply`) se obtiene con `CloudComPy\run_mrm_cloudcompy.bat data\Azuela_LaRiera_S.obj` y después `CloudComPy\run_rqr_cloudcompy.bat data\Azuela_LaRiera_S_MRM_mesh.ply`, usando los scripts de rugosidad v1 o la v2 con `JENKS_METHOD = "legacy"` (las clases de referencia son las del algoritmo v1). También se adjunta a la Release de GitHub.

Las diferencias del apartado B se deben a que el muestreo de puntos de CloudCompare es aleatorio (el de la aplicación es determinista, con semilla) y a que la reconstrucción de Poisson depende de esa muestra.

> `validate:cloudcompare` y `test:e2e` ejecutan `PoissonRecon.exe`; en algunos entornos con restricciones (antivirus, ejecución aislada) puede ser necesario permitirlo.

---

*English:* `npm test` runs the engine and file-format tests (no data needed); `npm run test:e2e` runs the whole desktop application on synthetic models; `npm run validate:cloudcompare -- <model.obj> <reference_MRM_mesh_Rqr.ply> [unscaled_model.obj]` reproduces the validation table of the README against CloudCompare/CloudComPy. The reference output above was obtained with the La Riera adze.
