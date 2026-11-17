/* openGym backups read from an S3-compatible bucket (Cloudflare R2), with no
   openGym server. The request signing is checked against AWS's own published
   examples, and gym-sync against a faked bucket: nothing real is contacted. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signGet } from '../netlify/lib/s3.mjs';

test('Signature V4 matches the AWS S3 documentation examples', () => {
  const key = { keyId: 'AKIAIOSFODNN7EXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1' }, at = new Date('2013-05-24T00:00:00Z');
  const sig = h => h.authorization.split('Signature=')[1];
  // "GET Bucket (List Objects)" and "GET Object" from the SigV4 header-based auth examples
  assert.equal(sig(signGet('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J', key, {}, at)), '34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  assert.equal(sig(signGet('https://examplebucket.s3.amazonaws.com/test.txt', key, { range: 'bytes=0-9' }, at)), 'f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

Object.assign(process.env, {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  // Cloudflare's copy button puts the bucket on the end: that form must work too
  OPENGYM_S3_ENDPOINT: 'https://acct.us.r2.cloudflarestorage.com/opengym-sync', OPENGYM_S3_KEY_ID: 'kid', OPENGYM_S3_SECRET: 'sec'
});
delete process.env.OPENGYM_URL; delete process.env.OPENGYM_TOKEN; delete process.env.HEVY_API_KEY;

const day = n => Date.parse('2026-11-1' + n + 'T17:00:00Z');
const backup = { unit: 'kg', routines: [{ id: 'r1', name: 'Upper', ex: [] }], customEx: [{ id: 'imx', n: 'Cable fly' }], workouts: [
  { id: 'a', d: '2026-11-15', start: day(5), end: day(5) + 3600000, routineId: 'r1', name: 'Upper', entries: [{ id: '0025', sets: [{ w: 80, r: 8, done: true }] }, { id: 'imx', sets: [{ w: 20, r: 12, done: true }] }] },
  { id: 'b', d: '2026-11-17', start: day(7), end: day(7) + 3600000, routineId: 'r1', entries: [{ id: '0025', sets: [{ w: 82.5, r: 6, done: true }, { w: 90, r: 1, done: false }] }] }] };
let objects, gets = 0;
const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  if (u.host === 'proj.supabase.co') return init.headers.Authorization === 'Bearer good' ? J({ id: 'u1' }) : J({}, 401);
  assert.equal(u.host, 'acct.us.r2.cloudflarestorage.com');
  assert.match(init.headers.authorization, /^AWS4-HMAC-SHA256 Credential=kid\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  if (u.pathname === '/opengym-sync' && u.searchParams.get('list-type') === '2') {
    return new Response('<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>opengym-sync</Name><IsTruncated>false</IsTruncated>' +
      objects.map(o => `<Contents><Key>${o.key}</Key><LastModified>${o.at}</LastModified><ETag>&quot;${o.etag}&quot;</ETag><Size>${o.size}</Size></Contents>`).join('') + '</ListBucketResult>', { headers: { 'Content-Type': 'application/xml' } });
  }
  const o = objects.find(x => decodeURIComponent(u.pathname) === '/opengym-sync/' + x.key);
  if (o) { gets++; return new Response(o.body); }
  return new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 404 });
};
const gym = (await import('../netlify/functions/gym-sync.mjs')).default;
const req = (q, token = 'good') => gym(new Request('https://site.example/.netlify/functions/gym-sync?' + q, { headers: { Authorization: 'Bearer ' + token } })).then(async r => ({ status: r.status, body: await r.json() }));

test('gym-sync reads the newest openGym backup from the bucket', async () => {
  assert.equal((await req('mode=opengym', 'bad')).status, 401);
  assert.deepEqual((await req('mode=status')).body, { configured: false, opengym: true, opengymFrom: 'backup' });

  objects = [];
  assert.deepEqual((await req('mode=opengym')).body, { rev: null, workouts: [] });            // nothing uploaded yet

  objects = [
    { key: 'opengym-backup-2026-11-15.json', at: '2026-11-15T19:00:00.000Z', etag: 'old', size: 10, body: '{"workouts":[]}' },
    { key: 'notes.txt', at: '2026-11-18T09:00:00.000Z', etag: 'txt', size: 4, body: 'hi' },
    { key: 'opengym-backup-2026-11-17 (1).json', at: '2026-11-17T19:00:00.000Z', etag: 'new', size: 900, body: JSON.stringify(backup) }];
  assert.deepEqual((await req('mode=opengym-rev')).body, { rev: 'new' });
  assert.equal(gets, 0, 'the revision check does not download the backup');
  const r = await req('mode=opengym');
  assert.equal(r.status, 200); assert.equal(r.body.rev, 'new'); assert.equal(r.body.file, 'opengym-backup-2026-11-17 (1).json'); assert.equal(gets, 1);
  assert.deepEqual(r.body.workouts.map(w => [w.id, w.title, w.ex.map(x => x.name + ':' + x.sets.length).join(',')]),
    [['og-a', 'Upper', 'Exercise 0025:1,Cable fly:1'], ['og-b', 'Upper', 'Exercise 0025:1']]);       // the unfinished set is left out

  objects[2].body = '{"workouts": [';                                                          // caught mid-upload
  const bad = await req('mode=opengym');
  assert.equal(bad.status, 502); assert.match(bad.body.error, /not readable JSON/);
});
