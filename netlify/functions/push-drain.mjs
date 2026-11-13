/* Scheduled: runs once a minute and delivers whatever has come due. This
   is what makes notifications arrive while the app is closed. On a site
   without push configured it does nothing. About 43,000 runs a month,
   inside Netlify's free allowance. */
import { drain } from '../lib/drain.mjs';

export default async () => {
  try {
    const result = await drain();
    if (result.due) console.log('push-drain', JSON.stringify(result));
    return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('push-drain failed:', e.message);
    return new Response(JSON.stringify({ error: 'failed' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

export const config = { schedule: '* * * * *' };
