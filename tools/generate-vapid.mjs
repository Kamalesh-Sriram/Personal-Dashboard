/* Makes the key pair that lets your site send push notifications:

     node tools/generate-vapid.mjs

   Copy the two lines into Netlify > Site configuration > Environment
   variables. The PRIVATE key must never be committed, shared or pasted
   into the app. Nothing is written to disk and nothing leaves this
   machine. */
import { createECDH } from 'node:crypto';

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
console.log('VAPID_PUBLIC_KEY=' + ecdh.getPublicKey().toString('base64url'));
const priv = ecdh.getPrivateKey();
console.log('VAPID_PRIVATE_KEY=' + Buffer.concat([Buffer.alloc(32 - priv.length), priv]).toString('base64url'));   // always 32 bytes
console.log('\nThe public key is the long one (87 characters). The private key is the short one (43).');
