import pycc
import numpy as np

#mrmcloudcompare.py

'''
Modelo de Residuo Morfológico (MRM)
Script de automatización para CloudCompare (python plugin)

Flujo via Python Plugin:
    a) Cargar el modelo 3D y seleccionarlo como capa activa
    b) Plugins > Python > ABRIR Script > mrmcloudcompare.py > EJECUTAR Script

Pipeline:
    1- Decimado de malla reduciendo la geometría del modelo original (QEM edfe collapse decimation)
    2- Suavizado laplaciano
    3- Residuos de distancia

'''
# -- Parámetros ---------------------------------------------------------------

# Decimado: fraccion de caras eliminada (0.9 = mantiene el 10%, 0.5 = mantiene el 50%).

DECIMATION_FACTOR = 0.9

# Suavizado laplaciado (iteraciones y fuerza)

SMOOTH_ITERATIONS = 3
SMOOTH_LAMBDA = 1.0

# -----------------------------------------------------------------------------

cc = pycc.GetInstance()


def get_mesh():
    '''Función para determinar si se ha seleccionado la malla'''
    sel = cc.getSelectedEntities()
    if not sel:
        raise RuntimeError("No hay valores — seleccione el modelo importado.")
    for e in sel:
        if isinstance(e, pycc.ccMesh):
            return e
    raise RuntimeError("El objeto seleccionado no es una malla.")


def mesh_to_numpy(mesh):
    '''Extrae las coordenadas de los vértices y los índices de los triángulos. Se guardan como matrices de NumPy.'''
    cloud = mesh.getAssociatedCloud()
    nv = cloud.size()
    nt = mesh.size()

    verts = np.empty((nv, 3), dtype=np.float64)
    for i in range(nv):
        p = cloud.getPoint(i)
        verts[i] = (p.x, p.y, p.z)

    faces = np.empty((nt, 3), dtype=np.int32)
    for t in range(nt):
        idx = mesh.getTriangleVertIndexes(t)
        faces[t] = (idx.i1, idx.i2, idx.i3)

    return verts, faces


# -- Paso 1: Decimado de la malla -----------------------------

def decimate_vertex_clustering(verts, faces, keep_fraction):
    '''Función de decimado (vertex clustering).'''
    nv = verts.shape[0]
    target_nv = max(50, int(nv * keep_fraction))

    bbox_min = verts.min(axis=0)
    bbox_max = verts.max(axis=0)
    bbox_size = bbox_max - bbox_min
    bbox_size[bbox_size == 0] = 1.0

    vol_ratio = target_nv / nv
    cells_per_axis = max(2, int(np.cbrt(nv * vol_ratio)))

    cell_size = bbox_size / cells_per_axis

    cell_coords = np.floor((verts - bbox_min) / cell_size).astype(np.int32)
    cell_coords = np.clip(cell_coords, 0, cells_per_axis - 1)

    cell_ids = (cell_coords[:, 0] * (cells_per_axis ** 2) +
                cell_coords[:, 1] * cells_per_axis +
                cell_coords[:, 2])

    unique_cells = np.unique(cell_ids)
    old_to_new = np.full(nv, -1, dtype=np.int32)
    new_verts = []

    for new_idx, cid in enumerate(unique_cells):
        mask = cell_ids == cid
        candidates = np.where(mask)[0]

        cc_coord = cell_coords[candidates[0]]
        centre = bbox_min + (cc_coord + 0.5) * cell_size

        dists = np.linalg.norm(verts[candidates] - centre, axis=1)
        best = candidates[dists.argmin()]

        new_verts.append(verts[best])
        old_to_new[candidates] = new_idx

    new_verts = np.array(new_verts, dtype=np.float64)

    # remapear triángulos
    new_faces = old_to_new[faces]

    # eliminar triángulos erróneos
    valid = ((new_faces[:, 0] != new_faces[:, 1]) &
             (new_faces[:, 1] != new_faces[:, 2]) &
             (new_faces[:, 0] != new_faces[:, 2]))
    new_faces = new_faces[valid]

    # eliminar triángulos duplicados
    sorted_faces = np.sort(new_faces, axis=1)
    _, unique_idx = np.unique(sorted_faces, axis=0, return_index=True)
    new_faces = new_faces[unique_idx]

    return new_verts, new_faces


# -- Paso 2: Suavizado laplaciano ----------------------------------------------

def build_adjacency(faces, nv):
    adj = [set() for _ in range(nv)]
    for f in faces:
        a, b, c = int(f[0]), int(f[1]), int(f[2])
        adj[a].update((b, c))
        adj[b].update((a, c))
        adj[c].update((a, b))
    return [np.array(list(s), dtype=np.int32) for s in adj]


def laplacian_smooth(verts, faces, iterations, lam):
    '''Función de Suavizado Laplaciano'''
    nv = verts.shape[0]
    nbrs = build_adjacency(faces, nv)
    smoothed = verts.copy()

    print("[MRM] Smoothing: %d iterations, lambda=%.2f" % (iterations, lam))
    for k in range(iterations):
        tmp = smoothed.copy()
        for i in range(nv):
            ni = nbrs[i]
            if len(ni) == 0:
                continue
            centroid = smoothed[ni].mean(axis=0)
            tmp[i] = smoothed[i] + lam * (centroid - smoothed[i])
        smoothed = tmp
        print("[MRM]   pass %d/%d" % (k + 1, iterations))

    return smoothed


# -- Paso 3: Distancia con signo al punto más cercano ------------------------------------

def closest_point_on_triangle(p, v0, v1, v2):
    '''Función de cercanía de un punto'''
    edge0 = v1 - v0
    edge1 = v2 - v0
    diff = v0 - p

    a = np.dot(edge0, edge0)
    b = np.dot(edge0, edge1)
    c = np.dot(edge1, edge1)
    d = np.dot(edge0, diff)
    e = np.dot(edge1, diff)

    det = a * c - b * b
    s = b * e - c * d
    t = b * d - a * e

    if det == 0:
        cp = v0
        return cp, np.dot(p - cp, p - cp)

    if s + t <= det:
        if s < 0:
            if t < 0:
                if d < 0:
                    t = 0
                    s = min(max(-d / a, 0), 1)
                else:
                    s = 0
                    t = min(max(-e / c, 0), 1)
            else:
                s = 0
                t = min(max(-e / c, 0), 1)
        elif t < 0:
            t = 0
            s = min(max(-d / a, 0), 1)
        else:
            inv = 1.0 / det
            s *= inv
            t *= inv
    else:
        if s < 0:
            tmp0 = b + d
            tmp1 = c + e
            if tmp1 > tmp0:
                numer = tmp1 - tmp0
                denom = a - 2 * b + c
                s = min(max(numer / denom, 0), 1)
                t = 1 - s
            else:
                s = 0
                t = min(max(-e / c, 0), 1)
        elif t < 0:
            tmp0 = b + e
            tmp1 = a + d
            if tmp1 > tmp0:
                numer = tmp1 - tmp0
                denom = a - 2 * b + c
                t = min(max(numer / denom, 0), 1)
                s = 1 - t
            else:
                t = 0
                s = min(max(-d / a, 0), 1)
        else:
            numer = (c + e) - (b + d)
            if numer <= 0:
                s = 0
            else:
                denom = a - 2 * b + c
                s = min(numer / denom, 1)
            t = 1 - s

    cp = v0 + s * edge0 + t * edge1
    return cp, np.dot(p - cp, p - cp)


def compute_signed_distances(orig_verts, smooth_verts, smooth_faces):
    '''Función de comparación de distancias entre las mallas'''
    nv_orig = orig_verts.shape[0]
    nt_smooth = smooth_faces.shape[0]
    residuals = np.empty(nv_orig, dtype=np.float64)

    face_v0 = smooth_verts[smooth_faces[:, 0]]
    face_v1 = smooth_verts[smooth_faces[:, 1]]
    face_v2 = smooth_verts[smooth_faces[:, 2]]

    centroids = (face_v0 + face_v1 + face_v2) / 3.0

    fn = np.cross(face_v1 - face_v0, face_v2 - face_v0)
    fn_len = np.linalg.norm(fn, axis=1, keepdims=True)
    fn_len[fn_len == 0] = 1.0
    fn /= fn_len

    all_pts = np.vstack([orig_verts, centroids])
    grid_min = all_pts.min(axis=0) - 1e-6
    grid_max = all_pts.max(axis=0) + 1e-6
    grid_size = grid_max - grid_min

    n_cells = max(5, int(np.cbrt(nt_smooth)))
    cell_size = grid_size / n_cells
    cell_size[cell_size == 0] = 1.0

    from collections import defaultdict
    grid = defaultdict(list)
    for t in range(nt_smooth):
        ci = tuple(np.clip(
            ((centroids[t] - grid_min) / cell_size).astype(int),
            0, n_cells - 1
        ))
        grid[ci].append(t)

    search_radius = 1

    report_every = max(1, nv_orig // 10)

    for i in range(nv_orig):
        if i > 0 and i % report_every == 0:
            print("[MRM]   residuals: %d%%" % int(i / nv_orig * 100))

        p = orig_verts[i]
        ci = np.clip(
            ((p - grid_min) / cell_size).astype(int),
            0, n_cells - 1
        )

        best_dist2 = np.inf
        best_cp = None
        best_face = -1

        for dx in range(-search_radius, search_radius + 1):
            for dy in range(-search_radius, search_radius + 1):
                for dz in range(-search_radius, search_radius + 1):
                    key = (ci[0] + dx, ci[1] + dy, ci[2] + dz)
                    for t in grid.get(key, []):
                        cp, d2 = closest_point_on_triangle(
                            p, face_v0[t], face_v1[t], face_v2[t]
                        )
                        if d2 < best_dist2:
                            best_dist2 = d2
                            best_cp = cp
                            best_face = t

        if best_face < 0:
            for t in range(nt_smooth):
                cp, d2 = closest_point_on_triangle(
                    p, face_v0[t], face_v1[t], face_v2[t]
                )
                if d2 < best_dist2:
                    best_dist2 = d2
                    best_cp = cp
                    best_face = t

        dist = np.sqrt(best_dist2)
        direction = p - best_cp
        sign = np.sign(np.dot(direction, fn[best_face]))
        if sign == 0:
            sign = 1.0
        residuals[i] = dist * sign

    return residuals


# -- Main script ---------------------------------------------------------------------

def main():
    print("[MRM] Modelo de Residuo Morfológico — Iniciando")

    mesh = get_mesh()
    print("[MRM] Mesh: '%s'" % mesh.getName())

    verts, faces = mesh_to_numpy(mesh)
    nv_orig = verts.shape[0]
    nf_orig = faces.shape[0]
    print("[MRM] %d vertices, %d faces" % (nv_orig, nf_orig))

    # DECIMADO
    keep = 1.0 - DECIMATION_FACTOR
    print("[MRM] Paso 1: Decimando (keep %.0f%%)..." % (keep * 100))
    dec_verts, dec_faces = decimate_vertex_clustering(verts, faces, keep)
    print("[MRM]   %d -> %d vertices, %d -> %d faces"
          % (nv_orig, dec_verts.shape[0], nf_orig, dec_faces.shape[0]))

    # SUAVIZADO LAPLACIANO
    print("[MRM] Paso 2: Suavizado Laplaziano...")
    smooth_verts = laplacian_smooth(
        dec_verts, dec_faces, SMOOTH_ITERATIONS, SMOOTH_LAMBDA
    )

    # DISTANCIAS
    print("[MRM] Paso 3: Calculando residuos (closest-point distance)...")
    residuals = compute_signed_distances(verts, smooth_verts, dec_faces)

    rmin, rmax = residuals.min(), residuals.max()
    rmean, rstd = residuals.mean(), residuals.std()
    print("[MRM] Residuals: min=%.6f  max=%.6f  mean=%.6f  std=%.6f"
          % (rmin, rmax, rmean, rstd))

    # Añadir malla de tendencia
    xs = smooth_verts[:, 0].astype(np.float32)
    ys = smooth_verts[:, 1].astype(np.float32)
    zs = smooth_verts[:, 2].astype(np.float32)
    trend_cloud = pycc.ccPointCloud(xs, ys, zs)
    trend_cloud.setName("MRM_TrendVertices")
    trend_mesh = pycc.ccMesh(trend_cloud)
    trend_mesh.setName("MRM_TrendSurface")
    for t in range(dec_faces.shape[0]):
        trend_mesh.addTriangle(int(dec_faces[t, 0]),
                               int(dec_faces[t, 1]),
                               int(dec_faces[t, 2]))
    trend_mesh.addChild(trend_cloud)
    cc.addToDB(trend_mesh)

    # anadir residuos a la malla (escala cromática)
    original_cloud = mesh.getAssociatedCloud()
    sf_idx = original_cloud.addScalarField("MRM_Residuals")
    if sf_idx < 0:
        sf_idx = original_cloud.getScalarFieldIndexByName("MRM_Residuals")
    if sf_idx >= 0:
        sf = original_cloud.getScalarField(sf_idx)
        for i in range(nv_orig):
            sf.setValue(i, float(residuals[i]))
        sf.computeMinAndMax()
        original_cloud.setCurrentDisplayedScalarField(sf_idx)
        original_cloud.showSF(True)

    cc.updateUI()
    cc.refreshAll()
    cc.redrawAll()

    print("[MRM] Finalizado. Scalar field 'MRM_Residuals' añadido a la malla original.")


# run
try:
    main()
except Exception as e:
    print("[MRM] Error: %s" % str(e))
    import traceback
    traceback.print_exc()
