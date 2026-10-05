/**
 * "I cannot tell whether you are a member" must never read as a success — or as "you are not one".
 *
 * Two places let it:
 *  - the form looked at ONE status code (403) after publishing and treated every other answer
 *    as a success, so a 503 came out as "Request published, funding opens …" for a request the
 *    server had not listed (and the person published it again);
 *  - the create page read a failed eligibility check as "no Lana8Wonder plan" and told a member
 *    to go and join Lana8Wonder.
 *   npx tsx scripts/testUfUpsertOutcome.ts
 */
import { readFileSync } from 'node:fs';
import { upsertOutcome } from '../src/lib/ufUpsertOutcome.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200)}`);
  if (!cond) failures++;
};

console.log('— what the server\'s answer means to the person —');
{
  for (const status of [200, 201, 204]) check(`${status} → listed`, upsertOutcome(status, undefined, false).kind === 'listed');

  for (const sl of [false, true]) {
    const lang = sl ? 'SL' : 'EN';
    const cantTell = upsertOutcome(503, 'Split calendar unavailable — the published Split history skips Split 3', sl);
    check(`${lang} 503 → published, not listed yet`, cantTell.kind === 'pending', cantTell);
    check(`${lang} 503 says it will appear by itself and says not to publish again`,
      cantTell.kind === 'pending' && (sl ? /pol ure/.test(cantTell.message) && /Ne objavljaj/.test(cantTell.message)
        : /half an hour/.test(cantTell.message) && /do not publish it again/i.test(cantTell.message)), cantTell);
    check(`${lang} 503 does not claim the request is funded, open or "accepted"`,
      cantTell.kind === 'pending' && !/sprejet|accepted|funding opens|financiranje se odpre/i.test(cantTell.message), cantTell);
    check(`${lang} 503 names the cause the person can act on (membership), not a stack of codes`,
      cantTell.kind === 'pending' && /Lana8Wonder/.test(cantTell.message) && !/503|calendar|Split 3/.test(cantTell.message), cantTell);

    for (const status of [500, 502, 504, 429]) {
      const o = upsertOutcome(status, 'boom', sl);
      check(`${lang} ${status} → published, not listed yet (never a success, never "refused")`, o.kind === 'pending' && /pol ure|half an hour/.test(o.message), o);
    }

    const notEligible = upsertOutcome(403, 'Not eligible — Lana8Wonder membership of at least 4 completed Splits is required', sl);
    check(`${lang} 403 → refused, with the server's own reason`, notEligible.kind === 'refused' && /Not eligible/.test(notEligible.message), notEligible);
    check(`${lang} 403 with no reason → still refused, in words`, upsertOutcome(403, undefined, sl).kind === 'refused' && upsertOutcome(403, '  ', sl).message.length > 5);
    for (const status of [400, 401, 404, 409, 413]) {
      const o = upsertOutcome(status, 'A newer version of this request already exists', sl);
      check(`${lang} ${status} → refused: the server will not list it`, o.kind === 'refused' && /newer version/.test(o.message), o);
    }
    check(`${lang} a reason that is not text is not shown as "[object Object]"`, upsertOutcome(400, { nested: true }, sl).message.length > 5 && !/object/.test(upsertOutcome(400, { nested: true }, sl).message));
  }
}

console.log('— the form —');
{
  const form = readFileSync(new URL('../src/pages/unconditional-financing/UFRequestForm.tsx', import.meta.url), 'utf8');
  check('the answer is read through upsertOutcome, not through one status code',
    /import \{ upsertOutcome \} from "@\/lib\/ufUpsertOutcome"/.test(form) && /upsertOutcome\(upsert\.status, body\?\.error, sl\)/.test(form) && !/res\.status === 403/.test(form));
  check('any answer that is not 2xx is looked at', /if \(upsert && !upsert\.ok\) \{/.test(form));
  check('a refusal stops the form and keeps the person on it', /if \(outcome\.kind === "refused"\) throw new Error\(outcome\.message\);/.test(form));
  check('"cannot tell" is a warning, then the form is left — it never reaches the success toast',
    /if \(outcome\.kind === "pending"\) \{\s*toast\.warning\(outcome\.message, \{ duration: 20000 \}\);\s*onSuccess\(\);\s*return;\s*\}/.test(form));
  check('…and the success toast comes after that, once', (form.match(/toast\.success\(/g) || []).length === 1 && form.indexOf('toast.warning(outcome.message') < form.indexOf('toast.success('));
  check('the old "message contains the word fetch" guess is gone', !/message\.includes\("fetch"\)/.test(form));
  check('a server that cannot be reached at all is still covered by the indexer, quietly (unchanged)', /could not reach the server \(the indexer will pick it up\)/.test(form));
  check('a new request\'s id is chosen once per form, so a second Publish replaces the first',
    /const newRequestId = useRef<string \| null>\(null\);/.test(form) && /if \(!existing && !newRequestId\.current\) newRequestId\.current = `uf:\$\{crypto\.randomUUID\(\)\}`;/.test(form)
      && /const dTag = existing \? existing\.id : \(newRequestId\.current as string\);/.test(form) && (form.match(/crypto\.randomUUID\(\)/g) || []).length === 1);
}

console.log('— the create page —');
{
  const page = readFileSync(new URL('../src/pages/unconditional-financing/UFCreateRequest.tsx', import.meta.url), 'utf8');
  const hook = readFileSync(new URL('../src/hooks/useUFEligibility.ts', import.meta.url), 'utf8');
  const errorAt = page.indexOf('if (error) {');
  const noPlanAt = page.indexOf('if (!eligibility?.exists) {');
  check('the page reads the hook\'s error and a way to ask again', /const \{ eligibility, isLoading, error, retry \} = useUFEligibility\(/.test(page));
  check('a failed check is its own screen, BEFORE "plan required" and "not yet eligible"', errorAt > 0 && noPlanAt > errorAt && errorAt > page.indexOf('if (isLoading) {'));
  check('that screen says it does not mean "you do not qualify", and offers to try again',
    /That does not mean you do not qualify/.test(page) && /onClick=\{retry\}/.test(page) && /Preverjanje trenutno ni mogoče/.test(page));
  check('the hook keeps the server\'s own reason for a failed check and does not turn it into a "no plan"',
    /throw new Error\(typeof body\?\.error === 'string' && body\.error \? body\.error : `HTTP \$\{r\.status\}`\)/.test(hook) && /setEligibility\(null\); setError\(/.test(hook));
  check('the hook can ask again', /const retry = useCallback\(\(\) => setAttempt\(\(n\) => n \+ 1\), \[\]\);/.test(hook) && /\[pubkey, attempt\]/.test(hook));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
