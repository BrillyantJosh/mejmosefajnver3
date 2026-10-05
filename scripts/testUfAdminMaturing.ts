/**
 * A maturing period of 0 days must never be saved, or left standing, by accident.
 *
 * On 5. 10. 2026 a request ("Evolution Health and Wellness", 90 000 GBP) went
 * live for funding the instant it was published, although the admin page now
 * says 15 days. It had been published at 09:10 and the setting was saved as 15
 * at 11:18; until then the stored value was 0, and a module-wide 0 had been
 * letting every request skip the review period — three of the four requests
 * this module has had opened that way. 0 is a legitimate choice, so it stays
 * possible; it just has to be deliberate each time and impossible to forget.
 *   npx tsx scripts/testUfAdminMaturing.ts
 */
import { readFileSync } from 'node:fs';
import { maturingSkipsReview } from '../src/lib/ufSettings.js';

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200)}`);
  if (!cond) failures++;
};

console.log('— what counts as "no review" —');
{
  check('0 days is no review', maturingSkipsReview(0));
  check('so is -0 and anything below', maturingSkipsReview(-0) && maturingSkipsReview(-1));
  check('1 day is a review', !maturingSkipsReview(1));
  check('the default 8 and the saved 15 are reviews', !maturingSkipsReview(8) && !maturingSkipsReview(15));
  check('a number that is not one is not taken for 0', !maturingSkipsReview(Number.NaN) && !maturingSkipsReview(Number.POSITIVE_INFINITY));
}

console.log('— the admin page —');
{
  const page = readFileSync(new URL('../src/pages/admin/UnconditionalFinancingAdmin.tsx', import.meta.url), 'utf8');

  check('the Save button goes through handleSave, never straight to the write',
    /onClick=\{handleSave\}/.test(page) && !/onClick=\{save\}/.test(page) && !/onClick=\{\(\) => save\(\)\}/.test(page));
  check('handleSave stops at 0 and asks first',
    /if \(maturingSkipsReview\(daysNum\)\) \{\s*setConfirmNoMaturing\(true\);\s*return;\s*\}/.test(page));
  check('the write is made in one place only', (page.match(/updateUnconditionalFinancingSettings\(/g) || []).length === 1, (page.match(/updateUnconditionalFinancingSettings\(/g) || []).length);
  check('…and reached from exactly two places: a non-zero save, and "Yes" in the dialog',
    (page.match(/void save\(\)/g) || []).length === 2, (page.match(/void save\(\)/g) || []).length);
  check('the dialog\'s "Yes" is the only way a 0 is saved',
    /AlertDialogAction\s+onClick=\{\(\) => \{\s*setConfirmNoMaturing\(false\);\s*void save\(\);/.test(page));
  check('typing 0 warns before saving', /daysValid && maturingSkipsReview\(daysNum\)/.test(page));
  check('a SAVED 0 is announced when the page opens, from the stored value, not the typed one',
    /const savedDays = appSettings\?\.uf_maturing_days;/.test(page) &&
      /const savedSkipsReview = typeof savedDays === "number" && maturingSkipsReview\(savedDays\);/.test(page));
  check('…and the announcement is shown whenever that is true, loudly',
    /\{savedSkipsReview && \(\s*<Alert variant="destructive">[\s\S]*?Requests are opening for funding the moment they are published/.test(page));
  check('what 0 means is said in one place and says it covers every request',
    (page.match(/const NO_REVIEW_EXPLANATION/g) || []).length === 1 && /every request published while it stays at 0/.test(page));
}

console.log(failures === 0 ? '\n✅ all passed' : `\n❌ ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
