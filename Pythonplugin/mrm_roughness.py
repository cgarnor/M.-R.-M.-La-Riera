import pycc
import numpy as np

# mrm_roughness.py

'''
Cuantificación de la rugosidad superficial a partir de los residuos de MRM.
Script de automatización para CloudCompare (python plugin)

Flujo via Python Plugin (Previa ejecuación de mrm_cloudcompare.py):
    a) Cargar el modelo 3D y seleccionarlo como capa activa
    b) Plugins > Python > ABRIR Script > mrmcloudcompare.py > EJECUTAR Script


Este script lee el campo escalar «MRM_Residuals» y calcula:
- El valor Rqr por vértice (rugosidad cuadrática residual)
- Clasificación en 6 clases de rugosidad (R1-R6) utilizando bien los «breaks naturales» de Jenks (también con versión automática), bien umbrales de mu ± sigma

Escala de clasificación:
    R1 = rugosidad residual muy baja (máxima regularidad/pulido)
    R2 = rugosidad residual baja
    R3 = rugosidad residual medio-baja
    R4 = rugosidad residual medio-alta
    R5 = rugosidad residual alta
    R6 = rugosidad residual muy alta (fracturas, desgaste por uso...)

Se ofrecen dos métodos de clasificación:
    A) Roturas naturales de Jenks (y automáticos): límites óptimos que minimizan la varianza intraclase, lo que refleja agrupaciones naturales en los datos.

    B) mu +/- sigma: umbrales en mu-2s, mu-s, mu-0,5s, mu+0,5s, mu+s.

'''

cc = pycc.GetInstance()


def get_mesh():
    sel = cc.getSelectedEntities()
    if not sel:
        raise RuntimeError("No hay valores — seleccione el modelo importado.")
    for e in sel:
        if isinstance(e, pycc.ccMesh):
            return e
    raise RuntimeError("El objeto seleccionado no es una malla.")


def read_sf(cloud, name):
    '''Función para leer un campo escalar en una matriz de NumPy. Devuelve None si no existe.'''
    idx = cloud.getScalarFieldIndexByName(name)
    if idx < 0:
        return None
    sf = cloud.getScalarField(idx)
    n = cloud.size()
    out = np.empty(n, dtype=np.float64)
    for i in range(n):
        out[i] = sf.getValue(i)
    return out


def write_sf(cloud, name, values):
    '''Crea o sobrescribe un campo escalar en la nube.'''
    idx = cloud.addScalarField(name)
    if idx < 0:
        idx = cloud.getScalarFieldIndexByName(name)
    if idx < 0:
        print("[Rqr] no se puede crear '%s'" % name)
        return
    sf = cloud.getScalarField(idx)
    for i in range(cloud.size()):
        sf.setValue(i, float(values[i]))
    sf.computeMinAndMax()


def adjacency_from_mesh(mesh, nv):
    '''Adyacencia de vértices a partir de la conectividad de los triángulos.'''
    nt = mesh.size()
    adj = [set() for _ in range(nv)]
    for t in range(nt):
        tri = mesh.getTriangleVertIndexes(t)
        a, b, c = tri.i1, tri.i2, tri.i3
        adj[a].update((b, c))
        adj[b].update((a, c))
        adj[c].update((a, b))
    return adj


# -- Rqr cálculo ---------------------------------------------------------

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


# -- A: Jenks (natural breaks) ------------------------------------
'''Determina los límites óptimos entre clases que minimizan la varianza intraclase.
Los tamaños de las clases son desiguales y reflejan agrupaciones naturales en los datos.'''

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


# -- B: Desviación estándar (mu +/- sigma) ----------------------
'''Umbrales en mu-2s, mu-s, mu-0,5s, mu+0,5s, mu+s.
Los tamaños de las clases son desiguales y reflejan la forma de la distribución.'''

def classify_sigma(rqr):
    mu = rqr.mean()
    sigma = rqr.std()

    t1 = max(0, mu - 2.0 * sigma)
    t2 = max(0, mu - 1.0 * sigma)
    t3 = max(0, mu - 0.5 * sigma)
    t4 = mu + 0.5 * sigma
    t5 = mu + 1.0 * sigma

    classes = np.ones(len(rqr), dtype=np.int32) * 6
    classes[rqr < t5] = 5
    classes[rqr < t4] = 4
    classes[rqr < t3] = 3
    classes[rqr < t2] = 2
    classes[rqr < t1] = 1

    return classes, (t1, t2, t3, t4, t5), mu, sigma


# -- C: Jenks auto-k (Elbow method) ----------------------------
'''Ejecuta Jenks para k = 2..10, calcula el índice de ajuste de la varianza (GVF) para cada k,
y selecciona el «elbow» a partir de la segunda derivada del GVF.'''

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


# -- Main script---------------------------------------------------------------------

def main():
    print("[Rqr] Iniciando el análisis de la rugosidad residual")

    mesh = get_mesh()
    cloud = mesh.getAssociatedCloud()
    nv = cloud.size()
    print("[Rqr] Mesh: '%s' (%d vertices)" % (mesh.getName(), nv))

    residuals = read_sf(cloud, "MRM_Residuals")
    if residuals is None:
        raise RuntimeError(
            "No 'MRM_Residuals' encontrado. Ejecuta mrm_cloudcompare.py antes."
        )

    #  Sanea: los valores NaN/Inf en los residuos
    bad = ~np.isfinite(residuals)
    n_bad = int(bad.sum())
    if n_bad > 0:
        print("[Rqr] WARNING: %d NaN/Inf residuals replaced with 0" % n_bad)
        residuals[bad] = 0.0

    print("[Rqr] Creando mesh adjacency...")
    adj = adjacency_from_mesh(mesh, nv)

    print("[Rqr] Calculándo Rqr (2-ring)...")
    rqr = compute_rqr(residuals, adj)

    bad_rqr = ~np.isfinite(rqr)
    if bad_rqr.sum() > 0:
        print("[Rqr] WARNING: %d NaN/Inf Rqr values replaced with 0" % int(bad_rqr.sum()))
        rqr[bad_rqr] = 0.0

    print("[Rqr] Rqr: min=%.6f  max=%.6f  mean=%.6f  std=%.6f"
          % (rqr.min(), rqr.max(), rqr.mean(), rqr.std()))

    #   A: Jenks (6 clases)
    print("[Rqr] Jenks natural breaks (6)...")
    cls_jenks, thr_jenks = classify_jenks(rqr, n_classes=6)
    print("[Rqr]   Breaks: %s" % "  ".join("%.6f" % t for t in thr_jenks))

    #   B: Desviación estándar (6 clases)
    print("[Rqr] mu +/- sigma...")
    cls_sigma, thr_sigma, mu, sigma = classify_sigma(rqr)
    t1, t2, t3, t4, t5 = thr_sigma
    print("[Rqr]   mu=%.6f  sigma=%.6f" % (mu, sigma))
    print("[Rqr]   T1(mu-2s)=%.6f  T2(mu-s)=%.6f  T3(mu-0.5s)=%.6f  T4(mu+0.5s)=%.6f  T5(mu+s)=%.6f"
          % (t1, t2, t3, t4, t5))

    #   C: Jenks auto-k (Elbow method)
    print("[Rqr] Jenks auto-k (Elbow method)...")
    best_k, auto_cls, auto_breaks = classify_jenks_auto(rqr)
    print("[Rqr]   Auto-k: %d clases" % best_k)
    print("[Rqr]   Breaks: %s" % "  ".join("%.6f" % t for t in auto_breaks))

    class_names = {
        1: "R1 (muy baja)",
        2: "R2 (baja)",
        3: "R3 (media-baja)",
        4: "R4 (media-alta)",
        5: "R5 (alta)",
        6: "R6 (muy alta)"
    }

    print("[Rqr] --- Jenks (6 clases) ---")
    for c in range(1, 7):
        n = int((cls_jenks == c).sum())
        print("[Rqr]   %s: %d verts (%.1f%%)"
              % (class_names[c], n, n / nv * 100))

    print("[Rqr] --- Sigma ---")
    for c in range(1, 7):
        n = int((cls_sigma == c).sum())
        print("[Rqr]   %s: %d verts (%.1f%%)"
              % (class_names[c], n, n / nv * 100))

    print("[Rqr] --- Auto-k (%d clases) ---" % best_k)
    for c in range(1, best_k + 1):
        n = int((auto_cls == c).sum())
        print("[Rqr]   Class %d: %d verts (%.1f%%)" % (c, n, n / nv * 100))

    write_sf(cloud, "Rqr", rqr)
    write_sf(cloud, "Rqr_Jenks", cls_jenks.astype(np.float64))
    write_sf(cloud, "Rqr_Sigma", cls_sigma.astype(np.float64))
    write_sf(cloud, "Rqr_Auto", auto_cls.astype(np.float64))

    idx = cloud.getScalarFieldIndexByName("Rqr")
    if idx >= 0:
        cloud.setCurrentDisplayedScalarField(idx)
        cloud.showSF(True)

    cc.updateUI()
    cc.refreshAll()
    cc.redrawAll()

    print("[Rqr] Finalizado. Scalar fields añadidos:")
    print("[Rqr]   - Rqr          (rugosidad residual continua)")
    print("[Rqr]   - Rqr_Jenks    (R1-R6, Jenks natural breaks)")
    print("[Rqr]   - Rqr_Sigma    (R1-R6, mu +/- sigma)")
    print("[Rqr]   - Rqr_Auto     (Auto-k, Jenks + Elbow method)")


try:
    main()
except Exception as e:
    print("[Rqr] Error: %s" % str(e))
    import traceback
    traceback.print_exc()

