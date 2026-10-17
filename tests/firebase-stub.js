// Stand-in for the Firebase SDK modules during the smoke test, so tests never
// touch the real project. Writes are recorded on window.__docs / window.__uploads;
// window.__fixtureDocs (set by the test) is served as the project's log entries.
const W = window; W.__uploads = []; W.__docs = [];
const fixture = () => (W.__fixtureDocs || []).map(d => ({ id: d.id, data: () => d, ref: {} }));
const snap = (docs) => ({ docs, empty: !docs.length, size: docs.length, forEach(f) { docs.forEach(f); }, docChanges: () => [] });
const docsFor = (path = '') =>
    path.includes('images') ? fixture()
    : path.includes('projects') ? [{ id: 'Project-Alpha', data: () => ({ name: 'Project-Alpha' }) }]
    : [];

let authCb;
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const onAuthStateChanged = (a, f) => { authCb = f; };
export const signInAnonymously = async () => { setTimeout(() => authCb && authCb({ uid: 'test-user', isAnonymous: true }), 0); };
export const signInWithCustomToken = signInAnonymously;

export const getFirestore = () => ({});
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const collection = (db, path) => ({ path });
export const doc = (db, path, id) => ({ path, id });
export const query = (c) => ({ path: c.path });
export const where = () => ({});
export const orderBy = () => ({});
export const setDoc = async (ref, data) => { W.__docs.push({ path: ref.path, id: ref.id, data: JSON.parse(JSON.stringify(data)) }); };
export const deleteDoc = async () => {};
export const getDocs = async (q) => snap(docsFor(q.path));
export const onSnapshot = (q, f) => { setTimeout(() => f(snap(docsFor(q.path))), 0); return () => {}; };

export const getStorage = () => ({});
export const ref = (s, path) => ({ fullPath: path || '' });
export const uploadBytes = async (r, blob) => { W.__uploads.push({ path: r.fullPath, blob }); return { ref: r }; };
export const getDownloadURL = async () => 'data:,';
export const listAll = async () => ({ items: [], prefixes: [] });
export const deleteObject = async () => {};
export const getMetadata = async () => ({});
