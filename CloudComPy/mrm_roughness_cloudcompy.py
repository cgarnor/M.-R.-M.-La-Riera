import sys
import os
import numpy as np

# mrm_roughness_cloudcompy.py
#
'''
Cuantificación de la rugosidad superficial a partir de los residuos de MRM mediante CloudComPy.

Uso (de forma independiente, NO dentro de la interfaz gráfica de usuario de CC):
conda activate CloudComPy310   (o tu entorno CloudComPy)
python mrm_cloudcompy.py input_mesh.ply output_mesh.ply

# Requisitos:
#   - CloudComPy instalado (https://github.com/CloudCompare/CloudComPy)
#   - Entorno de Python con CloudComPy en la ruta

# Cálculos:
#   - Rqr por vértice (rugosidad RMS de los residuos MRM en un anillo de 2)
#   - Clasificación de Jenks en 6 clases
#   - Clasificación Sigma (mu ± sigma)
#   - Clasificación auto-k de Jenks (método Elbow)
'''


# -- Rqr cálculo ------------------

def compute_rqr(residuals, adj):
    nv = len(residuals)
    rqr = np.empty(nv, dtype=np.float64)

    for i in range(nv):
        ring = set()
        ring.add(i)
        for n1 in adj[i]:
            ring.add(n1)
            for n2 in adj[n1]:
                ring.add(n2)

        vals = np.array([residuals[v] for v in ring])
        mu = vals.mean()
        rqr[i] = np.sqrt(np.mean((vals - mu) ** 2))

    return rqr


# -- A: Jenks natural breaks -----------

def classify_jenks(rqr, n_classes=6, max_iter=30):
    sorted_vals = np.sort(rqr)
    n = len(sorted_vals)

    n_samples = min(n, 3000)
    step = max(1, n // n_samples)
    samples = sorted_vals[::step].copy()
    if samples[-1] != sorted_vals[-1]:
        samples = np.append(samples, sorted_vals[-1])

    breaks = np.array([
        samples[int((i + 1) * len(samples) / n_classes)]
        for i in range(n_classes - 1)
    ], dtype=np.float64)

    for _ in range(max_iter):
        class_sums = np.zeros(n_classes)
        class_counts = np.zeros(n_classes, dtype=np.int64)

        for s in samples:
            cls = n_classes - 1
            for b in range(len(breaks)):
                if s <= breaks[b]:
                    cls = b
                    break
            class_sums[cls] += s
            class_counts[cls] += 1

        class_means = np.where(class_counts > 0,
                               class_sums / np.maximum(class_counts, 1), 0)

        changed = False
        for b in range(len(breaks)):
            if class_counts[b] > 0 and class_counts[b + 1] > 0:
                new_break = (class_means[b] + class_means[b + 1]) / 2
                if abs(new_break - breaks[b]) > 0.0001:
                    changed = True
                breaks[b] = new_break
        if not changed:
            break

    classes = np.ones(len(rqr), dtype=np.int32) * n_classes
    for b in range(len(breaks) - 1, -1, -1):
        classes[rqr <= breaks[b]] = b + 1

    return classes, tuple(breaks)


# --B: Desviación estándar-sigma ---------------

def classify_sigma(rqr):
    mu = rqr.mean()
    sigma = rqr.std()

    t1 = max(0, mu - 2.0 * sigma)
    t2 = max(0, mu - 1.0 * sigma)
    t3 = max(0, mu - 0.5 * sigma)
    t4 = mu + 0.5 * sigma
    t5 = mu + 1.0 * sigma

    classes = np.ones(len(rqr), dtype=np.int32) * 6
    for b, t in enumerate([t1, t2, t3, t4, t5], 1):
        classes[rqr < t] = min(b, 5)

    classes = np.ones(len(rqr), dtype=np.int32) * 6
    classes[rqr < t5] = 5
    classes[rqr < t4] = 4
    classes[rqr < t3] = 3
    classes[rqr < t2] = 2
    classes[rqr < t1] = 1

    return classes, (t1, t2, t3, t4, t5), mu, sigma


# --C: Jenks auto-k (Elbow method) -------------

def _compute_gvf(values, classes, n_classes):
    total_mean = values.mean()
    sdam = np.sum((values - total_mean) ** 2)
    if sdam == 0:
        return 1.0
    sdcm = 0.0
    for c in range(1, n_classes + 1):
        mask = classes == c
        if mask.sum() == 0:
            continue
        class_vals = values[mask]
        class_mean = class_vals.mean()
        sdcm += np.sum((class_vals - class_mean) ** 2)
    return 1.0 - sdcm / sdam


def classify_jenks_auto(rqr, k_min=2, k_max=10):
    gvf_scores = []
    results = {}

    for k in range(k_min, k_max + 1):
        cls_k, breaks_k = classify_jenks(rqr, n_classes=k)
        gvf = _compute_gvf(rqr, cls_k, k)
        gvf_scores.append(gvf)
        results[k] = (cls_k, breaks_k, gvf)
        print("[Rqr]     k=%d: GVF=%.4f" % (k, gvf))

    if len(gvf_scores) >= 3:
        second_deriv = []
        for i in range(1, len(gvf_scores) - 1):
            d2 = gvf_scores[i - 1] - 2 * gvf_scores[i] + gvf_scores[i + 1]
            second_deriv.append(abs(d2))
        elbow_idx = np.argmax(second_deriv) + 1
        best_k = k_min + elbow_idx
    else:
        best_k = k_min

    best_k = max(k_min, min(best_k, k_max))
    cls_best, breaks_best, gvf_best = results[best_k]

    return best_k, cls_best, breaks_best


# -- Main script----------------------------------------------------

def main(input_path, output_path=None):
    import cloudComPy as cc

    cc.initCC()
    print("=" * 65)
    print("[Rqr] Análisis de la rugosidad residual local — CloudComPy")
    print("=" * 65)

    print("[Rqr] Loading: %s" % input_path)
    mesh = cc.loadMesh(input_path)
    if mesh is None:
        raise RuntimeError("No se pudo cargar la malla: %s" % input_path)

    cloud = mesh.getAssociatedCloud()
    nv = cloud.size()
    nt = mesh.size()
    print("[Rqr] Mesh: %d vertices, %d faces" % (nv, nt))

    n_sf = cloud.getNumberOfScalarFields()
    sf_idx = -1
    for si in range(n_sf):
        if cloud.getScalarFieldName(si) == "MRM_Residuals":
            sf_idx = si
            break
    if sf_idx < 0:
        if n_sf > 0:
            sf_idx = 0
            print("[Rqr] 'MRM_Residuals' no encontrado, usando SF[0]: '%s'"
                  % cloud.getScalarFieldName(sf_idx))
        else:
            raise RuntimeError("No scalar fields. Ejecuta primero mrm_cloudcompy.py.")
    sf = cloud.getScalarField(sf_idx)
    print("[Rqr] Usando SF '%s'" % cloud.getScalarFieldName(sf_idx))

    residuals = np.array([sf.getValue(i) for i in range(nv)])
    print("[Rqr] Residuals: min=%.6f  max=%.6f  mean=%.6f  std=%.6f"
          % (residuals.min(), residuals.max(), residuals.mean(), residuals.std()))


    bad = ~np.isfinite(residuals)
    if bad.sum() > 0:
        print("[Rqr] WARNING: %d NaN/Inf replaced with 0" % int(bad.sum()))
        residuals[bad] = 0.0

    print("[Rqr] Building mesh adjacency...")
    adj = [set() for _ in range(nv)]
    for t in range(nt):
        tri = mesh.getTriangleVertIndexes(t)
        a, b, c = int(tri[0]), int(tri[1]), int(tri[2])
        if a < nv and b < nv and c < nv:
            adj[a].update((b, c))
            adj[b].update((a, c))
            adj[c].update((a, b))

    print("[Rqr] Calculándo Rqr (2-ring)...")
    rqr = compute_rqr(residuals, adj)

    bad_rqr = ~np.isfinite(rqr)
    if bad_rqr.sum() > 0:
        print("[Rqr] WARNING: %d NaN/Inf Rqr values replaced with 0" % int(bad_rqr.sum()))
        rqr[bad_rqr] = 0.0

    print("[Rqr] Rqr: min=%.6f  max=%.6f  mean=%.6f  std=%.6f"
          % (rqr.min(), rqr.max(), rqr.mean(), rqr.std()))

    #   A: Jenks 6 clases
    print("[Rqr] A: Jenks natural breaks (6 clases)...")
    cls_jenks, thr_jenks = classify_jenks(rqr, n_classes=6)
    print("[Rqr]   Breaks: %s" % "  ".join("%.6f" % t for t in thr_jenks))

    #   B: sigma
    print("[Rqr] B: mu +/- sigma...")
    cls_sigma, thr_sigma, mu, sigma = classify_sigma(rqr)
    t1, t2, t3, t4, t5 = thr_sigma
    print("[Rqr]   mu=%.6f  sigma=%.6f" % (mu, sigma))

    #   C: Jenks auto-k
    print("[Rqr] C: Jenks auto-k (Elbow method)...")
    best_k, auto_cls, auto_breaks = classify_jenks_auto(rqr)
    print("[Rqr]   Auto-k: %d clases" % best_k)
    print("[Rqr]   Breaks: %s" % "  ".join("%.6f" % t for t in auto_breaks))

    class_names = {1: "R1", 2: "R2", 3: "R3", 4: "R4", 5: "R5", 6: "R6"}

    print("[Rqr] --- Jenks (6 clases) ---")
    for c in range(1, 7):
        n = int((cls_jenks == c).sum())
        print("[Rqr]   %s: %d verts (%.1f%%)" % (class_names[c], n, n / nv * 100))

    print("[Rqr] --- Sigma ---")
    for c in range(1, 7):
        n = int((cls_sigma == c).sum())
        print("[Rqr]   %s: %d verts (%.1f%%)" % (class_names[c], n, n / nv * 100))

    print("[Rqr] --- Auto-k (%d clases) ---" % best_k)
    for c in range(1, best_k + 1):
        n = int((auto_cls == c).sum())
        print("[Rqr]   Class %d: %d verts (%.1f%%)" % (c, n, n / nv * 100))

    def write_sf(cloud, name, values):
        idx = cloud.addScalarField(name)
        if idx < 0:
            for si in range(cloud.getNumberOfScalarFields()):
                if cloud.getScalarFieldName(si) == name:
                    idx = si
                    break
        if idx < 0:
            print("[Rqr] No se pudo crear '%s'" % name)
            return
        sf = cloud.getScalarField(idx)
        for i in range(cloud.size()):
            sf.setValue(i, float(values[i]))
        sf.computeMinAndMax()

    write_sf(cloud, "Rqr", rqr)
    write_sf(cloud, "Rqr_Jenks", cls_jenks.astype(np.float64))
    write_sf(cloud, "Rqr_Sigma", cls_sigma.astype(np.float64))
    write_sf(cloud, "Rqr_Auto", auto_cls.astype(np.float64))

    # Save
    if output_path is None:
        base = os.path.splitext(input_path)[0]
        output_path = base + "_Rqr.ply"

    try:
        cc.SaveMesh(mesh, output_path)
        if os.path.exists(output_path):
            print("[Rqr] Guardado: %s (%.1f KB)" % (output_path, os.path.getsize(output_path) / 1024))
    except Exception as e:
        print("[Rqr] Mesh save ERROR: %s" % str(e))
        cloud_path = os.path.splitext(output_path)[0] + "_cloud.ply"
        try:
            cc.SavePointCloud(cloud, cloud_path)
            print("[Rqr] Cloud saved: %s" % cloud_path)
        except Exception as e2:
            print("[Rqr] Cloud save also ERROR: %s" % str(e2))

    print("=" * 65)
    print("[Rqr] Finalizado. Scalar fields: Rqr, Rqr_Jenks, Rqr_Sigma, Rqr_Auto")
    print("=" * 65)


# -- Entrada ------------------------------

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python mrm_roughness_cloudcompy.py <input_MRM_mesh.ply> [output.ply]")
        sys.exit(1)

    in_path = sys.argv[1]
    out_path = sys.argv[2] if len(sys.argv) > 2 else None
    main(in_path, out_path)
