# Metodología de cálculo

Este documento describe los cálculos que realizan la aplicación **MRM Analysis Tool** y los scripts en Python del repositorio. El fundamento metodológico y la discusión arqueológica están en García-Noriega y Arias (2026), *Trabajos de Prehistoria* 83(2): 1109 (<https://doi.org/10.3989/tp.2026.1109>).

## 1. Modelo de Residuo Morfológico (MRM)

El MRM (Pires et al., 2014, 2015) construye una **superficie de tendencia** que conserva la forma general de la pieza pero no los detalles de pequeña escala, y calcula para cada vértice de la malla original su **distancia con signo** a esa superficie. Los residuos positivos quedan por encima de la tendencia (convexidades) y los negativos por debajo (concavidades).

### 1.1 Superficie de tendencia por Poisson (aproximación García-Noriega y Arias, 2026)

Es el procedimiento del artículo (script `CloudComPy/mrm_cloudcompy.py` y opción por defecto de la aplicación):

| Paso | Operación | Parámetros por defecto |
|---|---|---|
| 1 | Muestreo de puntos sobre la malla, con normales | 10 % del número de vértices |
| 2 | Reconstrucción de superficie de Poisson con apantallamiento (Kazhdan y Hoppe, 2013) | profundidad de octree 8; 1,5 muestras por nodo; peso de interpolación 2; contorno de Neumann |
| 3 | Suavizado laplaciano de la malla reconstruida | 20 iteraciones; factor 0,2 |
| 4 | Distancia con signo nube-malla (vértices originales → tendencia) | — |

La aplicación incluye el ejecutable oficial de PoissonRecon (la misma biblioteca que usa el plugin de CloudCompare) y reproduce el suavizado laplaciano de CloudCompare (`ccMesh::laplacianSmooth`). El muestreo de puntos es determinista (semilla configurable), de modo que los resultados son reproducibles.

### 1.2 Superficie de tendencia por decimado QEM (Pires et al., 2014, 2015)

Alternativa basada en la simplificación de la malla original: decimado por colapso de aristas con métrica de error cuádrica (conservando por defecto el 10 % de los triángulos), seguido del mismo suavizado laplaciano y del cálculo de distancias.

> El script `Pythonplugin/mrm_cloudcompare.py` (plugin de Python dentro de CloudCompare) sigue esta segunda vía, con un decimado por agrupación de vértices en rejilla (10 %) y un suavizado laplaciano de 3 iteraciones con factor 1,0. (Su comentario de cabecera, que se conserva sin cambios como el resto de la versión 1, menciona un decimado QEM.)

### 1.3 Suavizado de fronteras de signo

Como en el script de CloudComPy, si un vértice tiene signo contrario al de más del 60 % de sus vecinos inmediatos, su residuo se sustituye por la media de los vecinos. Así se eliminan inversiones de signo aisladas. Se puede desactivar en la aplicación.

## 2. Rugosidad residual local (Rqr)

Para cada vértice *i* se toma su vecindario de dos anillos en el grafo de la malla, N₂(i) = {i} ∪ {vecinos de i} ∪ {vecinos de los vecinos de i}, y se calcula la raíz cuadrática media de los residuos respecto a su media local:

$$
R_{qr}(i) = \sqrt{\frac{1}{|N_2(i)|} \sum_{j \in N_2(i)} \left(r_j - \bar{r}_{N_2(i)}\right)^2}
$$

donde *r_j* es el residuo del vértice *j*. El Rqr se expresa en las unidades del modelo y la aplicación lo convierte a milímetros.

## 3. Clasificación del Rqr

Todas las clases se numeran de R1 (rugosidad residual más baja, superficies más regularizadas o pulidas, en azul) a Rk (rugosidad más alta, en rojo).

### 3.1 Jenks (6 clases)

Seis clases (R1–R6): conceptualización de los grados de pulido de Pétrequin et al. (2012b) en 6 clases para la macroindustria lítica pulimentada (García-Noriega y Arias, 2026). R1 corresponde a la rugosidad residual muy baja, R2 a la baja, R3 a la media-baja, R4 a la media-alta, R5 a la alta y R6 a la muy alta.

Los cortes se obtienen con el algoritmo de **Fisher-Jenks** (Fisher, 1958; Jenks, 1977), que minimiza la varianza dentro de cada clase. Hay dos variantes:

- **Exacto** (por defecto): solución óptima por programación dinámica sobre una muestra determinista de 4000 cuantiles equiespaciados de la distribución de la pieza. No depende de las unidades del modelo.
- **Compatibilidad scripts v1** (`legacy`): el algoritmo iterativo de los scripts originales, que reproduce los valores publicados. Usa una tolerancia absoluta de 0,0001: con modelos en metros los valores de Rqr son menores que esa tolerancia y el ajuste se detiene tras una iteración, por lo que el resultado depende de las unidades del modelo.

Los cortes se calculan a partir de la distribución de cada pieza, así que las clases describen diferencias relativas dentro de la pieza y no grados absolutos de pulido comparables entre útiles.

### 3.2 Auto-k

Jenks con número de clases elegido automáticamente: se calcula la bondad del ajuste de la varianza (GVF) para k = 2…10 y se elige el codo de la curva (máximo de la segunda diferencia).

### 3.3 μ ± σ (en prueba)

Seis clases con umbrales μ−2σ, μ−σ, μ−0,5σ, μ+0,5σ y μ+σ (μ y σ: media y desviación estándar del Rqr de la pieza; los umbrales negativos se fijan en 0). Se plantea en el artículo para futuros análisis comparativos sobre conjuntos mayores.

### 3.4 Escala común (en prueba)

Con la escala común, los umbrales se calculan sobre la distribución conjunta de todas las piezas comparadas. Cada pieza aporta el mismo número de valores (4000 cuantiles), sea cual sea su número de vértices, y las distribuciones se combinan en milímetros. Las mismas clases se aplican después a cada pieza. La escala común usa siempre Jenks exacto (la variante *legacy* está definida pieza a pieza). Con Auto-k por pieza, el número de clases puede ser distinto en cada pieza; en ese caso los gráficos y figuras muestran una leyenda continua R1 → Rk e indican el k de cada pieza.

> **En prueba.** La clasificación μ ± σ y la escala común están pensadas para comparar conjuntos. Hasta comprobar que funcionan correctamente en el estudio de conjuntos arqueológicos completos, sus resultados deben tomarse con cautela. Como se indica en el artículo, una comparación sólida entre piezas requiere una escala de referencia normalizada a partir de muestras experimentales y arqueológicas.

## 4. Escala del modelo

Las magnitudes (residuos, Rqr y umbrales) dependen de la escala del modelo. La aplicación:

1. propone una unidad (m, cm, mm o µm) a partir del tamaño de la pieza (pensado para piezas de mano, de ≈ 1 a 50 cm). La unidad se marca como «estimada» hasta que el usuario la confirma; en piezas muy pequeñas (≈ 1,5–6 cm modeladas en mm) la estimación puede equivocarse en un factor 10, por lo que debe comprobarse siempre con las dimensiones en mm;
2. permite introducir la **longitud, anchura y espesor reales** (en mm), medidos sobre la pieza. Las dimensiones del modelo se calculan sobre sus ejes principales, sin depender de su orientación. El factor de escala se obtiene por mínimos cuadrados con las medidas introducidas, y se avisa si estas no son proporcionales al modelo (diferencia mayor del 5 %).

La escala solo afecta a la conversión a milímetros: la geometría, los residuos y la clasificación por pieza con Jenks exacto, auto-k y μ ± σ no cambian. La excepción es la variante *legacy* de Jenks, que depende de las unidades: se calcula, como los scripts v1, sobre los valores en las unidades del archivo; cuando se introducen dimensiones reales (modelo sin escala conocida), se calcula sobre los valores convertidos a metros, que son las unidades del modelo del artículo.

## 5. Estadísticos y resultados

Para cada pieza: media, mediana, desviación estándar, mínimo y máximo de los residuos y del Rqr, y el porcentaje de vértices en cada clase. La comparación incluye una tabla de estadísticos, la distribución por clases, diagramas de caja (p5–p25–mediana–p75–p95) e histogramas del Rqr.

Los PLY exportados contienen los campos escalares `MRM_Residuals`, `Rqr`, `Rqr_Jenks`, `Rqr_Auto` y `Rqr_Sigma` (y, si está activa, la clasificación en escala común), con los mismos nombres que generan los scripts de CloudCompare. Como en CloudCompare, las coordenadas, `MRM_Residuals` y `Rqr` están en las unidades del modelo original; la cabecera del PLY indica el factor de conversión a milímetros. La tabla CSV da todos los valores en milímetros, con separador `;` y coma decimal.

La correspondencia numérica con CloudCompare/CloudComPy se comprueba con los programas de `validation/` (ver el README).

## Referencias

Ver la lista completa en el [README](../README.md#referencias).
