/* Read-only access to a WebDAV folder (Koofr, Nextcloud, any WebDAV drive).

   Used by gym-sync to read the backups that openGym's own "Back up to
   WebDAV" uploads, for phones where no sync app can copy files (iPhone).
   Only two kinds of request are made: PROPFIND (list a folder) and GET
   (download one file). Nothing is written or deleted. */

const xmlText = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// WebDAV servers choose their own XML prefix (d:, D:, none), so tags are matched by local name
const tag = (xml, name) => { const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i')); return m ? xmlText(m[1].trim()) : ''; };
const has = (xml, name) => new RegExp(`<(?:[\\w-]+:)?${name}\\b`, 'i').test(xml);

/** A folder, from settings: { url: 'https://host/dav/path/', user, password }. */
export function davFolder(cfg) {
  const auth = 'Basic ' + Buffer.from(cfg.user + ':' + cfg.password).toString('base64');
  const call = async (method, url, headers = {}) => {
    const r = await fetch(url, { method, headers: { Authorization: auth, ...headers } });
    if (r.status === 401 || r.status === 403) throw new Error('The WebDAV drive refused the sign-in. Check OPENGYM_DAV_USER and OPENGYM_DAV_PASSWORD (use an app password, not your account password).');
    if (r.status === 404) throw new Error('No folder at OPENGYM_DAV_URL. Use the folder openGym backs up to, for example https://app.koofr.net/dav/Koofr/openGym/.');
    if (!r.ok) throw new Error('The WebDAV drive answered ' + r.status + '.');
    return r;
  };
  /** Everything directly inside a folder: [{ url, name, folder, modified, etag, size }]. */
  async function list(url) {
    const xml = await (await call('PROPFIND', url, { Depth: '1', 'Content-Type': 'application/xml' })).text();
    const self = new URL(url).pathname.replace(/\/+$/, '');
    const out = [];
    for (const m of xml.matchAll(/<(?:[\w-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?response>/gi)) {
      const href = tag(m[1], 'href');
      if (!href) continue;
      const abs = new URL(href, url), path = abs.pathname.replace(/\/+$/, '');
      if (path === self) continue;                       // the folder itself
      let name = path.split('/').pop();
      try { name = decodeURIComponent(name); } catch { /* keep it encoded */ }
      out.push({
        url: abs.href, name, folder: has(m[1], 'collection'),
        modified: Date.parse(tag(m[1], 'getlastmodified')) || 0,
        etag: tag(m[1], 'getetag').replace(/^W\//, '').replace(/"/g, ''),
        size: +tag(m[1], 'getcontentlength') || 0
      });
    }
    return out;
  }
  return {
    /** The newest .json backup in the folder, or, if it has none, in the folders directly inside it. */
    async newest() {
      const base = cfg.url.endsWith('/') ? cfg.url : cfg.url + '/';
      const pick = items => items.filter(i => !i.folder && /\.json$/i.test(i.name) && i.size !== 0).sort((a, b) => b.modified - a.modified)[0] || null;
      const top = await list(base);
      let best = pick(top);
      if (!best) {
        // openGym may keep its backups in a folder of its own inside the one given
        for (const f of top.filter(i => i.folder).slice(0, 8)) {
          const found = pick(await list(f.url.endsWith('/') ? f.url : f.url + '/'));
          if (found && (!best || found.modified > best.modified)) best = found;
        }
      }
      return best;
    },
    async text(item) { return (await call('GET', item.url)).text(); }
  };
}
