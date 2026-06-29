import sys
import os
import numpy as np
import multiprocessing

# mrm_cloudcompy.py
'''
Modelo de residuos morfológicos (MRM) mediante CloudComPy: la API externa de Python para CloudCompare que permite acceder a las herramientas nativas de CC.

Este script utiliza las implementaciones de CloudCompare:
1) mesh.samplePoints()— Puntos de muestreo en la malla
2) cc.PoissonRecon.PR.PoissonReconstruction()— Reconstrucción de superficies de Poisson
3) mesh.laplacianSmooth()— Suavizado (laplaciano)
4) cc.DistanceComputationTools— Distancia entre nube y malla

Uso (de forma independiente, NO dentro de la interfaz gráfica de usuario de CC):
conda activate CloudComPy310   (o tu entorno CloudComPy)
python mrm_cloudcompy.py input_mesh.ply output_mesh.ply

# Requisitos:
#   - CloudComPy instalado (https://github.com/CloudCompare/CloudComPy)
#   - Entorno de Python con CloudComPy en la ruta

'''

# ----- Parámetros ----------------------------------------------------------
# Sample Points: False = utiliza recuento absoluto
#                True  = utiliza densidad
DENSITY_BASED = False
SAMPLE_COUNT = 0          # 0 = automático (10 % de los vértices originales)

# Poisson Reconstruction
POISSON_DEPTH = 8         # octree depth (CC predeterminado = 8)
POISSON_SAMPLES_NODE = 1.5

# Laplacian Smoothing
SMOOTH_ITERATIONS = 20
SMOOTH_FACTOR = 0.2
# ---------------------------------------------------------------------------------------


def main(input_path, output_path=None):
    # ----------------------------- 0 Ejecución CloudComPy -----------------------------
    import cloudComPy as cc

    cc.initCC()
    print("=" * 65)
    print("[MRM] Modelo residual morfológico — Flujo de trabajo nativo de CloudComPy")
    print("=" * 65)

    # Check Poisson plugin
    if not cc.isPluginPoissonRecon():
        raise RuntimeError("El complemento PoissonRecon no está disponible en esta versión.")
    import cloudComPy.PoissonRecon

    # ----------------------------- 1 Cargar malla -----------------------------

    print("[MRM] Loading: %s" % input_path)
    entities = cc.importFile(input_path)
    mesh = None
    if isinstance(entities, (list, tuple)):
        for item in entities:
            if isinstance(item, list):
                for e in item:
                    if isinstance(e, cc.ccMesh):
                        mesh = e
                        break
            elif isinstance(item, cc.ccMesh):
                mesh = item
                break
    if mesh is None:
        raise RuntimeError("No se encontró malla en '%s'" % input_path)

    original_cloud = mesh.getAssociatedCloud()
    nv_orig = original_cloud.size()
    nf_orig = mesh.size()
    print("[MRM] Mesh: %d vertices, %d faces" % (nv_orig, nf_orig))

    # ----------------------------- 2 Sample Points on Mesh -----------------------------
    #Equivalente en Cloudcompare: Edit > Mesh > Sample Points

    n_samples = SAMPLE_COUNT if SAMPLE_COUNT > 0 else max(500, nv_orig // 10)
    print("[MRM] Paso 1: Sample Points on Mesh (%d points)..." % n_samples)

    sampled_cloud = mesh.samplePoints(
        densityBased=DENSITY_BASED,
        samplingParameter=n_samples,
        withNormals=True,
        withRGB=False,
        withTexture=False
    )
    print("[MRM]   -> %d sampled points (with normals)" % sampled_cloud.size())

    # ----------------------------- 3 Poisson Surface Reconstruction -----------------------------
    #Equivalente en Cloudcompare: Plugins > PoissonRecon

    print("[MRM] Paso 2: Poisson Reconstruction (depth=%d)..." % POISSON_DEPTH)

    n_threads = max(1, multiprocessing.cpu_count())
    trend_mesh = cc.PoissonRecon.PR.PoissonReconstruction(
        pc=sampled_cloud,
        depth=POISSON_DEPTH,
        samplesPerNode=POISSON_SAMPLES_NODE,
        density=True,
        threads=n_threads
    )

    if trend_mesh is None:
        raise RuntimeError("Poisson Reconstruction failed.")

    trend_cloud = trend_mesh.getAssociatedCloud()
    print("[MRM]   -> Trend mesh: %d vertices, %d faces"
          % (trend_cloud.size(), trend_mesh.size()))

    # ----------------------------- 4 Laplacian Smoothing -----------------------------
    #Equivalente en Cloudcompare: Edit > Mesh > Smooth (Laplacian)

    print("[MRM] Paso 3: Laplacian Smooth (%d iterations, factor=%.2f)..."
          % (SMOOTH_ITERATIONS, SMOOTH_FACTOR))

    trend_mesh.laplacianSmooth(
        nbIteration=SMOOTH_ITERATIONS,
        factor=SMOOTH_FACTOR
    )
    print("[MRM]   -> Smoothing complete")

    # ----------------------------- 5 Compute Cloud/Mesh signed distance -----------------------------
    #Equivalente en Cloudcompare: Tools > Distances > Cloud/Mesh Distance
    #Calcula la distancia con signo de cada vértice original a la malla de tendencia.

    print("[MRM] Paso 4: Cloud/Mesh signed distance...")

    params = cc.Cloud2MeshDistancesComputationParams()
    params.signedDistances = True

    print("[MRM]   calculándo %d points vs %d faces..." 
          % (original_cloud.size(), trend_mesh.size()), flush=True)
    ret = cc.DistanceComputationTools.computeCloud2MeshDistances(
        original_cloud, trend_mesh, params
    )
    print("[MRM]   resultado del cálculo de la distancia: %d" % ret, flush=True)

    sf_idx = original_cloud.getCurrentDisplayedScalarFieldIndex()
    if sf_idx < 0:
        nsf = original_cloud.getNumberOfScalarFields()
        for si in range(nsf):
            name = original_cloud.getScalarFieldName(si)
            if "distance" in name.lower() or "c2m" in name.lower():
                sf_idx = si
                break
    if sf_idx < 0:
        sf_idx = original_cloud.getNumberOfScalarFields() - 1

    if sf_idx >= 0:
        sf = original_cloud.getScalarField(sf_idx)
        sf.setName("MRM_Residuals")
        sf.computeMinAndMax()
        original_cloud.setCurrentDisplayedScalarField(sf_idx)
        original_cloud.showSF(True)

        residuals = np.array([sf.getValue(i) for i in range(nv_orig)])
        print("[MRM] Raw residuals: min=%.6f  max=%.6f  mean=%.6f  std=%.6f"
              % (residuals.min(), residuals.max(),
                 residuals.mean(), residuals.std()))

        bad_mask = ~np.isfinite(residuals)
        n_bad = int(bad_mask.sum())
        if n_bad > 0:
            print("[MRM] WARNING: %d vertices with NaN/Inf — replaced with 0" % n_bad)
            residuals[bad_mask] = 0.0

        print("[MRM] Suavización de los límites de los signos...")
        nf = mesh.size()
        adj = [set() for _ in range(nv_orig)]
        for fi in range(nf):
            tri = mesh.getTriangleVertIndexes(fi)
            a, b, c = int(tri[0]), int(tri[1]), int(tri[2])
            if a < nv_orig and b < nv_orig and c < nv_orig:
                adj[a].update((b, c))
                adj[b].update((a, c))
                adj[c].update((a, b))

        n_smoothed = 0
        smoothed = residuals.copy()
        for i in range(nv_orig):
            nbrs = list(adj[i])
            if len(nbrs) < 3:
                continue
            nbr_vals = np.array([residuals[n] for n in nbrs])
            n_pos = int((nbr_vals > 0).sum())
            n_neg = int((nbr_vals < 0).sum())
            total = n_pos + n_neg
            if total == 0:
                continue
            my_sign = 1 if residuals[i] >= 0 else -1
            majority_sign = 1 if n_pos >= n_neg else -1
            majority_frac = max(n_pos, n_neg) / total
            if majority_frac > 0.6 and my_sign != majority_sign:
                smoothed[i] = nbr_vals.mean()
                n_smoothed += 1
        residuals = smoothed
        print("[MRM] Smoothed %d sign-boundary vertices" % n_smoothed)

        for i in range(nv_orig):
            sf.setValue(i, float(residuals[i]))
        sf.computeMinAndMax()

        print("[MRM] Final residuals: min=%.6f  max=%.6f  mean=%.6f  std=%.6f"
              % (residuals.min(), residuals.max(),
                 residuals.mean(), residuals.std()))

    # ---------- 6. Guardar resultados -----------------------------
    if output_path is None:
        base, ext = os.path.splitext(input_path)
        output_path = base + "_MRM.ply"

    base_out = os.path.splitext(output_path)[0]

    # Guardar la nube de puntos con un campo escalar
    cloud_path = base_out + ".ply"
    try:
        ret = cc.SavePointCloud(original_cloud, cloud_path)
        print("[MRM] SavePointCloud returned: %s" % str(ret))
    except Exception as e:
        print("[MRM] SavePointCloud failed: %s, trying SaveEntities..." % str(e))
        try:
            cc.SaveEntities([original_cloud], cloud_path)
        except Exception as e2:
            print("[MRM] SaveEntities also failed: %s" % str(e2))

    if os.path.exists(cloud_path):
        print("[MRM] Cloud saved: %s (%.1f KB)" % (cloud_path, os.path.getsize(cloud_path) / 1024))

    # Guardar malla con campo escalar
    mesh_path = base_out + "_mesh.ply"
    try:
        cc.SaveMesh(mesh, mesh_path)
        if os.path.exists(mesh_path):
            print("[MRM] Mesh saved: %s (%.1f KB)" % (mesh_path, os.path.getsize(mesh_path) / 1024))
    except Exception as e:
        print("[MRM] Mesh save failed: %s" % str(e))

    # Guardar malla de tendencia
    trend_path = base_out + "_trend.ply"
    cc.SaveMesh(trend_mesh, trend_path)
    print("[MRM] Trend saved: %s" % trend_path)

    print("=" * 65)
    print("[MRM] Finalizado.")
    print("[MRM] Pipeline: SamplePoints > Poisson(d=%d) > Smooth(%d, %.2f) > C2M"
          % (POISSON_DEPTH, SMOOTH_ITERATIONS, SMOOTH_FACTOR))
    print("=" * 65)


# --------- Entrada -----------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python mrm_cloudcompy.py <input_mesh.ply> [output_mesh.ply]")
        print("")
        print("Es necesario que el entorno CloudComPy esté activado.")
        sys.exit(1)

    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    main(in_path, out_path)
