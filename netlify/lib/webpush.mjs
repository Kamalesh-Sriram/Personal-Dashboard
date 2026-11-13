/* ══════════════════════════════════════════════════════════════════════
   WEB PUSH: a dependency-free sender.

   This is RFC 8291 (message encryption, `aes128gcm`) plus RFC 8292 (VAPID
   sender identification), written against node:crypto.

   Why not the `web-push` package: this project has no dependencies at
   all, so there is nothing to audit, update or have compromised. The
   whole of what is needed is about 120 lines.
   ══════════════════════════════════════════════════════════════════════ */
import {
  createECDH, createHmac, createCipheriv, randomBytes,
  createPrivateKey, createPublicKey, sign as signRaw, verify as verifyOne
} from 'node:crypto';

const b64url = buf => Buffer.from(buf).toString('base64url');
const unb64  = str => Buffer.from(str, 'base64url');

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** HKDF as the push spec uses it: one-block expand, so `info || 0x01`. */
function hkdf(salt, ikm, info, len) {
  const prk = hmac(salt, ikm);
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
}

/**
 * Encrypt `payload` for one subscription.
 * @param {{p256dh:string, auth:string}} keys - as handed over by the browser
 * @returns {Buffer} the aes128gcm body, ready to POST
 */
export function encrypt(keys, payload) {
  const uaPublic = unb64(keys.p256dh);   // receiver's public key, 65 bytes
  const authSecret = unb64(keys.auth);   // shared secret, 16 bytes

  // Ephemeral sender keypair; its public half travels in the body header.
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.3: mix the auth secret in before the per-message salt.
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), uaPublic, asPublic
  ]);
  const ikm = hkdf(authSecret, sharedSecret, keyInfo, 32);

  const salt = randomBytes(16);
  const cek   = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

  // 0x02 is the delimiter marking this as the last (and only) record.
  const plaintext = Buffer.concat([Buffer.from(payload, 'utf8'), Buffer.from([2])]);

  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext), cipher.final(), cipher.getAuthTag()
  ]);

  // Header: salt(16) || record size(4) || key id length(1) || key id(65)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([
    salt, rs, Buffer.from([asPublic.length]), asPublic, ciphertext
  ]);
}

/** Build the `Authorization: vapid ...` header for one push origin. */
export function vapidHeader(audience, subject, publicKey, privateKey) {
  const pub = unb64(publicKey);
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC', crv: 'P-256',
      x: b64url(pub.subarray(1, 33)),
      y: b64url(pub.subarray(33, 65)),
      d: privateKey
    }
  });

  const seg = o => b64url(JSON.stringify(o));
  const signingInput = [
    seg({ typ: 'JWT', alg: 'ES256' }),
    seg({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })
  ].join('.');

  // JOSE wants the raw r||s pair, not node's default DER.
  const sig = signRaw('sha256', Buffer.from(signingInput), {
    key, dsaEncoding: 'ieee-p1363'
  });

  return `vapid t=${signingInput}.${b64url(sig)}, k=${publicKey}`;
}

/**
 * Check the VAPID pair before trusting it.
 *
 * A mis-pasted key is the single most likely misconfiguration here: the
 * public and private halves look alike and sit next to each other in any
 * setup guide: and it fails deep inside OpenSSL as
 * `common libcrypto routines::too small buffer`, which names nothing
 * useful and looks identical to a bad subscription.
 *
 * @returns {{ok:boolean, detail:string, privateBytes:number, publicBytes:number}}
 */
export function checkVapid(publicKey, privateKey) {
  const out = { ok: false, detail: '', privateBytes: 0, publicBytes: 0 };
  try {
    out.publicBytes  = unb64(publicKey || '').length;
    out.privateBytes = unb64(privateKey || '').length;
  } catch (e) {
    out.detail = 'keys are not valid base64url';
    return out;
  }
  if (out.publicBytes !== 65) {
    out.detail = 'VAPID_PUBLIC_KEY should decode to 65 bytes, got ' + out.publicBytes;
    return out;
  }
  if (out.privateBytes !== 32) {
    out.detail = out.privateBytes === 65
      ? 'VAPID_PRIVATE_KEY holds a 65-byte value: that is the PUBLIC key, not the private one'
      : 'VAPID_PRIVATE_KEY should decode to 32 bytes, got ' + out.privateBytes;
    return out;
  }
  // Lengths alone do not prove the halves belong together: sign something,
  // then verify it against the public key we advertise to the browser.
  try {
    const header = vapidHeader('https://example.com', 'mailto:x@y.z', publicKey, privateKey);
    const jwt = header.slice(header.indexOf('t=') + 2).split(',')[0];
    const [h, pl, sig] = jwt.split('.');
    const pub = unb64(publicKey);
    const verifyKey = createPublicKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) }
    });
    const good = verifyOne('sha256', Buffer.from(h + '.' + pl),
      { key: verifyKey, dsaEncoding: 'ieee-p1363' }, unb64(sig));
    if (!good) {
      out.detail = 'VAPID keys are both well-formed but are not a matching pair';
      return out;
    }
  } catch (e) {
    out.detail = 'signing failed: ' + e.message;
    return out;
  }
  out.ok = true;
  out.detail = 'valid';
  return out;
}

/**
 * Deliver one notification.
 * @returns {{ok:boolean, status:number, gone:boolean, stage:string}}
 *   `gone` means the subscription is dead and the caller should delete it.
 *   A thrown error is prefixed with the stage that failed, so a config
 *   fault is never mistaken for a bad subscription.
 */
export async function sendPush(sub, payload, opts) {
  const { publicKey, privateKey, subject, ttl = 3600, urgency = 'normal' } = opts;

  let body, authorization;
  try {
    body = encrypt({ p256dh: sub.p256dh, auth: sub.auth }, payload);
  } catch (e) {
    throw new Error('[encrypt] this device subscription is unusable: ' + e.message);
  }
  try {
    authorization = vapidHeader(new URL(sub.endpoint).origin, subject, publicKey, privateKey);
  } catch (e) {
    throw new Error('[vapid] check VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY: ' + e.message);
  }

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
      TTL: String(ttl),
      Urgency: urgency
    },
    body
  });

  // 404/410 are the push service telling us this endpoint is retired.
  return {
    ok: res.ok, status: res.status, stage: 'send',
    gone: res.status === 404 || res.status === 410
  };
}
