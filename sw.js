/**
 * Service worker : rend l'application utilisable hors ligne.
 *
 * C'est une vraie necessite ici, pas une coquetterie : on court souvent sans
 * reseau, et une application d'entrainement qui refuse de s'ouvrir au depart
 * d'un trail ne sert a rien. Les donnees, elles, sont deja locales.
 *
 * Deux strategies, selon ce qui est demande :
 *   - la page elle-meme part du reseau, avec le cache en secours. Une nouvelle
 *     version est donc prise en compte des qu'il y a du reseau.
 *   - les ressources versionnees (leur nom contient une empreinte) partent du
 *     cache : leur contenu ne change jamais pour un nom donne.
 */

const CACHE = "montre-v1";

self.addEventListener("install", (event) => {
  // La nouvelle version remplace l'ancienne sans attendre la fermeture des onglets.
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(["./", "./index.html"]).catch(() => undefined)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // On ne touche ni aux ecritures, ni aux domaines tiers.
  if (request.method !== "GET") return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Navigation : reseau d'abord, cache en secours quand il n'y a plus de reseau.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() =>
          caches
            .match("./index.html")
            .then((cached) => cached ?? new Response("Hors ligne", { status: 503 })),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        // Seules les reponses completes et valides meritent d'etre gardees.
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
