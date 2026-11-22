/* openGym backups read from a WebDAV folder (Koofr, Nextcloud), for phones
   where openGym uploads its backups itself. Run against a faked drive:
   nothing real is contacted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  OPENGYM_DAV_URL: 'https://app.koofr.net/dav/Koofr', OPENGYM_DAV_USER: 'her@example.com', OPENGYM_DAV_PASSWORD: 'app-pass'
});
for (const k of ['OPENGYM_URL', 'OPENGYM_TOKEN', 'HEVY_API_KEY', 'OPENGYM_S3_ENDPOINT', 'OPENGYM_S3_KEY_ID', 'OPENGYM_S3_SECRET']) delete process.env[k];

const day = n => Date.parse('2026-11-2' + n + 'T17:00:00Z');
const backup = { unit: 'kg', routines: [{ id: 'r1', name: 'Legs', ex: [] }], workouts: [
  { id: 'w1', start: day(0), end: day(0) + 3600000, routineId: 'r1', entries: [{ id: '0043', sets: [{ w: 100, r: 5, done: true }] }] }] };
const AUTH = 'Basic ' + Buffer.from('her@example.com:app-pass').toString('base64');
// the drive: a root folder holding an openGym folder holding two backups (Koofr answers with a D: prefix)
const tree = {
  '/dav/Koofr/': [['/dav/Koofr/', true], ['/dav/Koofr/openGym/', true], ['/dav/Koofr/Photos/', true]],
  '/dav/Koofr/openGym/': [['/dav/Koofr/openGym/', true],
    ['/dav/Koofr/openGym/opengym-backup-2026-11-20.json', false, 'Fri, 20 Nov 2026 18:00:00 GMT', 'e-old', 20],
    ['/dav/Koofr/openGym/opengym%20backup%202026-11-22.json', false, 'Sun, 22 Nov 2026 18:00:00 GMT', 'e-new', 500]],
  '/dav/Koofr/Photos/': [['/dav/Koofr/Photos/', true], ['/dav/Koofr/Photos/a.jpg', false, 'Mon, 23 Nov 2026 08:00:00 GMT', 'p', 9]]
};
const files = { '/dav/Koofr/openGym/opengym%20backup%202026-11-22.json': JSON.stringify(backup) };
let gets = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.host === 'proj.supabase.co') return init.headers.Authorization === 'Bearer good' ? new Response(JSON.stringify({ id: 'u1' })) : new Response('{}', { status: 401 });
  assert.equal(u.host, 'app.koofr.net');
  if (init.headers.Authorization !== AUTH) return new Response('', { status: 401 });
  if (init.method === 'PROPFIND') {
    assert.equal(init.headers.Depth, '1');
    const items = tree[u.pathname];
    if (!items) return new Response('', { status: 404 });
    return new Response('<?xml version="1.0"?><D:multistatus xmlns:D="DAV:">' + items.map(([href, dir, mod, etag, size]) =>
      `<D:response><D:href>${href}</D:href><D:propstat><D:prop>${dir ? '<D:resourcetype><D:collection/></D:resourcetype>' : `<D:resourcetype/><D:getlastmodified>${mod}</D:getlastmodified><D:getetag>"${etag}"</D:getetag><D:getcontentlength>${size}</D:getcontentlength>`}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`).join('') + '</D:multistatus>', { status: 207 });
  }
  if (init.method === 'GET' && files[u.pathname]) { gets++; return new Response(files[u.pathname]); }
  return new Response('', { status: 404 });
};
const gym = (await import('../netlify/functions/gym-sync.mjs')).default;
const req = (q, token = 'good') => gym(new Request('https://site.example/.netlify/functions/gym-sync?' + q, { headers: { Authorization: 'Bearer ' + token } })).then(async r => ({ status: r.status, body: await r.json() }));

test('gym-sync reads the newest openGym backup from a WebDAV folder', async () => {
  assert.equal((await req('mode=opengym', 'bad')).status, 401);
  assert.deepEqual((await req('mode=status')).body, { configured: false, opengym: true, opengymFrom: 'backup' });
  // the root has no backup, so the folders inside it are looked in; the newest .json wins
  assert.deepEqual((await req('mode=opengym-rev')).body, { rev: 'e-new' });
  assert.equal(gets, 0, 'the revision check does not download the backup');
  const r = await req('mode=opengym');
  assert.equal(r.status, 200); assert.equal(r.body.rev, 'e-new'); assert.equal(r.body.file, 'opengym backup 2026-11-22.json'); assert.equal(gets, 1);
  assert.deepEqual(r.body.workouts.map(w => [w.id, w.title, w.ex[0].sets[0].kg]), [['og-w1', 'Legs', 100]]);

  process.env.OPENGYM_DAV_PASSWORD = 'wrong';
  const bad = await req('mode=opengym-rev');
  assert.equal(bad.status, 502); assert.match(bad.body.error, /refused the sign-in/);
  process.env.OPENGYM_DAV_PASSWORD = 'app-pass';

  process.env.OPENGYM_DAV_URL = 'https://app.koofr.net/dav/Nope';
  assert.match((await req('mode=opengym-rev')).body.error, /No folder at OPENGYM_DAV_URL/);
});
