// Web Worker multihilo para precargar en segundo plano recursos FITS, PNG y Aladin Lite sin bloquear el hilo principal de la interfaz
const cargados = new Set();

self.onmessage = async (event) => {
  const data = event.data || {};
  const urls = Array.isArray(data.urls) ? data.urls : [];

  await Promise.allSettled(
    urls.map(async (url) => {
      if (!url || cargados.has(url)) return;
      cargados.add(url);
      try {
        const res = await fetch(url, { cache: "force-cache" });
        if (res.ok) {
          await res.arrayBuffer();
          self.postMessage({ status: "preloaded", url });
        }
      } catch {
        cargados.delete(url);
      }
    })
  );
};
