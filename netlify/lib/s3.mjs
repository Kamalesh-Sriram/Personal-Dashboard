/* Read-only access to an S3-compatible bucket (Cloudflare R2, Backblaze B2,
   MinIO, AWS), with no SDK: just AWS Signature Version 4 over fetch.

   Used by gym-sync to read the openGym backups that a sync app on the phone
   (FolderSync) copies into a bucket. Only GET requests are made: listing the
   bucket and downloading one file. */
import { createHash, createHmac } from 'node:crypto';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s).digest();
const EMPTY = sha256('');
// RFC 3986, as S3 wants it: everything but A-Z a-z 0-9 - _ . ~ is %-encoded
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

/** Signature V4 headers for a GET with an empty body.
 *  `headers` are extra headers to sign (lower-case names). `now` is for tests. */
export function signGet(url, { keyId, secret, region }, headers = {}, now = new Date()) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, ''), day = amzDate.slice(0, 8);
  const all = { host: u.host, 'x-amz-content-sha256': EMPTY, 'x-amz-date': amzDate, ...headers };
  const names = Object.keys(all).map(k => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const path = u.pathname.split('/').map(p => enc(decodeURIComponent(p))).join('/') || '/';
  const query = [...u.searchParams].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('&');
  const canonical = ['GET', path, query, names.map(n => n + ':' + lower[n] + '\n').join(''), names.join(';'), EMPTY].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const key = ['s3', 'aws4_request'].reduce(hmac, hmac(hmac('AWS4' + secret, day), region));
  const signature = createHmac('sha256', key).update(toSign).digest('hex');
  const out = { ...all, authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` };
  delete out.host;                                     // fetch sets it
  return out;
}

const xmlText = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)); return m ? xmlText(m[1]) : ''; };

/** A bucket, from settings: { endpoint: 'https://host', bucket, keyId, secret, region }. */
export function bucket(cfg) {
  const base = cfg.endpoint.replace(/\/+$/, '') + '/' + enc(cfg.bucket);      // path-style: https://host/bucket
  const get = async (path, query = '') => {
    const url = base + path + (query ? '?' + query : '');
    const r = await fetch(url, { headers: signGet(url, cfg) });
    if (r.status === 403 || r.status === 401) throw new Error('The bucket refused the key. Check OPENGYM_S3_KEY_ID and OPENGYM_S3_SECRET, and that the token may read this bucket.');
    if (r.status === 404) throw new Error(`No bucket called "${cfg.bucket}" at OPENGYM_S3_ENDPOINT. A bucket with a jurisdiction (EU, US) has its own address, for example https://<account>.us.r2.cloudflarestorage.com.`);
    if (!r.ok) throw new Error('The bucket answered ' + r.status + '.');
    return r;
  };
  return {
    /** Every object, newest first: [{ key, modified, etag, size }]. */
    async list() {
      const out = [];
      let token = '';
      for (let i = 0; i < 20; i++) {
        const xml = await (await get('', 'list-type=2' + (token ? '&continuation-token=' + enc(token) : ''))).text();
        for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
          out.push({ key: tag(m[1], 'Key'), modified: Date.parse(tag(m[1], 'LastModified')) || 0, etag: tag(m[1], 'ETag').replace(/"/g, ''), size: +tag(m[1], 'Size') || 0 });
        }
        token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : '';
        if (!token) break;
      }
      return out.sort((a, b) => b.modified - a.modified);
    },
    /** One object's text. */
    async text(key) {
      return (await get('/' + key.split('/').map(enc).join('/'))).text();
    }
  };
}
