/**
 * Print a fresh ISSUER_KEY_ENC_KEY (32 random bytes, hex) for .env.
 *
 *   npm run gen:key
 */
import { generateKeyEncKey } from './env';

console.log('');
console.log('Put this line in backend/.env (keep it secret):');
console.log('');
console.log(`ISSUER_KEY_ENC_KEY=${generateKeyEncKey()}`);
console.log('');
