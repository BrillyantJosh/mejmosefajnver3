/**
 * The app's one BEF client. The Vite side of ./base.ts: a dev build talks to
 * BEF's local harness, every other build to befexplorer.com — and there is no
 * variable to point a build anywhere else. (Live BEF lets in only https
 * origins, so a dev or preview build on localhost cannot reach it either.)
 */
import { createBefClient } from './api';
import { resolveBefBase } from './base';

export const BEF_BASE = resolveBefBase({ dev: import.meta.env.DEV });

export const befClient = createBefClient({ base: BEF_BASE });
