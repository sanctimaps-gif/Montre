/**
 * Stockage local du mode autonome, sur IndexedDB.
 *
 * Le stockage local classique plafonne autour de 5 Mo, ce qui ne suffit pas :
 * une sortie d'une heure enregistree a 1 Hz represente deja plusieurs centaines
 * de kilo-octets de trace. IndexedDB n'a pas cette limite et conserve les
 * donnees entre deux visites.
 */

const DB_NAME = "montre";
const DB_VERSION = 1;

/** Documents uniques : utilisateur, profil, plan, appareils, encouragements. */
const KV_STORE = "kv";
/** Une entree par activite, indexee par date de debut. */
const ACTIVITY_STORE = "activities";

let connection: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (connection) return connection;

  connection = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Ce navigateur ne propose pas de stockage local."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(ACTIVITY_STORE)) {
        const store = db.createObjectStore(ACTIVITY_STORE, { keyPath: "id" });
        store.createIndex("startTime", "startTime");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Ouverture du stockage local impossible"));
  });

  return connection;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const request = action(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Erreur de stockage"));
      }),
  );
}

/** Lit un document unique, ou `null` s'il n'existe pas encore. */
export async function readDoc<T>(key: string): Promise<T | null> {
  const value = await run<T | undefined>(KV_STORE, "readonly", (store) => store.get(key));
  return value ?? null;
}

export async function writeDoc<T>(key: string, value: T): Promise<T> {
  await run(KV_STORE, "readwrite", (store) => store.put(value, key));
  return value;
}

export async function removeDoc(key: string): Promise<void> {
  await run(KV_STORE, "readwrite", (store) => store.delete(key));
}

export async function putActivity<T extends { id: string }>(activity: T): Promise<T> {
  await run(ACTIVITY_STORE, "readwrite", (store) => store.put(activity));
  return activity;
}

export function getActivity<T>(id: string): Promise<T | undefined> {
  return run<T | undefined>(ACTIVITY_STORE, "readonly", (store) => store.get(id));
}

export async function deleteActivity(id: string): Promise<void> {
  await run(ACTIVITY_STORE, "readwrite", (store) => store.delete(id));
}

/** Toutes les activites, de la plus recente a la plus ancienne. */
export async function allActivities<T extends { startTime: number }>(): Promise<T[]> {
  const rows = await run<T[]>(ACTIVITY_STORE, "readonly", (store) => store.getAll());
  return rows.sort((a, b) => b.startTime - a.startTime);
}

/** Identifiant court et trie chronologiquement. */
export function newId(prefix = ""): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
