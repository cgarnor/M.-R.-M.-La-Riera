# Seguridad / Security

## Diseño

MRM Analysis Tool funciona sin conexión: no envía datos ni descarga contenido.

- La interfaz se sirve desde un esquema privado (`app://mrm`), no desde `file://`, y solo puede acceder a los archivos de la propia interfaz. Se ejecuta aislada (*sandbox*, `contextIsolation`, sin Node.js) con una política de seguridad de contenidos estricta.
- El proceso principal bloquea cualquier petición de red, permiso, navegación, ventana emergente o lectura de archivos locales desde la interfaz, y valida el origen y los argumentos de cada petición. Los enlaces solo se abren en el navegador del sistema si apuntan a `doi.org`, `github.com`, `orcid.org` o `creativecommons.org` por https.
- El ejecutable empaquetado tiene desactivadas las opciones de Electron que permitirían usarlo como intérprete de Node.js (`RunAsNode`, `NODE_OPTIONS`, `--inspect`) y los privilegios especiales de `file://`, y comprueba la integridad de su archivo de aplicación (`app.asar`): si se modifica, no arranca.
- Los modelos 3D y los proyectos `.mrm` se validan antes de usarse. Las celdas de texto del CSV que podrían interpretarse como fórmulas se exportan como texto.
- La aplicación guarda en el equipo solo el idioma y las últimas opciones de exportación de figuras.

El instalador no está firmado digitalmente. Comprueba su huella SHA-256 con el archivo `SHA256SUMS.txt` de la Release antes de ejecutarlo.

## Cómo informar de un problema de seguridad

No abras una *issue* pública. Escribe a Carlos García-Noriega (<carlos.garcianoriega@unican.es>) indicando la versión, los pasos para reproducir el problema y, si es posible, un archivo de ejemplo. Se responderá lo antes posible y se publicará una versión corregida.

---

*English:* the application works offline. The interface is served from a private `app://mrm` scheme (not `file://`), runs sandboxed without Node.js access and cannot reach the network, local files, permissions, navigation or pop-ups; only https links to doi.org, github.com, orcid.org and creativecommons.org are opened in the system browser. Every IPC request and every input file is validated, and the packaged executable ships with hardened Electron fuses (no RunAsNode, NODE_OPTIONS, `--inspect` or extra `file://` privileges; asar integrity validation). The installer is not code-signed: check its SHA-256 against `SHA256SUMS.txt` in the release. Please report security issues privately by e-mail to <carlos.garcianoriega@unican.es> instead of opening a public issue.
